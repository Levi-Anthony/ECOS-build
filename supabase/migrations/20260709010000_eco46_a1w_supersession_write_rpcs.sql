-- ECO-46 A1.W — supersession write-path teeth (function-only migration).
--
-- Ratified: Linear ECO-46 comments 459fa752 + 9ad3b61c; contract artifact
-- eco46-a1-wr-implementation-contract. Q1 stamp mechanism = modify the write
-- RPCs so the predecessor stamp lands in the SAME TRANSACTION as the write
-- (layer decision 94a504ce; save_handoff_snapshot_tx precedent). ZERO schema
-- DDL: the superseded_by/superseded_at columns + CHECKs are already installed
-- (20260708015300_eco46_a1dm). This migration only CREATE OR REPLACEs functions.
--
-- Guardrail 3 (binding): an already-superseded / missing declared predecessor
-- makes the WHOLE write fail (RAISE + full-transaction rollback). No silent
-- WHERE-skip: the stamped-row count must equal the declared-id count.
-- Guardrail 4: classification (content vs mechanical), key->id resolution, and
-- the pre-flight unsuperseded check live in TS; these functions are mechanics
-- only. The typed p_supersede_ids drives the stamp; p_supersession_receipt is an
-- audit receipt written into artifact_revisions.metadata and NEVER read for logic.
--
-- All function bodies below are the live pg_get_functiondef edit base (amendment
-- A2) with ONLY the supersession additions marked `-- A1.W:`.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared stamp helper. Called from every content-class write path in the same
-- transaction as the write. Fail-closed rowcount guard (guardrail 3).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_supersession(
  p_successor_id  uuid,
  p_supersede_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_declared INTEGER;
  v_stamped  INTEGER;
BEGIN
  v_declared := COALESCE(array_length(p_supersede_ids, 1), 0);
  IF v_declared = 0 THEN
    RETURN;  -- declares:"nothing" or no predecessors → nothing to stamp
  END IF;

  -- Stamp only currently-unsuperseded predecessors. superseded_by = successor;
  -- a self-reference (predecessor = successor) trips artifacts_no_self_supersession_chk
  -- and RAISEs, rolling back the whole write (Test 7 backstop).
  UPDATE artifacts
    SET superseded_by = p_successor_id, superseded_at = now()
    WHERE id = ANY(p_supersede_ids) AND superseded_by IS NULL;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  IF v_stamped <> v_declared THEN
    RAISE EXCEPTION 'SUPERSESSION_PREDECESSOR_NOT_CURRENT: % of % declared predecessor(s) were missing or already superseded; re-point explicitly. No stamp applied (whole write rolled back).',
      (v_declared - v_stamped), v_declared;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.stamp_supersession(uuid, uuid[]) IS
  'ECO-46 A1.W: same-transaction supersession stamp. Sets superseded_by/superseded_at on each declared predecessor; RAISEs (full rollback) unless every declared id was currently unsuperseded. Mechanics only — classification/resolution live in the TS tool layer.';

-- ─────────────────────────────────────────────────────────────────────────────
-- create_artifact_v2 — CREATE path. Adds p_supersede_ids + p_supersession_receipt.
-- Stamp fires after the artifact row exists (v_id is the successor).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_artifact_v2(
  p_key text,
  p_title text,
  p_kind text DEFAULT 'document'::text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_blocks jsonb DEFAULT '[]'::jsonb,
  p_actor text DEFAULT 'mcp'::text,
  p_id uuid DEFAULT NULL::uuid,
  p_supersede_ids uuid[] DEFAULT NULL,          -- A1.W
  p_supersession_receipt jsonb DEFAULT NULL     -- A1.W (audit-only)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
  v_rev_metadata JSONB;   -- A1.W
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

  v_actor_type := 'agent';
  v_actor_id := CASE WHEN position(':' IN p_actor) > 0 THEN split_part(p_actor, ':', 2) ELSE p_actor END;
  v_version := CASE
    WHEN p_blocks IS NOT NULL AND jsonb_typeof(p_blocks) = 'array' AND jsonb_array_length(p_blocks) > 0 THEN 1
    ELSE 0
  END;
  v_id := COALESCE(p_id, gen_random_uuid());

  -- AUTHORITY DEFECT FIX: draft-always at birth.
  INSERT INTO artifacts (id, key, title, kind, status, review_policy, current_version, metadata)
  VALUES (
    v_id, p_key, p_title, COALESCE(p_kind, 'document'),
    'draft',
    'human_gate',
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

  -- A1.W: audit receipt of the (TS-executed) classification + declaration.
  v_rev_metadata := jsonb_build_object('review_policy', 'human_gate');
  IF p_supersession_receipt IS NOT NULL THEN
    v_rev_metadata := v_rev_metadata || jsonb_build_object('supersession', p_supersession_receipt);
  END IF;

  INSERT INTO artifact_revisions (
    artifact_id, version, base_version, ops, summary, actor, actor_type, actor_id, metadata
  )
  VALUES (
    v_id, v_version, 0, v_ops, 'Initial create', p_actor, v_actor_type, v_actor_id,
    v_rev_metadata
  );

  -- A1.W: same-transaction predecessor stamp (successor = this new artifact).
  PERFORM stamp_supersession(v_id, p_supersede_ids);

  PERFORM write_artifact_snapshot(
    v_id, v_version,
    jsonb_build_object('source', 'initial_create', 'actor_type', v_actor_type, 'actor_id', v_actor_id)
  );

  RETURN jsonb_build_object(
    'artifact_id', v_id,
    'key', p_key,
    'version', v_version,
    'status', 'draft',
    'review_policy', 'human_gate',
    'blocks', v_created
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- apply_artifact_agent_patch_tx — LIVE agent patch path (also used by
-- replace_artifact_body live). Capture the patch result, then stamp in-txn.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_artifact_agent_patch_tx(
  p_key text,
  p_base_version integer,
  p_ops jsonb,
  p_summary text,
  p_actor_id text DEFAULT 'mcp'::text,
  p_source_refs jsonb DEFAULT '{}'::jsonb,
  p_admin boolean DEFAULT false,
  p_supersede_ids uuid[] DEFAULT NULL,          -- A1.W
  p_supersession_receipt jsonb DEFAULT NULL     -- A1.W (audit-only)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;   -- A1.W
BEGIN
  v_result := apply_artifact_patch(
    p_key,
    p_base_version,
    p_ops,
    p_summary,
    'agent:' || COALESCE(NULLIF(btrim(p_actor_id), ''), 'mcp'),
    jsonb_build_object(
      'authority_path', 'agent',
      'source_refs', COALESCE(p_source_refs, '{}'::jsonb)
      -- A1.W: audit receipt travels in the revision metadata, never read for logic.
    ) || CASE WHEN p_supersession_receipt IS NOT NULL
           THEN jsonb_build_object('supersession', p_supersession_receipt)
           ELSE '{}'::jsonb END,
    p_admin
  );

  -- A1.W: same-transaction predecessor stamp (successor = the patched artifact).
  PERFORM stamp_supersession((v_result->>'artifact_id')::uuid, p_supersede_ids);

  RETURN v_result;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- propose_artifact_patch_tx — human_gate path. STAGES the declaration onto the
-- proposal (no stamp yet); the stamp fires at approval. Edit base: live def +
-- the two A1.W params + staging into proposal metadata.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propose_artifact_patch_tx(
  p_key text,
  p_base_version integer,
  p_ops jsonb,
  p_summary text,
  p_actor_type text DEFAULT 'agent'::text,
  p_actor_id text DEFAULT 'mcp'::text,
  p_source_refs jsonb DEFAULT '{}'::jsonb,
  p_supersedes_proposal_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_supersede_ids uuid[] DEFAULT NULL,          -- A1.W
  p_supersession_receipt jsonb DEFAULT NULL     -- A1.W
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_artifact RECORD;
  v_proposal_id UUID;
  v_op JSONB;
  v_kind TEXT;
  v_path TEXT;
  v_expected TEXT;
  v_found_hash TEXT;
  v_found_archived BOOLEAN;
  v_metadata JSONB;   -- A1.W
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

  -- A1.W: stage the (TS-validated) supersession declaration onto the proposal.
  -- Teeth land at APPROVAL (review_artifact_change_tx / apply_artifact_proposal_agent_tx).
  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  IF p_supersede_ids IS NOT NULL OR p_supersession_receipt IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object(
      'supersession', jsonb_build_object(
        'ids', COALESCE(to_jsonb(p_supersede_ids), '[]'::jsonb),
        'receipt', p_supersession_receipt
      )
    );
  END IF;

  INSERT INTO artifact_change_proposals (
    artifact_id, base_version, ops, summary, proposer_actor_type, proposer_actor_id,
    source_refs, review_policy_at_proposal, supersedes_proposal_id, metadata
  )
  VALUES (
    v_artifact.id, p_base_version, p_ops, p_summary, p_actor_type, p_actor_id,
    COALESCE(p_source_refs, '{}'::jsonb), v_artifact.review_policy, p_supersedes_proposal_id,
    v_metadata
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- review_artifact_change_tx — human-door APPROVAL (guardrail 5). Reads the
-- staged declaration from proposal.metadata (the one whitelisted jsonb read —
-- mechanical execution of an already-TS-validated instruction, NOT
-- classification) and stamps in-txn after the patch applies.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.review_artifact_change_tx(
  p_proposal_id uuid,
  p_action text,
  p_reason text DEFAULT NULL::text,
  p_replacement_ops jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_proposal RECORD;
  v_artifact RECORD;
  v_ops JSONB;
  v_result JSONB;
  v_error TEXT;
  v_event_type TEXT;
  v_reviewer_id TEXT;
  v_supersede_ids uuid[];   -- A1.W
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

    -- A1.W: apply the staged supersession declaration at approval, same txn as
    -- the patch. Whitelisted jsonb read (mechanical execution, not classification).
    -- Re-checks predecessors are still unsuperseded via the rowcount guard; a
    -- predecessor superseded between propose and approval fails the whole approval.
    IF v_proposal.metadata ? 'supersession' THEN
      SELECT array_agg(value::uuid) INTO v_supersede_ids
      FROM jsonb_array_elements_text(COALESCE(v_proposal.metadata->'supersession'->'ids', '[]'::jsonb));
      PERFORM stamp_supersession(v_artifact.id, v_supersede_ids);
    END IF;

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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- apply_artifact_proposal_agent_tx — agent-relayed human approval. Same staged
-- stamp as review_artifact_change_tx.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_artifact_proposal_agent_tx(
  p_proposal_id uuid,
  p_authorization_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_proposal RECORD;
  v_artifact RECORD;
  v_result   JSONB;
  v_error    TEXT;
  v_supersede_ids uuid[];   -- A1.W
BEGIN
  IF NULLIF(btrim(COALESCE(p_authorization_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_NOTE_REQUIRED: provide the human in-session approval note';
  END IF;

  SELECT * INTO v_proposal
  FROM artifact_change_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROPOSAL_NOT_FOUND: %', p_proposal_id;
  END IF;
  IF v_proposal.status NOT IN ('pending', 'revision_requested') THEN
    RAISE EXCEPTION 'PROPOSAL_CLOSED: proposal % has status %', p_proposal_id, v_proposal.status;
  END IF;

  SELECT * INTO v_artifact FROM artifacts WHERE id = v_proposal.artifact_id FOR UPDATE;

  BEGIN
    SELECT apply_artifact_patch(
      v_artifact.key,
      v_proposal.base_version,
      v_proposal.ops,
      v_proposal.summary,
      'human:levi',
      jsonb_build_object(
        'authority_path',     'human',
        'source_refs',        v_proposal.source_refs,
        'proposal_id',        v_proposal.id,
        'review_action',      'approve',
        'relayed_by',         'agent:mcp',
        'authorization_note', p_authorization_note
      ),
      false
    ) INTO v_result;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    UPDATE artifact_change_proposals SET
      status          = 'conflicted',
      review_reason   = v_error,
      reviewed_by_type = 'agent',
      reviewed_by_id  = 'mcp',
      reviewed_at     = now()
    WHERE id = p_proposal_id;
    INSERT INTO artifact_review_events (
      artifact_id, proposal_id, event_type, actor_type, actor_id, reason, payload
    ) VALUES (
      v_artifact.id, p_proposal_id, 'conflicted', 'agent', 'mcp',
      v_error,
      jsonb_build_object('action', 'approve', 'authorization_note', p_authorization_note)
    );
    RETURN jsonb_build_object('proposal_id', p_proposal_id, 'status', 'conflicted', 'error', v_error);
  END;

  -- A1.W: apply the staged supersession declaration at approval (same txn).
  IF v_proposal.metadata ? 'supersession' THEN
    SELECT array_agg(value::uuid) INTO v_supersede_ids
    FROM jsonb_array_elements_text(COALESCE(v_proposal.metadata->'supersession'->'ids', '[]'::jsonb));
    PERFORM stamp_supersession(v_artifact.id, v_supersede_ids);
  END IF;

  UPDATE artifact_change_proposals SET
    status           = 'approved',
    ops              = v_proposal.ops,
    review_reason    = p_authorization_note,
    reviewed_by_type = 'agent',
    reviewed_by_id   = 'mcp',
    reviewed_at      = now(),
    applied_version  = (v_result->>'new_version')::integer
  WHERE id = p_proposal_id;

  INSERT INTO artifact_review_events (
    artifact_id, proposal_id, event_type, actor_type, actor_id, reason, payload
  ) VALUES (
    v_artifact.id, p_proposal_id, 'approved', 'agent', 'mcp',
    'Agent-relayed human authorization: ' || p_authorization_note,
    v_result
  );

  RETURN jsonb_build_object(
    'proposal_id',  p_proposal_id,
    'status',       'approved',
    'patch_result', v_result
  );
END;
$function$;
