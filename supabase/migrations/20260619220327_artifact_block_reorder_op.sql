-- Migration: content-free block reorder op (set_block_sort_order) + strict-total-order guard
-- Source design: ECB artifact `fix-spec-migration-sort-order-integrity` (v1),
--   from BRAIN thoughts 5fd9ecd5 (migration sort_order defect) and 79711bda
--   (strict-total-order integrity check). Lane C / W8b.
--
-- WHAT THIS ADDS
--   1. A new patch op `set_block_sort_order { path, sort_order }` inside the
--      existing apply_artifact_patch op-processor. It updates ONLY a block's
--      sort_order (+ version); content and content_hash are untouched. Because
--      it is an op inside patch_artifact (not a standalone RPC) it inherits
--      proposal-routing and the human_gate exactly like every other op.
--   2. A strict-total-order guard that fires ONLY when the patch batch contains
--      at least one set_block_sort_order op. After applying the batch, the live
--      (non-archived) blocks must form a strict total order: no zeros/nulls and
--      no duplicate sort_order values, else the whole transaction is rejected.
--      SCOPING IS LOAD-BEARING: ~140 existing artifacts currently sit at
--      sort_order=0 (mostly single-block). A blanket post-condition would brick
--      the normal write path for all of them, so the guard is opt-in via the
--      presence of a reorder op (the explicit "I am establishing order" signal).
--   3. validate_artifact_patch_ops accepts the new op (type + field allowlist +
--      required sort_order).
--
-- The companion migration fix (replace_artifact_body assigning parse-order
-- sort_order) is in the edge-function TS layer: it now appends one
-- set_block_sort_order op per final block in parse order, which both fixes the
-- order AND routes through this same guard.
--
-- Both functions are CREATE OR REPLACE re-declarations carried forward verbatim
-- from their current authoritative bodies (validate: 20260605010000;
-- apply_artifact_patch: 20260614120000) with only the additions above. Grants
-- and ownership are preserved by CREATE OR REPLACE.

-- ─────────────────────────────────────────────────────────────────────────────
-- validate_artifact_patch_ops  (+ set_block_sort_order)
-- ─────────────────────────────────────────────────────────────────────────────
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
      'set_artifact_status', 'set_review_policy', 'set_block_sort_order'
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
      OR (v_kind = 'set_block_sort_order'
        AND fields.key IN ('op', 'path', 'sort_order'))
    )
    LIMIT 1;
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'BAD_OP_FIELD: field "%" is not valid for %', v_unknown, v_kind;
    END IF;

    IF v_kind IN (
      'create_block', 'replace_block', 'append_block', 'delete_block',
      'update_block_metadata', 'set_block_sort_order'
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
    ELSIF v_kind = 'set_block_sort_order'
       AND NOT (v_op ? 'sort_order') THEN
      RAISE EXCEPTION 'BAD_OP: set_block_sort_order requires sort_order';
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- apply_artifact_patch  (+ set_block_sort_order branch + strict-total-order guard)
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_zero_count    INTEGER;
  v_dup_count     INTEGER;
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
      -- An archived block (soft-deleted: path + content_hash preserved, only
      -- metadata.status flipped) is treated as missing for every op except
      -- update_block_metadata, which remains the sole "undelete" path.
      IF NOT FOUND OR (v_kind <> 'update_block_metadata' AND COALESCE(v_existing.metadata->>'status', '') = 'archived') THEN
        RAISE EXCEPTION 'MISSING_PATH: block % does not exist (it may have been deleted)', v_path;
      END IF;
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

    ELSIF v_kind = 'set_block_sort_order' THEN
      -- Content-free reorder: updates ONLY sort_order (+ version bump). Content
      -- and content_hash are left untouched, so no re-embedding is needed.
      IF v_path IS NULL OR left(v_path, 1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: set_block_sort_order path must start with "/" (got %)', v_path;
      END IF;
      IF NOT (v_op ? 'sort_order') THEN
        RAISE EXCEPTION 'BAD_OP: set_block_sort_order % requires sort_order', v_path;
      END IF;
      IF NOT FOUND OR COALESCE(v_existing.metadata->>'status', '') = 'archived' THEN
        RAISE EXCEPTION 'MISSING_PATH: block % does not exist (it may have been deleted)', v_path;
      END IF;
      UPDATE artifact_blocks SET
        sort_order = (v_op->>'sort_order')::int,
        version = v_new_version
      WHERE id = v_existing.id;
      v_changed := v_changed || jsonb_build_object(
        'block_id', v_existing.id, 'path', v_path, 'action', 'noembed'
      );
      v_changed_paths := array_append(v_changed_paths, v_path);

    ELSIF v_kind = 'rename_block' THEN
      v_path := v_op->>'from_path';
      v_to_path := v_op->>'to_path';
      SELECT * INTO v_existing FROM artifact_blocks
      WHERE artifact_id = v_artifact_id AND path = v_path;
      IF NOT FOUND OR COALESCE(v_existing.metadata->>'status', '') = 'archived' THEN
        RAISE EXCEPTION 'MISSING_PATH: block % does not exist (it may have been deleted)', v_path;
      END IF;
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

  -- Strict-total-order guard (BRAIN 79711bda). Fires ONLY when this patch
  -- explicitly reorders blocks (contains a set_block_sort_order op). Scoping to
  -- the reorder op keeps the normal write path safe for the ~140 legacy
  -- artifacts that still sit at sort_order=0; a reorder asserts intent to
  -- establish order, so its result must be a strict total order over live
  -- (non-archived) blocks: no zeros/nulls and no duplicate sort_order values.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_ops) o WHERE o->>'op' = 'set_block_sort_order'
  ) THEN
    SELECT
      count(*) FILTER (WHERE sort_order IS NULL OR sort_order = 0),
      count(*) - count(DISTINCT sort_order)
    INTO v_zero_count, v_dup_count
    FROM artifact_blocks
    WHERE artifact_id = v_artifact_id
      AND COALESCE(metadata->>'status', '') <> 'archived';
    IF v_zero_count > 0 OR v_dup_count > 0 THEN
      RAISE EXCEPTION 'SORT_ORDER_NOT_TOTAL: live block sort_order must form a strict total order after a reorder (no zeros, no collisions); found % zero/null and % duplicate slot(s). Reorder ALL live blocks in one patch.',
        v_zero_count, v_dup_count;
    END IF;
  END IF;

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

COMMENT ON FUNCTION apply_artifact_patch(TEXT, INTEGER, JSONB, TEXT, TEXT, JSONB, BOOLEAN) IS
  'v2 block-level patch applier. Ops: create_block, replace_block, append_block, delete_block, rename_block, update_block_metadata, set_block_sort_order (content-free reorder), update_artifact_metadata, set_artifact_status, set_review_policy. A batch containing set_block_sort_order triggers a strict-total-order guard over live blocks (no zeros, no collisions). Authority/lifecycle/policy ops and human_gate artifacts require authority_path=human.';
