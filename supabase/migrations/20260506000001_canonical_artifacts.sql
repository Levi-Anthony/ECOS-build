SET search_path = public, extensions;

-- canonical_artifacts: versioned document lane with authority/review controls.
-- Covers prompts, templates, PRDs, specs, SOPs, playbooks, agent context/handoff/instruction,
-- runtime policies, and repo context files. Agent-written artifacts start as draft/evidence
-- and require explicit approval before becoming active instructions.
--
-- Tables: canonical_artifacts, artifact_versions, artifact_chunks, artifact_links
-- RPC:    match_artifact_chunks (in 20260506000003)

-- ─── canonical_artifacts ─────────────────────────────────────────────────────
CREATE TABLE canonical_artifacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  doc_type            TEXT NOT NULL
    CHECK (doc_type IN (
      'prompt','template','checklist','prd','spec','sop','playbook',
      'agent_context','agent_handoff','agent_instruction','runtime_policy','repo_context'
    )),
  domain              TEXT,
  scope               TEXT NOT NULL DEFAULT 'project'
    CHECK (scope IN ('global','project','repo','client','domain','task')),
  -- target_runtime is convention-only (not CHECK-enforced) — runtimes evolve:
  -- claude_code, claude_desktop, chatgpt, cursor, codex, openclaw, any
  target_runtime      TEXT NOT NULL DEFAULT 'any',
  authority_level     TEXT NOT NULL DEFAULT 'draft'
    CHECK (authority_level IN (
      'evidence','draft','proposed_instruction','approved_instruction','policy'
    )),
  review_status       TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed','reviewed','approved','superseded','rejected')),
  maintained_by       TEXT NOT NULL DEFAULT 'human'
    CHECK (maintained_by IN ('human','agent','mixed','imported')),
  summary             TEXT,
  -- current_version_id = active approved version (null until first approval)
  -- latest_version_id  = newest version, possibly still a draft
  current_version_id  UUID,
  latest_version_id   UUID,
  source_path         TEXT,
  stale_after         TIMESTAMPTZ,
  supersedes          UUID REFERENCES canonical_artifacts(id),
  superseded_by       UUID REFERENCES canonical_artifacts(id),
  tags                TEXT[] DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ─── artifact_versions ────────────────────────────────────────────────────────
CREATE TABLE artifact_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id      UUID NOT NULL REFERENCES canonical_artifacts(id) ON DELETE CASCADE,
  version_number   INTEGER NOT NULL,
  body             TEXT NOT NULL,
  change_note      TEXT,
  created_by       TEXT NOT NULL DEFAULT 'agent',
  review_status    TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed','reviewed','approved','superseded','rejected')),
  -- chunking_status tracks embedding pipeline state; partial failures are visible
  chunking_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (chunking_status IN ('pending','complete','failed')),
  chunk_count      INTEGER DEFAULT 0,
  chunking_error   TEXT,
  checksum         TEXT,         -- SHA-256 of body (dedup / change detection)
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (artifact_id, version_number)
);

-- ─── artifact_chunks ──────────────────────────────────────────────────────────
CREATE TABLE artifact_chunks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id    UUID NOT NULL REFERENCES canonical_artifacts(id) ON DELETE CASCADE,
  version_id     UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
  section_title  TEXT,
  section_path   TEXT,           -- e.g. "Boot Sequence > C1 Retrieval"
  content        TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,
  embedding      vector(1536),
  metadata       JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (version_id, chunk_index)  -- prevents duplicate chunks on retry
);

-- ─── artifact_links ───────────────────────────────────────────────────────────
-- Domains resolved as entities (entity_type='domain') — not stored as text refs.
CREATE TABLE artifact_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id       UUID NOT NULL REFERENCES canonical_artifacts(id) ON DELETE CASCADE,
  linked_type       TEXT NOT NULL
    CHECK (linked_type IN ('thought','contact','entity','opportunity')),
  linked_id         UUID NOT NULL,
  relationship_type TEXT NOT NULL
    CHECK (relationship_type IN ('governs','supplements','derived_from','implements','references')),
  note              TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── Deferred FKs (versions table must exist first) ──────────────────────────
ALTER TABLE canonical_artifacts
  ADD CONSTRAINT fk_current_version
    FOREIGN KEY (current_version_id) REFERENCES artifact_versions(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_latest_version
    FOREIGN KEY (latest_version_id)  REFERENCES artifact_versions(id) ON DELETE SET NULL;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_artifacts_doc_type    ON canonical_artifacts (doc_type);
CREATE INDEX idx_artifacts_authority   ON canonical_artifacts (authority_level);
CREATE INDEX idx_artifacts_scope       ON canonical_artifacts (scope);
-- GIN indexes for array + JSONB fields
CREATE INDEX idx_artifacts_tags        ON canonical_artifacts USING gin (tags);
CREATE INDEX idx_artifact_chunks_meta  ON artifact_chunks USING gin (metadata);
-- HNSW for vector search (OB1 standard — no IVFFlat tuning required)
CREATE INDEX idx_artifact_chunks_vec
  ON artifact_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_artifact_chunks_art   ON artifact_chunks (artifact_id, version_id);
CREATE INDEX idx_artifact_links_art    ON artifact_links (artifact_id);
CREATE INDEX idx_artifact_links_linked ON artifact_links (linked_type, linked_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE canonical_artifacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_chunks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_links       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON canonical_artifacts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_versions   FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_chunks     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_links      FOR ALL USING (auth.role() = 'service_role');

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON canonical_artifacts TO service_role;
GRANT ALL ON artifact_versions   TO service_role;
GRANT ALL ON artifact_chunks     TO service_role;
GRANT ALL ON artifact_links      TO service_role;

-- ─── Trigger: updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_artifact_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_artifact_updated_at
  BEFORE UPDATE ON canonical_artifacts
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();
