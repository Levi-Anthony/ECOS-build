
-- Artifact proposal conflict / dead-end recovery (minimal, surgical fix).
--
-- Two changes, both additive and reversible (full CREATE OR REPLACE of the
-- existing functions — no schema/table changes):
--
-- 1. apply_artifact_patch / propose_artifact_patch_tx: an op that targets an
--    existing-block path (replace_block, append_block, delete_block,
--    rename_block's from_path) now treats an ARCHIVED block (soft-deleted via
--    delete_block, which leaves path + content_hash unchanged and only flips
--    metadata.status='archived') as MISSING_PATH instead of silently
--    succeeding. Previously such an op could pass both the FOUND check and
--    the expected_hash check (content_hash is untouched by delete_block) and
--    write fresh content into a block that remains archived/invisible to
--    get_artifact_manifest, get_artifact_snapshot, and search — a "successful"
--    proposal/patch whose effect is silently invisible.
--    update_block_metadata is intentionally EXEMPTED from this check: it
--    remains the only way to "undelete" a block (metadata_patch clearing
--    status: archived), matching its existing pre-archive hash semantics.
--
-- 2. propose_artifact_patch_tx: a corrective proposal may now set
--    p_supersedes_proposal_id to a proposal whose status is 'conflicted' (in
--    addition to the existing 'pending'/'revision_requested'). The conflicted
--    proposal's status transitions to 'superseded', preserving its
--    review_reason / review event trail (the original conflict diagnosis is
--    not lost — it remains in artifact_review_events). This closes the
--    provenance-chain gap where a conflicted proposal could never be linked
--    to the corrective proposal that followed it.
--
-- Does NOT change: status/review_policy/authority_level semantics, table
-- schema, RLS, or the human-gate/Two-Door authority model.

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
  v_found_archived BOOLEAN;
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
      SELECT content_hash, (COALESCE(metadata->>'status', '') = 'archived')
        INTO v_found_hash, v_found_archived
      FROM artifact_blocks WHERE artifact_id = v_artifact.id AND path = v_path;
      IF NOT FOUND AND v_kind = 'append_block'
         AND COALESCE((v_op->>'create_if_missing')::boolean, false) THEN
        CONTINUE;
      END IF;
      -- Mirror apply_artifact_patch: an archived (soft-deleted) block is
      -- MISSING_PATH for everything except update_block_metadata (undelete).
      IF NOT FOUND OR (v_kind <> 'update_block_metadata' AND v_found_archived) THEN
        RAISE EXCEPTION 'MISSING_PATH: block % does not exist', v_path;
      END IF;
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
    -- A 'conflicted' proposal (apply-time failure, e.g. version/hash drift)
    -- may now be superseded by a corrective proposal too, not just an open
    -- pending/revision_requested one. This closes the provenance-chain gap:
    -- previously a conflicted proposal could never be formally linked to the
    -- fix that followed it. Its review_reason and review event trail (which
    -- already recorded the conflict) are preserved; only its status moves to
    -- 'superseded'.
    IF NOT EXISTS (
      SELECT 1 FROM artifact_change_proposals
      WHERE id = p_supersedes_proposal_id
        AND artifact_id = v_artifact.id
        AND status IN ('pending', 'revision_requested', 'conflicted')
    ) THEN
      RAISE EXCEPTION 'SUPERSEDED_PROPOSAL_NOT_OPEN: %', p_supersedes_proposal_id;
    END IF;
    UPDATE artifact_change_proposals
    SET status = 'superseded'
    WHERE id = p_supersedes_proposal_id
      AND artifact_id = v_artifact.id
      AND status IN ('pending', 'revision_requested', 'conflicted');
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

COMMENT ON FUNCTION apply_artifact_patch(TEXT, INTEGER, JSONB, TEXT, TEXT, JSONB, BOOLEAN) IS
  'Core block-patch engine with optimistic concurrency (base_version + per-block expected_hash). '
  'Archived (soft-deleted) blocks are treated as MISSING_PATH for replace/append/delete/rename, '
  'preventing silent writes into invisible blocks; update_block_metadata remains the undelete path.';

COMMENT ON FUNCTION propose_artifact_patch_tx(TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, JSONB, UUID, JSONB) IS
  'Creates a pending artifact_change_proposal after validating ops against current block state '
  '(mirrors apply_artifact_patch''s archived-block handling). p_supersedes_proposal_id may target '
  'a pending, revision_requested, or conflicted proposal, which transitions to superseded.';
