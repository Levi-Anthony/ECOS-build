
-- Two-Door fix: agent-relayed human approval path for artifact proposals.
--
-- apply_artifact_proposal_agent_tx: applies a pending proposal exactly as
-- review_artifact_change_tx does, but without calling
-- artifact_authenticated_human_principal(). The human's in-session
-- authorization is captured via p_authorization_note and recorded in
-- artifact_review_events with full provenance.
--
-- Called by MCP tools apply_artifact_change_proposal and set_artifact_authority
-- when Levi provides explicit in-session approval. This is the second door of
-- the Two-Door governance model.
--
-- SECURITY: SECURITY DEFINER, callable from service role (MCP).
-- Does NOT replace the human UI door — review_artifact_change_tx still exists.

CREATE OR REPLACE FUNCTION apply_artifact_proposal_agent_tx(
  p_proposal_id       uuid,
  p_authorization_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_proposal RECORD;
  v_artifact RECORD;
  v_result   JSONB;
  v_error    TEXT;
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
$$;

COMMENT ON FUNCTION apply_artifact_proposal_agent_tx(uuid, text) IS
  'Two-Door agent approval: applies a pending proposal on behalf of an in-session human principal. '
  'Records authorization_note as the review reason. Counterpart to review_artifact_change_tx (human UI door).';
