SET search_path = public, extensions;

-- Artifact v3 Human Door
--
-- Extends the v2 patch engine without introducing a parallel documents model:
--   * authority-sensitive review policy on artifacts
--   * pending agent change proposals + append-only human review events
--   * reconstructable block-state snapshots for every accepted version
--   * actor/source provenance on accepted revisions
--   * artifact-level metadata, lifecycle, and review-policy patch operations

-- ─── Governance and provenance columns ──────────────────────────────────────

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS review_policy TEXT NOT NULL DEFAULT 'live_audit'
    CHECK (review_policy IN ('live_audit', 'human_gate'));

ALTER TABLE artifact_revisions
  ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'agent'
    CHECK (actor_type IN ('human', 'agent', 'system', 'import')),
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE artifact_snapshots
  ADD COLUMN IF NOT EXISTS block_state JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE artifact_revisions
SET
  actor_type = CASE
    WHEN actor = 'migration' THEN 'import'
    WHEN actor LIKE 'human:%' THEN 'human'
    WHEN actor LIKE 'system:%' THEN 'system'
    ELSE 'agent'
  END,
  actor_id = CASE
    WHEN position(':' IN actor) > 0 THEN split_part(actor, ':', 2)
    ELSE actor
  END
WHERE actor_id IS NULL;

UPDATE artifacts
SET review_policy = 'human_gate'
WHERE kind IN ('policy', 'agent_instruction', 'prompt', 'sop', 'protocol')
   OR metadata->>'authority_level' IN ('approved_instruction', 'policy')
   OR COALESCE(metadata->'tags', '[]'::jsonb) @> '["boot"]'::jsonb;

CREATE INDEX IF NOT EXISTS artifacts_review_policy_idx
  ON artifacts (review_policy, status);

-- ─── Review proposal and event lanes ────────────────────────────────────────

CREATE TABLE artifact_change_proposals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id                UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  base_version               INTEGER NOT NULL,
  ops                        JSONB NOT NULL CHECK (jsonb_typeof(ops) = 'array' AND jsonb_array_length(ops) > 0),
  summary                    TEXT NOT NULL,
  proposer_actor_type        TEXT NOT NULL DEFAULT 'agent'
    CHECK (proposer_actor_type IN ('human', 'agent', 'system', 'import')),
  proposer_actor_id          TEXT,
  source_refs                JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_policy_at_proposal  TEXT NOT NULL
    CHECK (review_policy_at_proposal IN ('live_audit', 'human_gate')),
  status                     TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected', 'conflicted', 'superseded')),
  supersedes_proposal_id     UUID REFERENCES artifact_change_proposals(id) ON DELETE SET NULL,
  review_reason              TEXT,
  reviewed_by_type           TEXT CHECK (reviewed_by_type IN ('human', 'agent', 'system', 'import')),
  reviewed_by_id             TEXT,
  reviewed_at                TIMESTAMPTZ,
  applied_version            INTEGER,
  metadata                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artifact_review_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  proposal_id UUID REFERENCES artifact_change_proposals(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL
    CHECK (event_type IN ('proposed', 'approved', 'edited_and_approved', 'rejected', 'revision_requested', 'conflicted', 'superseded')),
  actor_type  TEXT NOT NULL
    CHECK (actor_type IN ('human', 'agent', 'system', 'import')),
  actor_id    TEXT,
  reason      TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE artifact_human_authorities (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  principal_id  TEXT NOT NULL UNIQUE CHECK (principal_id !~ ':'),
  display_name  TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX artifact_change_proposals_status_created_idx
  ON artifact_change_proposals (status, created_at DESC);
CREATE INDEX artifact_change_proposals_artifact_idx
  ON artifact_change_proposals (artifact_id, created_at DESC);
CREATE INDEX artifact_review_events_artifact_created_idx
  ON artifact_review_events (artifact_id, created_at DESC);
CREATE INDEX artifact_review_events_proposal_idx
  ON artifact_review_events (proposal_id, created_at);

ALTER TABLE artifact_change_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_human_authorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON artifact_change_proposals
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role read insert" ON artifact_review_events
  FOR ALL USING (auth.role() = 'service_role');

GRANT ALL ON artifact_change_proposals TO service_role;
GRANT SELECT, INSERT ON artifact_review_events TO service_role;

CREATE TRIGGER trg_artifact_change_proposals_updated_at
  BEFORE UPDATE ON artifact_change_proposals
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();
CREATE TRIGGER trg_artifact_human_authorities_updated_at
  BEFORE UPDATE ON artifact_human_authorities
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();

-- The event and accepted-revision ledgers are append-only to the runtime role.
REVOKE UPDATE, DELETE ON artifact_review_events FROM service_role;
REVOKE UPDATE, DELETE ON artifact_revisions FROM service_role;
REVOKE DELETE ON artifact_change_proposals FROM service_role;

-- ─── Governance helpers ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION artifact_status_transition_allowed(
  p_from TEXT,
  p_to TEXT
)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    p_from = p_to
    OR (p_from = 'draft'      AND p_to IN ('active', 'archived'))
    OR (p_from = 'active'     AND p_to IN ('draft', 'archived', 'superseded'))
    OR (p_from = 'archived'   AND p_to IN ('draft', 'active'))
    OR (p_from = 'superseded' AND p_to = 'archived');
$$;

CREATE OR REPLACE FUNCTION artifact_patch_requires_human(p_ops JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_ops, '[]'::jsonb)) op
    WHERE op->>'op' IN ('set_artifact_status', 'set_review_policy')
       OR (
         op->>'op' = 'update_artifact_metadata'
         AND (
           COALESCE(op->'metadata_patch', '{}'::jsonb) ? 'authority_level'
           OR COALESCE(op->'metadata_patch', '{}'::jsonb) ? 'tags'
         )
       )
  );
$$;

CREATE OR REPLACE FUNCTION validate_artifact_patch_ops(p_ops JSONB)
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_op JSONB;
  v_kind TEXT;
  v_path TEXT;
  v_unknown TEXT;
BEGIN
  IF p_ops IS NULL OR jsonb_typeof(p_ops) <> 'array' OR jsonb_array_length(p_ops) = 0 THEN
    RAISE EXCEPTION 'EMPTY_PATCH: ops must be a non-empty array';
  END IF;

  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    IF jsonb_typeof(v_op) <> 'object' THEN
      RAISE EXCEPTION 'BAD_OP: every patch operation must be an object';
    END IF;

    v_kind := v_op->>'op';
    IF v_kind NOT IN (
      'create_block', 'replace_block', 'append_block', 'delete_block',
      'rename_block', 'update_block_metadata', 'update_artifact_metadata',
      'set_artifact_status', 'set_review_policy'
    ) THEN
      RAISE EXCEPTION 'UNKNOWN_OP: unsupported op "%"', v_kind;
    END IF;

    SELECT fields.key INTO v_unknown
    FROM jsonb_object_keys(v_op) AS fields(key)
    WHERE NOT (
      (v_kind = 'create_block'
        AND fields.key IN ('op', 'path', 'content', 'title', 'sort_order', 'metadata'))
      OR (v_kind = 'replace_block'
        AND fields.key IN ('op', 'path', 'content', 'title', 'expected_hash', 'metadata'))
      OR (v_kind = 'append_block'
        AND fields.key IN ('op', 'path', 'content', 'title', 'expected_hash', 'create_if_missing'))
      OR (v_kind = 'delete_block'
        AND fields.key IN ('op', 'path', 'expected_hash'))
      OR (v_kind = 'rename_block'
        AND fields.key IN ('op', 'from_path', 'to_path', 'expected_hash'))
      OR (v_kind = 'update_block_metadata'
        AND fields.key IN ('op', 'path', 'expected_hash', 'metadata_patch'))
      OR (v_kind = 'update_artifact_metadata'
        AND fields.key IN ('op', 'metadata_patch'))
      OR (v_kind = 'set_artifact_status'
        AND fields.key IN ('op', 'status'))
      OR (v_kind = 'set_review_policy'
        AND fields.key IN ('op', 'review_policy'))
    )
    LIMIT 1;
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'BAD_OP_FIELD: field "%" is not valid for %', v_unknown, v_kind;
    END IF;

    IF v_kind IN (
      'create_block', 'replace_block', 'append_block', 'delete_block',
      'update_block_metadata'
    ) THEN
      v_path := v_op->>'path';
      IF v_path IS NULL OR left(v_path, 1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: % path must start with "/" (got %)', v_kind, v_path;
      END IF;
    END IF;

    IF v_kind IN ('create_block', 'replace_block', 'append_block')
       AND jsonb_typeof(v_op->'content') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'BAD_OP: % requires string content', v_kind;
    END IF;
    IF v_op ? 'expected_hash'
       AND jsonb_typeof(v_op->'expected_hash') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'BAD_OP: expected_hash must be a string';
    END IF;
    IF v_op ? 'title' AND jsonb_typeof(v_op->'title') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'BAD_OP: title must be a string';
    END IF;
    IF v_op ? 'sort_order'
       AND (
         jsonb_typeof(v_op->'sort_order') IS DISTINCT FROM 'number'
         OR (v_op->>'sort_order') !~ '^-?[0-9]+$'
       ) THEN
      RAISE EXCEPTION 'BAD_OP: sort_order must be an integer';
    END IF;
    IF v_op ? 'create_if_missing'
       AND jsonb_typeof(v_op->'create_if_missing') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'BAD_OP: create_if_missing must be a boolean';
    END IF;
    IF v_op ? 'metadata'
       AND jsonb_typeof(v_op->'metadata') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'BAD_OP: metadata must be an object';
    END IF;
    IF v_op ? 'metadata_patch'
       AND jsonb_typeof(v_op->'metadata_patch') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'BAD_OP: metadata_patch must be an object';
    END IF;

    IF v_kind = 'rename_block' THEN
      IF v_op->>'from_path' IS NULL OR left(v_op->>'from_path', 1) <> '/'
         OR v_op->>'to_path' IS NULL OR left(v_op->>'to_path', 1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: rename_block requires absolute from_path and to_path';
      END IF;
    ELSIF v_kind IN ('update_block_metadata', 'update_artifact_metadata')
       AND NOT (v_op ? 'metadata_patch') THEN
      RAISE EXCEPTION 'BAD_OP: % requires metadata_patch', v_kind;
    ELSIF v_kind = 'set_artifact_status'
       AND v_op->>'status' NOT IN ('active', 'draft', 'archived', 'superseded') THEN
      RAISE EXCEPTION 'BAD_OP: invalid artifact status';
    ELSIF v_kind = 'set_review_policy'
       AND v_op->>'review_policy' NOT IN ('live_audit', 'human_gate') THEN
      RAISE EXCEPTION 'BAD_OP: invalid review policy';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION artifact_authenticated_human_principal()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_principal_id TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'HUMAN_AUTH_REQUIRED: authenticated human principal required';
  END IF;

  SELECT principal_id INTO v_principal_id
  FROM artifact_human_authorities
  WHERE user_id = auth.uid() AND active = true;

  IF v_principal_id IS NULL THEN
    RAISE EXCEPTION 'HUMAN_AUTHORITY_REQUIRED: authenticated user is not an active artifact reviewer';
  END IF;
  RETURN v_principal_id;
END;
$$;

-- ─── Snapshot helpers ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION artifact_block_state(
  p_artifact_id UUID,
  p_include_archived BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'path', b.path,
        'title', b.title,
        'content', b.content,
        'content_hash', b.content_hash,
        'version', b.version,
        'sort_order', b.sort_order,
        'metadata', b.metadata
      )
      ORDER BY b.sort_order, b.path
    ),
    '[]'::jsonb
  )
  FROM artifact_blocks b
  WHERE b.artifact_id = p_artifact_id
    AND (
      p_include_archived
      OR COALESCE(b.metadata->>'status', '') <> 'archived'
    );
$$;

CREATE OR REPLACE FUNCTION artifact_compiled_markdown(p_artifact_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    '# ' || a.title || E'\n\n' ||
    'Artifact key: `' || a.key || E'`\n' ||
    'Version: ' || a.current_version || E'\n' ||
    'Kind: ' || a.kind || E'\n\n---\n\n' ||
    COALESCE(
      string_agg(
        '## ' || COALESCE(b.title, initcap(replace(trim(leading '/' FROM b.path), '_', ' '))) ||
        E'\n\n' || b.content,
        E'\n\n'
        ORDER BY b.sort_order, b.path
      ),
      ''
    ) || E'\n'
  FROM artifacts a
  LEFT JOIN artifact_blocks b
    ON b.artifact_id = a.id
   AND COALESCE(b.metadata->>'status', '') <> 'archived'
  WHERE a.id = p_artifact_id
  GROUP BY a.id, a.title, a.key, a.current_version, a.kind;
$$;

CREATE OR REPLACE FUNCTION write_artifact_snapshot(
  p_artifact_id UUID,
  p_version INTEGER,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_content TEXT;
  v_hash TEXT;
  v_state JSONB;
  v_id UUID;
  v_current_version INTEGER;
BEGIN
  SELECT current_version INTO v_current_version
  FROM artifacts
  WHERE id = p_artifact_id;
  IF v_current_version IS NULL THEN
    RAISE EXCEPTION 'ARTIFACT_NOT_FOUND: %', p_artifact_id;
  END IF;
  IF p_version <> v_current_version THEN
    RAISE EXCEPTION 'SNAPSHOT_VERSION_MISMATCH: current version is %, requested %',
      v_current_version, p_version;
  END IF;

  v_content := artifact_compiled_markdown(p_artifact_id);
  v_hash := encode(digest(COALESCE(v_content, ''), 'sha256'), 'hex');
  v_state := artifact_block_state(p_artifact_id, true);

  INSERT INTO artifact_snapshots (
    artifact_id, version, compiled_content, content_hash, block_state, metadata
  )
  VALUES (
    p_artifact_id, p_version, COALESCE(v_content, ''), v_hash, v_state,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('reconstructable', true)
  )
  ON CONFLICT (artifact_id, version) DO UPDATE
  SET
    compiled_content = EXCLUDED.compiled_content,
    content_hash = EXCLUDED.content_hash,
    block_state = EXCLUDED.block_state,
    metadata = artifact_snapshots.metadata || EXCLUDED.metadata || jsonb_build_object('reconstructable', true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Historical v2 snapshots without block_state remain useful compiled views but
-- are not claimed as exactly reconstructable.
UPDATE artifact_snapshots
SET metadata = metadata || jsonb_build_object('reconstructable', false)
WHERE block_state = '[]'::jsonb;

-- Establish one exact baseline for every currently accepted artifact version.
INSERT INTO artifact_snapshots (
  artifact_id, version, compiled_content, content_hash, block_state, metadata
)
SELECT
  a.id,
  a.current_version,
  artifact_compiled_markdown(a.id),
  encode(digest(artifact_compiled_markdown(a.id), 'sha256'), 'hex'),
  artifact_block_state(a.id, true),
  jsonb_build_object('source', 'artifact_v3_baseline', 'reconstructable', true)
FROM artifacts a
ON CONFLICT (artifact_id, version) DO UPDATE
SET
  compiled_content = EXCLUDED.compiled_content,
  content_hash = EXCLUDED.content_hash,
  block_state = EXCLUDED.block_state,
  metadata = artifact_snapshots.metadata || EXCLUDED.metadata;

-- ─── v3 patch engine: block + artifact operations + mandatory snapshots ─────

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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_artifact_id   UUID;
  v_current       INTEGER;
  v_review_policy TEXT;
  v_status        TEXT;
  v_new_version   INTEGER;
  v_op            JSONB;
  v_kind          TEXT;
  v_path          TEXT;
  v_to_path       TEXT;
  v_content       TEXT;
  v_expected      TEXT;
  v_existing      RECORD;
  v_new_content   TEXT;
  v_hash          TEXT;
  v_block_id      UUID;
  v_changed       JSONB := '[]'::jsonb;
  v_changed_paths TEXT[] := ARRAY[]::TEXT[];
  v_actor_type    TEXT;
  v_actor_id      TEXT;
  v_authority_path TEXT;
BEGIN
  SELECT id, current_version, review_policy, status
  INTO v_artifact_id, v_current, v_review_policy, v_status
  FROM artifacts WHERE key = p_key FOR UPDATE;

  IF v_artifact_id IS NULL THEN
    RAISE EXCEPTION 'ARTIFACT_NOT_FOUND: no artifact with key %', p_key;
  END IF;
  IF v_current <> p_base_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: artifact % is at version %, but patch was based on version %',
      p_key, v_current, p_base_version;
  END IF;
  PERFORM validate_artifact_patch_ops(p_ops);

  v_authority_path := COALESCE(p_metadata->>'authority_path', 'agent');
  IF v_authority_path NOT IN ('agent', 'human', 'system_import') THEN
    RAISE EXCEPTION 'BAD_AUTHORITY_PATH: %', v_authority_path;
  END IF;
  IF v_review_policy = 'human_gate' AND v_authority_path <> 'human' THEN
    RAISE EXCEPTION 'HUMAN_GATE_REQUIRED: artifact % requires authenticated human review', p_key;
  END IF;
  IF artifact_patch_requires_human(p_ops) AND v_authority_path <> 'human' THEN
    RAISE EXCEPTION 'HUMAN_AUTHORITY_REQUIRED: artifact authority, lifecycle, and review-policy changes require authenticated human authority';
  END IF;

  v_actor_type := CASE
    WHEN v_authority_path = 'human' THEN 'human'
    WHEN v_authority_path = 'system_import' AND p_actor LIKE 'system:%' THEN 'system'
    WHEN v_authority_path = 'system_import' THEN 'import'
    ELSE 'agent'
  END;
  v_actor_id := CASE
    WHEN position(':' IN p_actor) > 0 THEN split_part(p_actor, ':', 2)
    ELSE p_actor
  END;
  v_new_version := v_current + 1;

  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_kind     := v_op->>'op';
    v_path     := v_op->>'path';
    v_content  := v_op->>'content';
    v_expected := v_op->>'expected_hash';

    SELECT * INTO v_existing FROM artifact_blocks
      WHERE artifact_id = v_artifact_id AND path = v_path;

    IF v_kind = 'create_block' THEN
      IF v_path IS NULL OR left(v_path, 1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: create_block path must start with "/" (got %)', v_path;
      END IF;
      IF FOUND THEN RAISE EXCEPTION 'PATH_EXISTS: block % already exists', v_path; END IF;
      IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: create_block % requires content', v_path; END IF;
      v_hash := encode(digest(v_content, 'sha256'), 'hex');
      INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order, metadata)
      VALUES (
        v_artifact_id, v_path, v_op->>'title', v_content, v_hash, v_new_version,
        COALESCE((v_op->>'sort_order')::int, 0), COALESCE(v_op->'metadata', '{}'::jsonb)
      )
      RETURNING id INTO v_block_id;
      v_changed := v_changed || jsonb_build_object(
        'block_id', v_block_id, 'path', v_path, 'content', v_content,
        'content_hash', v_hash, 'action', 'upsert'
      );
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind IN ('replace_block', 'append_block', 'delete_block', 'update_block_metadata') THEN
      IF v_kind = 'append_block' AND NOT FOUND
         AND COALESCE((v_op->>'create_if_missing')::boolean, false) THEN
        IF v_path IS NULL OR left(v_path, 1) <> '/' THEN
          RAISE EXCEPTION 'BAD_PATH: append_block path must start with "/" (got %)', v_path;
        END IF;
        IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: append_block % requires content', v_path; END IF;
        v_hash := encode(digest(v_content, 'sha256'), 'hex');
        INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order)
        VALUES (v_artifact_id, v_path, v_op->>'title', v_content, v_hash, v_new_version, 0)
        RETURNING id INTO v_block_id;
        v_changed := v_changed || jsonb_build_object(
          'block_id', v_block_id, 'path', v_path, 'content', v_content,
          'content_hash', v_hash, 'action', 'upsert'
        );
        v_changed_paths := array_append(v_changed_paths, v_path);
        CONTINUE;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path; END IF;
      IF NOT p_admin AND v_expected IS NULL THEN
        RAISE EXCEPTION 'MISSING_EXPECTED_HASH: % on % requires expected_hash', v_kind, v_path;
      END IF;
      IF NOT p_admin AND v_expected IS NOT NULL AND v_expected <> v_existing.content_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_existing.content_hash;
      END IF;

      IF v_kind = 'replace_block' THEN
        IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: replace_block % requires content', v_path; END IF;
        v_hash := encode(digest(v_content, 'sha256'), 'hex');
        UPDATE artifact_blocks SET
          content = v_content,
          content_hash = v_hash,
          version = v_new_version,
          title = COALESCE(v_op->>'title', title),
          metadata = CASE WHEN v_op ? 'metadata' THEN metadata || (v_op->'metadata') ELSE metadata END
        WHERE id = v_existing.id;
        v_changed := v_changed || jsonb_build_object(
          'block_id', v_existing.id, 'path', v_path, 'content', v_content,
          'content_hash', v_hash, 'action', 'upsert'
        );

      ELSIF v_kind = 'append_block' THEN
        IF v_content IS NULL THEN RAISE EXCEPTION 'BAD_OP: append_block % requires content', v_path; END IF;
        v_new_content := CASE WHEN length(v_existing.content) > 0
          THEN v_existing.content || E'\n\n' || v_content ELSE v_content END;
        v_hash := encode(digest(v_new_content, 'sha256'), 'hex');
        UPDATE artifact_blocks
        SET content = v_new_content, content_hash = v_hash, version = v_new_version
        WHERE id = v_existing.id;
        v_changed := v_changed || jsonb_build_object(
          'block_id', v_existing.id, 'path', v_path, 'content', v_new_content,
          'content_hash', v_hash, 'action', 'upsert'
        );

      ELSIF v_kind = 'delete_block' THEN
        UPDATE artifact_blocks SET
          version = v_new_version,
          metadata = metadata || jsonb_build_object('status', 'archived', 'deleted_at', now())
        WHERE id = v_existing.id;
        v_changed := v_changed || jsonb_build_object(
          'block_id', v_existing.id, 'path', v_path, 'action', 'delete'
        );

      ELSE
        IF NOT (v_op ? 'metadata_patch') THEN
          RAISE EXCEPTION 'BAD_OP: update_block_metadata % requires metadata_patch', v_path;
        END IF;
        UPDATE artifact_blocks SET
          version = v_new_version,
          metadata = metadata || (v_op->'metadata_patch')
        WHERE id = v_existing.id;
        v_changed := v_changed || jsonb_build_object(
          'block_id', v_existing.id, 'path', v_path, 'action', 'noembed'
        );
      END IF;
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind = 'rename_block' THEN
      v_path := v_op->>'from_path';
      v_to_path := v_op->>'to_path';
      SELECT * INTO v_existing FROM artifact_blocks
      WHERE artifact_id = v_artifact_id AND path = v_path;
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path; END IF;
      IF EXISTS (SELECT 1 FROM artifact_blocks WHERE artifact_id = v_artifact_id AND path = v_to_path) THEN
        RAISE EXCEPTION 'PATH_EXISTS: target block % already exists', v_to_path;
      END IF;
      IF NOT p_admin AND v_expected IS NULL THEN
        RAISE EXCEPTION 'MISSING_EXPECTED_HASH: rename_block on % requires expected_hash', v_path;
      END IF;
      IF NOT p_admin AND v_expected IS NOT NULL AND v_expected <> v_existing.content_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_existing.content_hash;
      END IF;
      UPDATE artifact_blocks SET path = v_to_path, version = v_new_version WHERE id = v_existing.id;
      v_changed := v_changed || jsonb_build_object(
        'block_id', v_existing.id, 'path', v_to_path, 'old_path', v_path,
        'content', v_existing.content, 'content_hash', v_existing.content_hash, 'action', 'rename'
      );
      v_changed_paths := array_append(v_changed_paths, v_to_path);

    ELSIF v_kind = 'update_artifact_metadata' THEN
      IF NOT (v_op ? 'metadata_patch') THEN
        RAISE EXCEPTION 'BAD_OP: update_artifact_metadata requires metadata_patch';
      END IF;
      UPDATE artifacts SET metadata = metadata || (v_op->'metadata_patch') WHERE id = v_artifact_id;
      v_changed_paths := array_append(v_changed_paths, '/@metadata');
      v_changed := v_changed || jsonb_build_object('path', '/@metadata', 'action', 'noembed');

    ELSIF v_kind = 'set_artifact_status' THEN
      IF NOT artifact_status_transition_allowed(v_status, v_op->>'status') THEN
        RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % -> %', v_status, v_op->>'status';
      END IF;
      UPDATE artifacts SET status = v_op->>'status' WHERE id = v_artifact_id;
      v_status := v_op->>'status';
      v_changed_paths := array_append(v_changed_paths, '/@status');
      v_changed := v_changed || jsonb_build_object('path', '/@status', 'action', 'noembed');

    ELSIF v_kind = 'set_review_policy' THEN
      IF v_op->>'review_policy' NOT IN ('live_audit', 'human_gate') THEN
        RAISE EXCEPTION 'BAD_OP: set_review_policy requires live_audit or human_gate';
      END IF;
      UPDATE artifacts SET review_policy = v_op->>'review_policy' WHERE id = v_artifact_id;
      v_changed_paths := array_append(v_changed_paths, '/@review_policy');
      v_changed := v_changed || jsonb_build_object('path', '/@review_policy', 'action', 'noembed');

    ELSE
      RAISE EXCEPTION 'UNKNOWN_OP: unsupported op "%"', v_kind;
    END IF;
  END LOOP;

  -- Never leave stale vectors after a database-side/dashboard write. MCP writes
  -- immediately repopulate these rows; dashboard writes remain visibly missing
  -- until the next reindex/search sweep rather than returning obsolete content.
  FOR v_op IN SELECT value FROM jsonb_array_elements(v_changed) LOOP
    IF v_op->>'action' IN ('upsert', 'delete', 'rename') THEN
      DELETE FROM artifact_block_embeddings
      WHERE artifact_id = v_artifact_id
        AND block_path IN (v_op->>'path', v_op->>'old_path');
    END IF;
  END LOOP;

  UPDATE artifacts SET current_version = v_new_version WHERE id = v_artifact_id;

  INSERT INTO artifact_revisions (
    artifact_id, version, base_version, ops, summary, actor, actor_type, actor_id, source_refs, metadata
  )
  VALUES (
    v_artifact_id, v_new_version, p_base_version, p_ops, p_summary, p_actor,
    v_actor_type, v_actor_id, COALESCE(p_metadata->'source_refs', '{}'::jsonb), COALESCE(p_metadata, '{}'::jsonb)
  );

  PERFORM write_artifact_snapshot(
    v_artifact_id,
    v_new_version,
    jsonb_build_object('source', 'accepted_patch', 'actor_type', v_actor_type, 'actor_id', v_actor_id)
  );

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

CREATE OR REPLACE FUNCTION apply_artifact_agent_patch_tx(
  p_key          TEXT,
  p_base_version INTEGER,
  p_ops          JSONB,
  p_summary      TEXT,
  p_actor_id     TEXT DEFAULT 'mcp',
  p_source_refs  JSONB DEFAULT '{}'::jsonb,
  p_admin        BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN apply_artifact_patch(
    p_key,
    p_base_version,
    p_ops,
    p_summary,
    'agent:' || COALESCE(NULLIF(btrim(p_actor_id), ''), 'mcp'),
    jsonb_build_object(
      'authority_path', 'agent',
      'source_refs', COALESCE(p_source_refs, '{}'::jsonb)
    ),
    p_admin
  );
END;
$$;

CREATE OR REPLACE FUNCTION apply_artifact_human_patch_tx(
  p_key          TEXT,
  p_base_version INTEGER,
  p_ops          JSONB,
  p_summary      TEXT,
  p_source_refs  JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_principal_id TEXT;
BEGIN
  v_principal_id := artifact_authenticated_human_principal();
  RETURN apply_artifact_patch(
    p_key,
    p_base_version,
    p_ops,
    p_summary,
    'human:' || v_principal_id,
    jsonb_build_object(
      'authority_path', 'human',
      'source_refs', COALESCE(p_source_refs, '{}'::jsonb)
    ),
    false
  );
END;
$$;

-- ─── v3 create: sensitive agent artifacts begin draft + exact snapshot ──────

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
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_version INTEGER;
  v_block JSONB;
  v_path TEXT;
  v_content TEXT;
  v_hash TEXT;
  v_block_id UUID;
  v_created JSONB := '[]'::jsonb;
  v_ops JSONB := '[]'::jsonb;
  v_sensitive BOOLEAN;
  v_metadata JSONB;
  v_actor_type TEXT;
  v_actor_id TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM artifacts WHERE key = p_key) THEN
    RAISE EXCEPTION 'KEY_EXISTS: artifact key % already exists', p_key;
  END IF;

  v_sensitive := COALESCE(p_kind, 'document') IN ('policy', 'agent_instruction', 'prompt', 'sop', 'protocol')
    OR COALESCE(p_metadata->>'authority_level', '') IN ('approved_instruction', 'policy')
    OR COALESCE(p_metadata->'tags', '[]'::jsonb) @> '["boot"]'::jsonb;
  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  IF v_sensitive AND v_metadata->>'authority_level' IN ('approved_instruction', 'policy') THEN
    v_metadata := jsonb_set(v_metadata, '{requested_authority_level}', to_jsonb(v_metadata->>'authority_level'), true);
    v_metadata := jsonb_set(v_metadata, '{authority_level}', '"proposed_instruction"'::jsonb, true);
  END IF;

  -- The service-role create path is always an agent path. A caller cannot
  -- self-assert human identity by changing p_actor.
  v_actor_type := 'agent';
  v_actor_id := CASE WHEN position(':' IN p_actor) > 0 THEN split_part(p_actor, ':', 2) ELSE p_actor END;
  v_version := CASE
    WHEN p_blocks IS NOT NULL AND jsonb_typeof(p_blocks) = 'array' AND jsonb_array_length(p_blocks) > 0 THEN 1
    ELSE 0
  END;
  v_id := COALESCE(p_id, gen_random_uuid());

  INSERT INTO artifacts (id, key, title, kind, status, review_policy, current_version, metadata)
  VALUES (
    v_id, p_key, p_title, COALESCE(p_kind, 'document'),
    CASE WHEN v_sensitive AND v_actor_type = 'agent' THEN 'draft' ELSE 'active' END,
    CASE WHEN v_sensitive THEN 'human_gate' ELSE 'live_audit' END,
    v_version, v_metadata
  );

  IF v_version = 1 THEN
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
      v_path := v_block->>'path';
      v_content := COALESCE(v_block->>'content', '');
      IF v_path IS NULL OR left(v_path, 1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: block path must start with "/" (got %)', v_path;
      END IF;
      v_hash := encode(digest(v_content, 'sha256'), 'hex');
      INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order, metadata)
      VALUES (
        v_id, v_path, v_block->>'title', v_content, v_hash, 1,
        COALESCE((v_block->>'sort_order')::int, 0), COALESCE(v_block->'metadata', '{}'::jsonb)
      )
      RETURNING id INTO v_block_id;
      v_created := v_created || jsonb_build_object(
        'block_id', v_block_id, 'path', v_path, 'content', v_content, 'content_hash', v_hash
      );
      v_ops := v_ops || jsonb_build_object(
        'op', 'create_block', 'path', v_path, 'title', v_block->>'title',
        'content', v_content, 'sort_order', COALESCE((v_block->>'sort_order')::int, 0)
      );
    END LOOP;
  ELSE
    v_ops := jsonb_build_array(jsonb_build_object('op', 'create_artifact'));
  END IF;

  INSERT INTO artifact_revisions (
    artifact_id, version, base_version, ops, summary, actor, actor_type, actor_id, metadata
  )
  VALUES (
    v_id, v_version, 0, v_ops, 'Initial create', p_actor, v_actor_type, v_actor_id,
    jsonb_build_object('review_policy', CASE WHEN v_sensitive THEN 'human_gate' ELSE 'live_audit' END)
  );

  PERFORM write_artifact_snapshot(
    v_id, v_version,
    jsonb_build_object('source', 'initial_create', 'actor_type', v_actor_type, 'actor_id', v_actor_id)
  );

  RETURN jsonb_build_object(
    'artifact_id', v_id,
    'key', p_key,
    'version', v_version,
    'status', CASE WHEN v_sensitive AND v_actor_type = 'agent' THEN 'draft' ELSE 'active' END,
    'review_policy', CASE WHEN v_sensitive THEN 'human_gate' ELSE 'live_audit' END,
    'blocks', v_created
  );
END;
$$;

-- ─── Proposal and review transaction RPCs ───────────────────────────────────

CREATE OR REPLACE FUNCTION propose_artifact_patch_tx(
  p_key                    TEXT,
  p_base_version           INTEGER,
  p_ops                    JSONB,
  p_summary                TEXT,
  p_actor_type             TEXT DEFAULT 'agent',
  p_actor_id               TEXT DEFAULT 'mcp',
  p_source_refs            JSONB DEFAULT '{}'::jsonb,
  p_supersedes_proposal_id UUID DEFAULT NULL,
  p_metadata               JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_artifact RECORD;
  v_proposal_id UUID;
  v_op JSONB;
  v_kind TEXT;
  v_path TEXT;
  v_expected TEXT;
  v_found_hash TEXT;
BEGIN
  SELECT id, current_version, review_policy INTO v_artifact
  FROM artifacts WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ARTIFACT_NOT_FOUND: no artifact with key %', p_key; END IF;
  IF v_artifact.current_version <> p_base_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: artifact % is at version %, but proposal was based on version %',
      p_key, v_artifact.current_version, p_base_version;
  END IF;
  PERFORM validate_artifact_patch_ops(p_ops);
  IF p_actor_type NOT IN ('human', 'agent', 'system', 'import') THEN
    RAISE EXCEPTION 'BAD_ACTOR_TYPE: %', p_actor_type;
  END IF;

  -- Review proposals must carry hashes for every existing block they touch so
  -- approval can prove the proposal still applies to the reviewed referent.
  FOR v_op IN SELECT value FROM jsonb_array_elements(p_ops) LOOP
    v_kind := v_op->>'op';
    v_path := CASE WHEN v_kind = 'rename_block' THEN v_op->>'from_path' ELSE v_op->>'path' END;
    IF v_kind IN ('replace_block', 'append_block', 'delete_block', 'rename_block', 'update_block_metadata') THEN
      v_expected := v_op->>'expected_hash';
      SELECT content_hash INTO v_found_hash
      FROM artifact_blocks WHERE artifact_id = v_artifact.id AND path = v_path;
      IF NOT FOUND AND v_kind = 'append_block'
         AND COALESCE((v_op->>'create_if_missing')::boolean, false) THEN
        CONTINUE;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path; END IF;
      IF v_expected IS NULL THEN
        RAISE EXCEPTION 'MISSING_EXPECTED_HASH: proposal op % on % requires expected_hash', v_kind, v_path;
      END IF;
      IF v_expected <> v_found_hash THEN
        RAISE EXCEPTION 'HASH_CONFLICT: block % changed since it was read. Expected hash % but found %',
          v_path, v_expected, v_found_hash;
      END IF;
    END IF;
  END LOOP;

  IF p_supersedes_proposal_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM artifact_change_proposals
      WHERE id = p_supersedes_proposal_id
        AND artifact_id = v_artifact.id
        AND status IN ('pending', 'revision_requested')
    ) THEN
      RAISE EXCEPTION 'SUPERSEDED_PROPOSAL_NOT_OPEN: %', p_supersedes_proposal_id;
    END IF;
    UPDATE artifact_change_proposals
    SET status = 'superseded'
    WHERE id = p_supersedes_proposal_id
      AND artifact_id = v_artifact.id
      AND status IN ('pending', 'revision_requested');
    INSERT INTO artifact_review_events (artifact_id, proposal_id, event_type, actor_type, actor_id, payload)
    VALUES (
      v_artifact.id, p_supersedes_proposal_id, 'superseded', p_actor_type, p_actor_id,
      jsonb_build_object('superseded_by_pending_proposal', true)
    );
  END IF;

  INSERT INTO artifact_change_proposals (
    artifact_id, base_version, ops, summary, proposer_actor_type, proposer_actor_id,
    source_refs, review_policy_at_proposal, supersedes_proposal_id, metadata
  )
  VALUES (
    v_artifact.id, p_base_version, p_ops, p_summary, p_actor_type, p_actor_id,
    COALESCE(p_source_refs, '{}'::jsonb), v_artifact.review_policy, p_supersedes_proposal_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_proposal_id;

  INSERT INTO artifact_review_events (artifact_id, proposal_id, event_type, actor_type, actor_id, payload)
  VALUES (
    v_artifact.id, v_proposal_id, 'proposed', p_actor_type, p_actor_id,
    jsonb_build_object(
      'base_version', p_base_version,
      'summary', p_summary,
      'ops', p_ops,
      'source_refs', COALESCE(p_source_refs, '{}'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'proposal_id', v_proposal_id,
    'key', p_key,
    'base_version', p_base_version,
    'status', 'pending',
    'review_policy', v_artifact.review_policy
  );
END;
$$;

DROP FUNCTION IF EXISTS review_artifact_change_tx(UUID, TEXT, TEXT, TEXT, TEXT, JSONB);

CREATE FUNCTION review_artifact_change_tx(
  p_proposal_id      UUID,
  p_action           TEXT,
  p_reason           TEXT DEFAULT NULL,
  p_replacement_ops  JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_proposal RECORD;
  v_artifact RECORD;
  v_ops JSONB;
  v_result JSONB;
  v_error TEXT;
  v_event_type TEXT;
  v_reviewer_id TEXT;
BEGIN
  v_reviewer_id := artifact_authenticated_human_principal();

  SELECT * INTO v_proposal
  FROM artifact_change_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: %', p_proposal_id; END IF;
  IF v_proposal.status NOT IN ('pending', 'revision_requested') THEN
    RAISE EXCEPTION 'PROPOSAL_CLOSED: proposal % is %', p_proposal_id, v_proposal.status;
  END IF;
  IF p_action IN ('reject', 'request_revision') AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'REVIEW_REASON_REQUIRED: % requires a reason', p_action;
  END IF;

  SELECT * INTO v_artifact FROM artifacts WHERE id = v_proposal.artifact_id FOR UPDATE;

  IF p_action IN ('approve', 'edit_and_approve') THEN
    v_ops := CASE WHEN p_action = 'edit_and_approve' THEN p_replacement_ops ELSE v_proposal.ops END;
    IF v_ops IS NULL OR jsonb_typeof(v_ops) <> 'array' OR jsonb_array_length(v_ops) = 0 THEN
      RAISE EXCEPTION 'EMPTY_PATCH: approval ops must be a non-empty array';
    END IF;
    PERFORM validate_artifact_patch_ops(v_ops);

    BEGIN
      SELECT apply_artifact_patch(
        v_artifact.key,
        v_proposal.base_version,
        v_ops,
        CASE WHEN p_action = 'edit_and_approve'
          THEN v_proposal.summary || ' [edited during approval]'
          ELSE v_proposal.summary
        END,
        'human:' || v_reviewer_id,
        jsonb_build_object(
          'authority_path', 'human',
          'source_refs', v_proposal.source_refs,
          'proposal_id', v_proposal.id,
          'review_action', p_action
        ),
        false
      ) INTO v_result;
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
      UPDATE artifact_change_proposals SET
        status = 'conflicted',
        review_reason = v_error,
        reviewed_by_type = 'human',
        reviewed_by_id = v_reviewer_id,
        reviewed_at = now()
      WHERE id = p_proposal_id;
      INSERT INTO artifact_review_events (
        artifact_id, proposal_id, event_type, actor_type, actor_id, reason, payload
      )
      VALUES (
        v_artifact.id, p_proposal_id, 'conflicted', 'human', v_reviewer_id,
        v_error, jsonb_build_object('action', p_action)
      );
      RETURN jsonb_build_object('proposal_id', p_proposal_id, 'status', 'conflicted', 'error', v_error);
    END;

    v_event_type := CASE WHEN p_action = 'edit_and_approve' THEN 'edited_and_approved' ELSE 'approved' END;
    UPDATE artifact_change_proposals SET
      status = 'approved',
      ops = v_ops,
      review_reason = p_reason,
      reviewed_by_type = 'human',
      reviewed_by_id = v_reviewer_id,
      reviewed_at = now(),
      applied_version = (v_result->>'new_version')::integer
    WHERE id = p_proposal_id;
    INSERT INTO artifact_review_events (
      artifact_id, proposal_id, event_type, actor_type, actor_id, reason, payload
    )
    VALUES (
      v_artifact.id, p_proposal_id, v_event_type, 'human', v_reviewer_id,
      p_reason, v_result
    );
    RETURN jsonb_build_object(
      'proposal_id', p_proposal_id,
      'status', 'approved',
      'patch_result', v_result
    );
  END IF;

  IF p_action = 'reject' THEN
    v_event_type := 'rejected';
  ELSIF p_action = 'request_revision' THEN
    v_event_type := 'revision_requested';
  ELSIF p_action = 'supersede' THEN
    v_event_type := 'superseded';
  ELSE
    RAISE EXCEPTION 'BAD_REVIEW_ACTION: %', p_action;
  END IF;

  UPDATE artifact_change_proposals SET
    status = v_event_type,
    review_reason = p_reason,
    reviewed_by_type = 'human',
    reviewed_by_id = v_reviewer_id,
    reviewed_at = now()
  WHERE id = p_proposal_id;
  INSERT INTO artifact_review_events (
    artifact_id, proposal_id, event_type, actor_type, actor_id, reason
  )
  VALUES (
    v_artifact.id, p_proposal_id, v_event_type, 'human', v_reviewer_id, p_reason
  );
  RETURN jsonb_build_object('proposal_id', p_proposal_id, 'status', v_event_type);
END;
$$;

-- ─── Active-by-default artifact search ──────────────────────────────────────

DROP FUNCTION IF EXISTS match_artifact_blocks(vector(1536), float, int, text, text);

CREATE FUNCTION match_artifact_blocks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.38,
  match_count     int   DEFAULT 10,
  filter_kind     text  DEFAULT NULL,
  filter_key      text  DEFAULT NULL,
  filter_status   text  DEFAULT 'active'
)
RETURNS TABLE (
  artifact_id    uuid,
  artifact_key   text,
  artifact_title text,
  kind           text,
  artifact_status text,
  block_id       uuid,
  block_path     text,
  block_title    text,
  content        text,
  chunk_index    int,
  similarity     float
)
LANGUAGE sql STABLE AS $$
  SELECT
    a.id, a.key, a.title, a.kind, a.status,
    abe.block_id, abe.block_path, b.title,
    abe.content, abe.chunk_index,
    1 - (abe.embedding <=> query_embedding) AS similarity
  FROM artifact_block_embeddings abe
  JOIN artifacts a ON a.id = abe.artifact_id
  LEFT JOIN artifact_blocks b ON b.id = abe.block_id
  WHERE
    abe.embedding IS NOT NULL
    AND 1 - (abe.embedding <=> query_embedding) >= match_threshold
    AND (b.id IS NULL OR COALESCE(b.metadata->>'status', '') <> 'archived')
    AND (filter_kind IS NULL OR a.kind = filter_kind)
    AND (filter_key IS NULL OR a.key = filter_key)
    AND (filter_status IS NULL OR a.status = filter_status)
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

-- ─── Permissions ─────────────────────────────────────────────────────────────

REVOKE ALL ON artifacts FROM service_role;
REVOKE ALL ON artifact_blocks FROM service_role;
REVOKE ALL ON artifact_revisions FROM service_role;
REVOKE ALL ON artifact_snapshots FROM service_role;
REVOKE ALL ON artifact_change_proposals FROM service_role;
REVOKE ALL ON artifact_review_events FROM service_role;
REVOKE ALL ON artifact_human_authorities FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON artifacts TO service_role;
GRANT SELECT ON artifact_blocks TO service_role;
GRANT SELECT ON artifact_revisions TO service_role;
GRANT SELECT ON artifact_snapshots TO service_role;
GRANT SELECT ON artifact_change_proposals TO service_role;
GRANT SELECT ON artifact_review_events TO service_role;

REVOKE ALL ON FUNCTION artifact_status_transition_allowed(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION artifact_patch_requires_human(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION validate_artifact_patch_ops(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION artifact_authenticated_human_principal() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION artifact_block_state(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION artifact_compiled_markdown(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION write_artifact_snapshot(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_artifact_patch(text, integer, jsonb, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION apply_artifact_agent_patch_tx(text, integer, jsonb, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_artifact_human_patch_tx(text, integer, jsonb, text, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION create_artifact_v2(text, text, text, jsonb, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION propose_artifact_patch_tx(text, integer, jsonb, text, text, text, jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION review_artifact_change_tx(uuid, text, text, jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION match_artifact_blocks(vector(1536), float, int, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION artifact_block_state(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION artifact_compiled_markdown(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION write_artifact_snapshot(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION apply_artifact_agent_patch_tx(text, integer, jsonb, text, text, jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION apply_artifact_human_patch_tx(text, integer, jsonb, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_artifact_v2(text, text, text, jsonb, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION propose_artifact_patch_tx(text, integer, jsonb, text, text, text, jsonb, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION review_artifact_change_tx(uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION match_artifact_blocks(vector(1536), float, int, text, text, text) TO service_role;

-- ─── Postflight assertions ───────────────────────────────────────────────────

DO $$
DECLARE
  v_missing_baselines INTEGER;
BEGIN
  SELECT count(*) INTO v_missing_baselines
  FROM artifacts a
  LEFT JOIN artifact_snapshots s
    ON s.artifact_id = a.id
   AND s.version = a.current_version
   AND s.metadata->>'reconstructable' = 'true'
  WHERE s.id IS NULL;

  IF v_missing_baselines > 0 THEN
    RAISE EXCEPTION 'Artifact v3 postflight failed: % current artifact version(s) lack reconstructable snapshots',
      v_missing_baselines;
  END IF;

  IF has_function_privilege(
    'service_role',
    'apply_artifact_patch(text, integer, jsonb, text, text, jsonb, boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'apply_artifact_human_patch_tx(text, integer, jsonb, text, jsonb)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'review_artifact_change_tx(uuid, text, text, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Artifact v3 postflight failed: service_role retains raw apply or human review authority';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'apply_artifact_agent_patch_tx(text, integer, jsonb, text, text, jsonb, boolean)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'review_artifact_change_tx(uuid, text, text, jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Artifact v3 postflight failed: agent or authenticated-human wrapper grants are missing';
  END IF;

  IF has_table_privilege('service_role', 'artifacts', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'artifact_blocks', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'artifact_revisions', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'artifact_snapshots', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'artifact_change_proposals', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'artifact_review_events', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'artifact_human_authorities', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'Artifact v3 postflight failed: service_role retains direct canonical mutation privileges';
  END IF;
END;
$$;
