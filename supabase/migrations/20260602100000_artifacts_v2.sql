SET search_path = public, extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Artifact v2 — Patch-Based Canonical Artifacts
--
-- A storage-engine refactor: artifacts become durable, addressable, versioned
-- reference objects edited by block-level PATCHES instead of whole-body replace.
--
--   artifacts                  stable identity (key) + metadata + version counter
--   artifact_blocks            current materialized block state, addressable by path
--   artifact_revisions         immutable append-only ledger of patch operations
--   artifact_snapshots         occasional compiled full-document checkpoints
--   artifact_block_embeddings  one (or more, chunked) embedding per searchable block
--
-- RPCs (atomicity is the load-bearing safety mechanism — mirrors the pattern of
-- save_handoff_snapshot_tx in 20260507000004):
--   create_artifact_v2(...)    transactional create + initial blocks + revision
--   apply_artifact_patch(...)  optimistic-locked, all-or-nothing patch application
--   match_artifact_blocks(...) block-level vector search (SECURITY INVOKER, like
--                              match_artifact_chunks)
--
-- Governance = audit-only (decided with operator): a patch applies live; the
-- artifact_revisions ledger IS the audit trail. There is no draft/approve gate
-- (the old approve_artifact path is retired). Full-body replace survives only as
-- the admin/import/repair replace_artifact_body tool.
--
-- The OLD engine (canonical_artifacts / artifact_versions / artifact_chunks /
-- artifact_links / match_artifact_chunks) is NOT dropped here — it is retained
-- read-only for rollback. A later cleanup migration removes it once v2 is proven.
--
-- Backfill (bottom of file) is LOSSLESS: each canonical_artifacts row is migrated
-- into a single /body block + a full snapshot, REUSING canonical_artifacts.id as
-- artifacts.id so the existing artifact_links FK and all provenance still resolve
-- with no FK change. Heading-based re-splitting of /body is a later, explicit,
-- human-reviewed admin step — never done automatically here.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ Tables ══════════════════════════════════════════════════════════════════

CREATE TABLE artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'document',
  status          TEXT NOT NULL DEFAULT 'active',
  current_version INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artifact_blocks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id  UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  title        TEXT,
  content      TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  version      INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, path)
);

CREATE TABLE artifact_revisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id  UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  base_version INTEGER NOT NULL,
  ops          JSONB NOT NULL,
  summary      TEXT,
  actor        TEXT NOT NULL DEFAULT 'mcp',
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

CREATE TABLE artifact_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id      UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  compiled_content TEXT NOT NULL,
  content_hash     TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version)
);

-- One embedding per searchable block; chunk_index supports splitting oversized
-- blocks (the block remains one display unit; we never store one huge embedding).
CREATE TABLE artifact_block_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  block_id    UUID REFERENCES artifact_blocks(id) ON DELETE CASCADE,
  block_path  TEXT NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(1536),
  chunk_index INTEGER NOT NULL DEFAULT 0,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, block_path, chunk_index)
);

-- ═══ Indexes ═════════════════════════════════════════════════════════════════
CREATE INDEX artifact_blocks_artifact_path_idx     ON artifact_blocks (artifact_id, path);
CREATE INDEX artifact_revisions_artifact_version_idx ON artifact_revisions (artifact_id, version DESC);
CREATE INDEX artifact_snapshots_artifact_version_idx ON artifact_snapshots (artifact_id, version DESC);
CREATE INDEX artifacts_metadata_gin_idx            ON artifacts USING gin (metadata);
CREATE INDEX artifacts_kind_status_idx             ON artifacts (kind, status);
-- HNSW for vector search (OB1 standard — matches artifact_chunks).
CREATE INDEX artifact_block_embeddings_hnsw
  ON artifact_block_embeddings USING hnsw (embedding vector_cosine_ops);

-- ═══ RLS + grants (mirrors 20260506000001_canonical_artifacts.sql) ════════════
ALTER TABLE artifacts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_blocks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_snapshots        ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_block_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON artifacts                 FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_blocks           FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_revisions        FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_snapshots        FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON artifact_block_embeddings FOR ALL USING (auth.role() = 'service_role');

GRANT ALL ON artifacts                 TO service_role;
GRANT ALL ON artifact_blocks           TO service_role;
GRANT ALL ON artifact_revisions        TO service_role;
GRANT ALL ON artifact_snapshots        TO service_role;
GRANT ALL ON artifact_block_embeddings TO service_role;

-- ═══ updated_at triggers (reuse set_artifact_updated_at from canonical migration) ═
CREATE TRIGGER trg_artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();
CREATE TRIGGER trg_artifact_blocks_updated_at
  BEFORE UPDATE ON artifact_blocks
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();
CREATE TRIGGER trg_artifact_block_embeddings_updated_at
  BEFORE UPDATE ON artifact_block_embeddings
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();

-- ═══ RPC: apply_artifact_patch ═════════════════════════════════════════════════
-- Optimistic-locked, all-or-nothing block patch. p_ops is a JSON array of patch
-- operations (create_block, replace_block, append_block, delete_block,
-- rename_block, update_block_metadata). Any RAISE rolls back the whole call
-- (PostgREST wraps each RPC in a transaction) — there is never a partial patch.
-- expected_hash gives per-block optimistic concurrency; p_admin bypasses it for
-- import/repair. Returns {old_version, new_version, changed_paths, changed[]}
-- where each changed entry carries an action (upsert|delete|rename|noembed) so the
-- TS layer can regenerate embeddings for ONLY the content blocks that changed.
CREATE OR REPLACE FUNCTION apply_artifact_patch(
  p_key          TEXT,
  p_base_version INTEGER,
  p_ops          JSONB,
  p_summary      TEXT    DEFAULT NULL,
  p_actor        TEXT    DEFAULT 'mcp',
  p_metadata     JSONB   DEFAULT '{}'::jsonb,
  p_admin        BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_artifact_id  UUID;
  v_current      INTEGER;
  v_new_version  INTEGER;
  v_op           JSONB;
  v_kind         TEXT;
  v_path         TEXT;
  v_to_path      TEXT;
  v_content      TEXT;
  v_expected     TEXT;
  v_existing     RECORD;
  v_new_content  TEXT;
  v_hash         TEXT;
  v_block_id     UUID;
  v_changed      JSONB := '[]'::jsonb;
  v_changed_paths TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Row lock for optimistic-concurrency window.
  SELECT id, current_version INTO v_artifact_id, v_current
  FROM artifacts WHERE key = p_key FOR UPDATE;

  IF v_artifact_id IS NULL THEN
    RAISE EXCEPTION 'ARTIFACT_NOT_FOUND: no artifact with key %', p_key;
  END IF;

  IF v_current <> p_base_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: artifact % is at version %, but patch was based on version %',
      p_key, v_current, p_base_version;
  END IF;

  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'EMPTY_PATCH: ops must be a non-empty array';
  END IF;

  v_new_version := v_current + 1;

  -- Ops apply sequentially; any RAISE rolls back the whole RPC (no partial patch).
  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_kind     := v_op->>'op';
    v_path     := v_op->>'path';
    v_content  := v_op->>'content';
    v_expected := v_op->>'expected_hash';

    SELECT * INTO v_existing FROM artifact_blocks
      WHERE artifact_id = v_artifact_id AND path = v_path;

    IF v_kind = 'create_block' THEN
      IF v_path IS NULL OR left(v_path,1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: create_block path must be non-null and start with "/" (got %)', v_path;
      END IF;
      IF FOUND THEN
        RAISE EXCEPTION 'PATH_EXISTS: block % already exists — use replace_block or another path', v_path;
      END IF;
      IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: create_block % requires content', v_path; END IF;
      v_hash := encode(digest(v_content, 'sha256'), 'hex');
      INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order, metadata)
      VALUES (v_artifact_id, v_path, v_op->>'title', v_content, v_hash, v_new_version,
              COALESCE((v_op->>'sort_order')::int, 0), COALESCE(v_op->'metadata', '{}'::jsonb))
      RETURNING id INTO v_block_id;
      v_changed := v_changed || jsonb_build_object('block_id', v_block_id, 'path', v_path, 'content', v_content, 'content_hash', v_hash, 'action', 'upsert');
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind = 'replace_block' THEN
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist — use create_block or check the manifest', v_path; END IF;
      IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: replace_block % requires content', v_path; END IF;
      IF NOT p_admin AND v_expected IS NOT NULL AND v_expected <> v_existing.content_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_existing.content_hash;
      END IF;
      v_hash := encode(digest(v_content, 'sha256'), 'hex');
      UPDATE artifact_blocks SET
        content = v_content, content_hash = v_hash, version = v_new_version,
        title = COALESCE(v_op->>'title', title),
        metadata = CASE WHEN v_op ? 'metadata' THEN metadata || (v_op->'metadata') ELSE metadata END
      WHERE id = v_existing.id;
      v_changed := v_changed || jsonb_build_object('block_id', v_existing.id, 'path', v_path, 'content', v_content, 'content_hash', v_hash, 'action', 'upsert');
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind = 'append_block' THEN
      IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: append_block % requires content', v_path; END IF;
      IF NOT FOUND THEN
        IF COALESCE((v_op->>'create_if_missing')::boolean, false) THEN
          v_hash := encode(digest(v_content, 'sha256'), 'hex');
          INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order)
          VALUES (v_artifact_id, v_path, v_op->>'title', v_content, v_hash, v_new_version, 0)
          RETURNING id INTO v_block_id;
          v_changed := v_changed || jsonb_build_object('block_id', v_block_id, 'path', v_path, 'content', v_content, 'content_hash', v_hash, 'action', 'upsert');
          v_changed_paths := array_append(v_changed_paths, v_path);
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'MISSING_PATH: block % does not exist — set create_if_missing=true or use create_block', v_path;
      END IF;
      IF NOT p_admin AND v_expected IS NOT NULL AND v_expected <> v_existing.content_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_existing.content_hash;
      END IF;
      v_new_content := CASE WHEN length(v_existing.content) > 0
                            THEN v_existing.content || E'\n\n' || v_content
                            ELSE v_content END;
      v_hash := encode(digest(v_new_content, 'sha256'), 'hex');
      UPDATE artifact_blocks SET content = v_new_content, content_hash = v_hash, version = v_new_version
      WHERE id = v_existing.id;
      v_changed := v_changed || jsonb_build_object('block_id', v_existing.id, 'path', v_path, 'content', v_new_content, 'content_hash', v_hash, 'action', 'upsert');
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind = 'delete_block' THEN
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path; END IF;
      IF NOT p_admin AND v_expected IS NOT NULL AND v_expected <> v_existing.content_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_existing.content_hash;
      END IF;
      -- Soft delete: archive, leave content in place.
      UPDATE artifact_blocks SET
        version = v_new_version,
        metadata = metadata || jsonb_build_object('status','archived','deleted_at', now())
      WHERE id = v_existing.id;
      v_changed := v_changed || jsonb_build_object('block_id', v_existing.id, 'path', v_path, 'action', 'delete');
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind = 'rename_block' THEN
      v_path    := v_op->>'from_path';
      v_to_path := v_op->>'to_path';
      SELECT * INTO v_existing FROM artifact_blocks WHERE artifact_id = v_artifact_id AND path = v_path;
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path; END IF;
      IF EXISTS (SELECT 1 FROM artifact_blocks WHERE artifact_id = v_artifact_id AND path = v_to_path) THEN
        RAISE EXCEPTION 'PATH_EXISTS: target block % already exists', v_to_path;
      END IF;
      IF NOT p_admin AND v_expected IS NOT NULL AND v_expected <> v_existing.content_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_existing.content_hash;
      END IF;
      UPDATE artifact_blocks SET path = v_to_path, version = v_new_version WHERE id = v_existing.id;
      v_changed := v_changed || jsonb_build_object('block_id', v_existing.id, 'path', v_to_path, 'old_path', v_path, 'content', v_existing.content, 'content_hash', v_existing.content_hash, 'action', 'rename');
      v_changed_paths := array_append(v_changed_paths, v_to_path);

    ELSIF v_kind = 'update_block_metadata' THEN
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path; END IF;
      IF NOT (v_op ? 'metadata_patch') THEN RAISE EXCEPTION 'BAD_OP: update_block_metadata % requires metadata_patch', v_path; END IF;
      UPDATE artifact_blocks SET version = v_new_version, metadata = metadata || (v_op->'metadata_patch')
      WHERE id = v_existing.id;
      -- metadata-only: no embedding regeneration.
      v_changed := v_changed || jsonb_build_object('block_id', v_existing.id, 'path', v_path, 'action', 'noembed');
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSE
      RAISE EXCEPTION 'UNKNOWN_OP: unsupported op "%"', v_kind;
    END IF;
  END LOOP;

  UPDATE artifacts SET current_version = v_new_version WHERE id = v_artifact_id;

  INSERT INTO artifact_revisions (artifact_id, version, base_version, ops, summary, actor, metadata)
  VALUES (v_artifact_id, v_new_version, p_base_version, p_ops, p_summary, p_actor, COALESCE(p_metadata,'{}'::jsonb));

  RETURN jsonb_build_object(
    'artifact_id', v_artifact_id,
    'key', p_key,
    'old_version', v_current,
    'new_version', v_new_version,
    'changed_paths', to_jsonb(v_changed_paths),
    'changed', v_changed
  );
END;
$$;

-- ═══ RPC: create_artifact_v2 ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION create_artifact_v2(
  p_key      TEXT,
  p_title    TEXT,
  p_kind     TEXT  DEFAULT 'document',
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_blocks   JSONB DEFAULT '[]'::jsonb,
  p_actor    TEXT  DEFAULT 'mcp',
  p_id       UUID  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id       UUID;
  v_version  INTEGER;
  v_block    JSONB;
  v_path     TEXT;
  v_content  TEXT;
  v_hash     TEXT;
  v_block_id UUID;
  v_created  JSONB := '[]'::jsonb;
  v_ops      JSONB := '[]'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM artifacts WHERE key = p_key) THEN
    RAISE EXCEPTION 'KEY_EXISTS: artifact key % already exists', p_key;
  END IF;

  v_version := CASE WHEN p_blocks IS NOT NULL AND jsonb_typeof(p_blocks) = 'array'
                         AND jsonb_array_length(p_blocks) > 0 THEN 1 ELSE 0 END;
  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO artifacts (id, key, title, kind, current_version, metadata)
  VALUES (v_id, p_key, p_title, COALESCE(p_kind,'document'), v_version, COALESCE(p_metadata,'{}'::jsonb));

  IF v_version = 1 THEN
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
      v_path    := v_block->>'path';
      v_content := COALESCE(v_block->>'content', '');
      IF v_path IS NULL OR left(v_path,1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: block path must start with "/" (got %)', v_path;
      END IF;
      v_hash := encode(digest(v_content, 'sha256'), 'hex');
      INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order, metadata)
      VALUES (v_id, v_path, v_block->>'title', v_content, v_hash, 1,
              COALESCE((v_block->>'sort_order')::int, 0), COALESCE(v_block->'metadata','{}'::jsonb))
      RETURNING id INTO v_block_id;
      v_created := v_created || jsonb_build_object('block_id', v_block_id, 'path', v_path, 'content', v_content, 'content_hash', v_hash);
      v_ops := v_ops || jsonb_build_object('op','create_block','path',v_path);
    END LOOP;

    INSERT INTO artifact_revisions (artifact_id, version, base_version, ops, summary, actor)
    VALUES (v_id, 1, 0, v_ops, 'Initial create', p_actor);
  END IF;

  RETURN jsonb_build_object('artifact_id', v_id, 'key', p_key, 'version', v_version, 'blocks', v_created);
END;
$$;

-- ═══ RPC: match_artifact_blocks (block-level vector search) ════════════════════
-- SECURITY INVOKER (like match_artifact_chunks). Archived blocks excluded.
CREATE OR REPLACE FUNCTION match_artifact_blocks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.38,
  match_count     int   DEFAULT 10,
  filter_kind     text  DEFAULT NULL,
  filter_key      text  DEFAULT NULL
)
RETURNS TABLE (
  artifact_id    uuid,
  artifact_key   text,
  artifact_title text,
  kind           text,
  block_id       uuid,
  block_path     text,
  block_title    text,
  content        text,
  chunk_index    int,
  similarity     float
)
LANGUAGE sql STABLE AS $$
  SELECT
    a.id, a.key, a.title, a.kind,
    abe.block_id, abe.block_path, b.title,
    abe.content, abe.chunk_index,
    1 - (abe.embedding <=> query_embedding) AS similarity
  FROM artifact_block_embeddings abe
  JOIN artifacts a ON a.id = abe.artifact_id
  LEFT JOIN artifact_blocks b ON b.id = abe.block_id
  WHERE
    abe.embedding IS NOT NULL
    AND 1 - (abe.embedding <=> query_embedding) >= match_threshold
    AND (b.id IS NULL OR COALESCE(b.metadata->>'status','') <> 'archived')
    AND (filter_kind IS NULL OR a.kind = filter_kind)
    AND (filter_key  IS NULL OR a.key  = filter_key)
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- ═══ Structural backfill — LOSSLESS, id-reusing, idempotent ═══════════════════
-- Each canonical_artifacts row → artifacts row (same id) + one /body block +
-- migration revision + full-body snapshot. No embeddings here (no API in SQL);
-- a post-deploy reindex_artifact_embeddings sweep embeds the /body blocks.
DO $backfill$
DECLARE
  r       RECORD;
  v_body  TEXT;
  v_base  TEXT;
  v_key   TEXT;
  v_hash  TEXT;
  v_meta  JSONB;
BEGIN
  FOR r IN SELECT * FROM canonical_artifacts LOOP
    -- id-reuse means a re-run is a no-op.
    IF EXISTS (SELECT 1 FROM artifacts WHERE id = r.id) THEN CONTINUE; END IF;

    SELECT body INTO v_body FROM artifact_versions
      WHERE id = COALESCE(r.current_version_id, r.latest_version_id);
    v_body := COALESCE(v_body, '');

    v_base := lower(regexp_replace(COALESCE(NULLIF(r.source_path,''), r.title, 'artifact'), '[^a-zA-Z0-9]+', '-', 'g'));
    v_base := trim(both '-' from v_base);
    IF v_base = '' THEN v_base := 'artifact'; END IF;
    v_key := v_base;
    IF EXISTS (SELECT 1 FROM artifacts WHERE key = v_key) THEN
      v_key := v_base || '-' || left(r.id::text, 8);
    END IF;

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'legacy_artifact_id', r.id,
      'legacy_doc_type',    r.doc_type,
      'authority_level',    r.authority_level,
      'scope',              r.scope,
      'domain',             r.domain,
      'target_runtime',     r.target_runtime,
      'summary',            r.summary,
      'tags',               to_jsonb(COALESCE(r.tags, ARRAY[]::text[])),
      'migrated_from',      'canonical_artifacts',
      'migrated_at',        now()
    ));

    v_hash := encode(digest(v_body, 'sha256'), 'hex');

    INSERT INTO artifacts (id, key, title, kind, status, current_version, metadata, created_at, updated_at)
    VALUES (r.id, v_key, r.title, COALESCE(r.doc_type, 'document'), 'active', 1, v_meta, r.created_at, now());

    INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order)
    VALUES (r.id, '/body', r.title, v_body, v_hash, 1, 0);

    INSERT INTO artifact_revisions (artifact_id, version, base_version, ops, summary, actor, metadata)
    VALUES (r.id, 1, 0,
      jsonb_build_array(jsonb_build_object('op','migration_import','path','/body')),
      'Migrated from canonical_artifacts (lossless /body import)', 'migration',
      jsonb_build_object('legacy_artifact_id', r.id));

    INSERT INTO artifact_snapshots (artifact_id, version, compiled_content, content_hash, metadata)
    VALUES (r.id, 1, v_body, v_hash, jsonb_build_object('source','migration'));
  END LOOP;
END
$backfill$;

-- Re-point artifact_links FK from canonical_artifacts(id) → artifacts(id).
-- Safe because: (a) we reused ids, so every existing artifact_links row's
-- artifact_id now also exists in artifacts (backfill ran above), and (b) it is
-- required so link_artifact can link brand-new v2 artifacts that have no
-- canonical_artifacts row. The retained canonical_artifacts table is unaffected.
ALTER TABLE artifact_links DROP CONSTRAINT IF EXISTS artifact_links_artifact_id_fkey;
ALTER TABLE artifact_links
  ADD CONSTRAINT artifact_links_artifact_id_fkey
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE;

-- Permission lockdown for the patch/create RPCs (parity with save_handoff_snapshot_tx).
REVOKE ALL ON FUNCTION apply_artifact_patch(text, integer, jsonb, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_artifact_patch(text, integer, jsonb, text, text, jsonb, boolean) TO service_role;
REVOKE ALL ON FUNCTION create_artifact_v2(text, text, text, jsonb, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_artifact_v2(text, text, text, jsonb, jsonb, text, uuid) TO service_role;
