BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions, pg_temp;

SELECT plan(26);

SELECT create_artifact_v2(
  'artifact_v3_gate_test',
  'Artifact V3 Gate Test',
  'policy',
  '{"authority_level":"approved_instruction"}'::jsonb,
  '[{"path":"/body","content":"current"}]'::jsonb,
  'agent:test',
  '10000000-0000-0000-0000-000000000001'::uuid
);

CREATE TEMP TABLE artifact_v3_test_state AS
SELECT
  a.id AS artifact_id,
  a.current_version,
  b.content_hash
FROM artifacts a
JOIN artifact_blocks b ON b.artifact_id = a.id AND b.path = '/body'
WHERE a.key = 'artifact_v3_gate_test';

ALTER TABLE artifact_v3_test_state ADD COLUMN proposal_id UUID;
GRANT SELECT ON artifact_v3_test_state TO service_role, authenticated;

UPDATE artifact_v3_test_state
SET proposal_id = (
  SELECT (propose_artifact_patch_tx(
    'artifact_v3_gate_test',
    source.current_version,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block',
      'path', '/body',
      'expected_hash', source.content_hash,
      'content', 'approved'
    )),
    'gate test proposal',
    'agent',
    'shared-key-test'
  )->>'proposal_id')::uuid
  FROM artifact_v3_test_state source
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'apply_artifact_patch(text, integer, jsonb, text, text, jsonb, boolean)',
    'EXECUTE'
  ),
  'service_role cannot execute the raw apply RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'review_artifact_change_tx(uuid, text, text, jsonb)',
    'EXECUTE'
  ),
  'service_role cannot execute the human review RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'apply_artifact_human_patch_tx(text, integer, jsonb, text, jsonb)',
    'EXECUTE'
  ),
  'service_role cannot execute the authenticated-human patch RPC'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'artifacts', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'artifact_blocks', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'artifact_revisions', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'artifact_snapshots', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'artifact_change_proposals', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'artifact_review_events', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'artifact_human_authorities', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'service_role cannot directly mutate canonical, review, or human-authority state'
);

SELECT throws_matching(
  $$SELECT validate_artifact_patch_ops('[{"op":"set_artifact_status","status":"active","content":"ignored"}]'::jsonb)$$,
  '^BAD_OP_FIELD:',
  'discriminated patch validation rejects fields that do not belong to the operation'
);

SELECT ok(
  NOT artifact_status_transition_allowed('superseded', 'active'),
  'lifecycle transition matrix prevents direct superseded-to-active reactivation'
);

SET LOCAL ROLE service_role;

SELECT create_artifact_v2(
  'artifact_v3_forged_human_create_test',
  'Forged Human Create Test',
  'policy',
  '{"authority_level":"approved_instruction"}'::jsonb,
  '[{"path":"/body","content":"forged"}]'::jsonb,
  'human:forged-reviewer',
  '30000000-0000-0000-0000-000000000003'::uuid
);

SELECT throws_matching(
  $$UPDATE artifacts SET status = 'active' WHERE key = 'artifact_v3_gate_test'$$,
  'permission denied for table artifacts',
  'direct service-role table update is denied'
);

SELECT throws_matching(
  format(
    'SELECT apply_artifact_agent_patch_tx(%L, %s, %L::jsonb, %L, %L)',
    'artifact_v3_gate_test',
    current_version,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block',
      'path', '/body',
      'expected_hash', content_hash,
      'content', 'bypass'
    ))::text,
    'shared-key bypass attempt',
    'shared-key-test'
  ),
  '^HUMAN_GATE_REQUIRED:',
  'shared-key agent wrapper cannot bypass a human-gated artifact'
)
FROM artifact_v3_test_state;

SELECT throws_matching(
  format(
    'SELECT apply_artifact_patch(%L, %s, %L::jsonb, %L)',
    'artifact_v3_gate_test',
    current_version,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block',
      'path', '/body',
      'expected_hash', content_hash,
      'content', 'raw bypass'
    ))::text,
    'raw bypass attempt'
  ),
  'permission denied for function apply_artifact_patch',
  'direct service-role raw apply call is denied'
)
FROM artifact_v3_test_state;

SELECT throws_matching(
  format(
    'SELECT review_artifact_change_tx(%L::uuid, %L)',
    proposal_id,
    'approve'
  ),
  'permission denied for function review_artifact_change_tx',
  'direct service-role review call is denied'
)
FROM artifact_v3_test_state;

SELECT throws_matching(
  format(
    'SELECT apply_artifact_human_patch_tx(%L, %s, %L::jsonb, %L)',
    'artifact_v3_gate_test',
    current_version,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block',
      'path', '/body',
      'expected_hash', content_hash,
      'content', 'forged human bypass'
    ))::text,
    'forged human bypass attempt'
  ),
  'permission denied for function apply_artifact_human_patch_tx',
  'direct service-role authenticated-human patch call is denied'
)
FROM artifact_v3_test_state;

RESET ROLE;

SELECT is(
  (
    SELECT a.status || '|' || a.review_policy || '|' || r.actor_type
    FROM artifacts a
    JOIN artifact_revisions r ON r.artifact_id = a.id AND r.version = a.current_version
    WHERE a.key = 'artifact_v3_forged_human_create_test'
  ),
  'draft|human_gate|agent',
  'service-role create cannot self-assert human identity or activate sensitive artifacts'
);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
VALUES (
  '20000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'artifact-reviewer@example.invalid',
  crypt('not-used-outside-test', gen_salt('bf')),
  now(),
  now(),
  now()
);

INSERT INTO artifact_human_authorities (user_id, principal_id, display_name)
VALUES (
  '20000000-0000-0000-0000-000000000002'::uuid,
  'test-reviewer',
  'Test Reviewer'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  review_artifact_change_tx(proposal_id, 'approve')->>'status',
  'approved',
  'authenticated allowlisted human can approve'
)
FROM artifact_v3_test_state;

RESET ROLE;

SELECT is(
  (SELECT reviewed_by_id FROM artifact_change_proposals WHERE id = proposal_id),
  'test-reviewer',
  'reviewer identity is derived from authenticated authority mapping'
)
FROM artifact_v3_test_state;

SELECT is(
  (
    SELECT r.actor_id
    FROM artifact_revisions r
    JOIN artifact_v3_test_state s ON s.artifact_id = r.artifact_id
    WHERE r.version = s.current_version + 1
  ),
  'test-reviewer',
  'accepted revision actor identity is database-derived from the same human principal'
);

SELECT is(
  (
    SELECT b.content
    FROM artifact_blocks b
    JOIN artifact_v3_test_state s ON s.artifact_id = b.artifact_id
    WHERE b.path = '/body'
  ),
  'approved',
  'approved patch becomes current only through the human authority path'
)
FROM artifact_v3_test_state;

UPDATE artifact_v3_test_state state
SET current_version = a.current_version,
    content_hash = b.content_hash
FROM artifacts a
JOIN artifact_blocks b ON b.artifact_id = a.id AND b.path = '/body'
WHERE a.id = state.artifact_id;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  apply_artifact_human_patch_tx(
    'artifact_v3_gate_test',
    current_version,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block',
      'path', '/body',
      'expected_hash', content_hash,
      'content', 'direct human edit'
    )),
    'direct human edit gate test',
    '{"surface":"pgTAP","action":"direct_block_edit"}'::jsonb
  )->>'new_version',
  '3',
  'authenticated allowlisted human can apply a direct block edit'
)
FROM artifact_v3_test_state;

RESET ROLE;

SELECT is(
  (SELECT content FROM artifact_blocks WHERE artifact_id = (SELECT artifact_id FROM artifact_v3_test_state) AND path = '/body'),
  'direct human edit',
  'direct human edit becomes current'
);

SELECT is(
  (
    SELECT actor_type || '|' || actor_id || '|' || (source_refs->>'action')
    FROM artifact_revisions
    WHERE artifact_id = (SELECT artifact_id FROM artifact_v3_test_state)
      AND version = 3
  ),
  'human|test-reviewer|direct_block_edit',
  'direct human edit revision records database-derived identity and source'
);

-- ── Proposal conflict / dead-end recovery (artifact_proposal_conflict_recovery) ─

-- An archived (soft-deleted) block keeps its path and content_hash but is
-- flagged metadata.status='archived'. A patch op that targets that path
-- must fail as MISSING_PATH instead of silently writing into the invisible
-- archived block.
SELECT create_artifact_v2(
  'artifact_v3_archived_block_test',
  'Archived Block Test',
  'note',
  '{}'::jsonb,
  '[{"path":"/body","content":"alpha"}]'::jsonb,
  'agent:test',
  '40000000-0000-0000-0000-000000000004'::uuid
);

-- create_artifact_v2 now births every artifact draft/human_gate (see
-- create_artifact_draft_always); flip to live_audit/active so this test can
-- exercise the agent patch path directly, which is orthogonal to the
-- archived-block fix under test.
UPDATE artifacts SET review_policy = 'live_audit', status = 'active'
WHERE key = 'artifact_v3_archived_block_test';

SELECT apply_artifact_agent_patch_tx(
  'artifact_v3_archived_block_test',
  1,
  jsonb_build_array(jsonb_build_object(
    'op', 'delete_block',
    'path', '/body',
    'expected_hash', (
      SELECT b.content_hash FROM artifact_blocks b JOIN artifacts a ON a.id = b.artifact_id
      WHERE a.key = 'artifact_v3_archived_block_test' AND b.path = '/body'
    )
  )),
  'archive /body'
);

SELECT throws_matching(
  format(
    'SELECT apply_artifact_agent_patch_tx(%L, %s, %L::jsonb, %L)',
    'artifact_v3_archived_block_test',
    2,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block',
      'path', '/body',
      'expected_hash', (
        SELECT b.content_hash FROM artifact_blocks b JOIN artifacts a ON a.id = b.artifact_id
        WHERE a.key = 'artifact_v3_archived_block_test' AND b.path = '/body'
      ),
      'content', 'should not land'
    ))::text,
    'attempt to replace an archived block'
  ),
  '^MISSING_PATH:',
  'replace_block on an archived (soft-deleted) block is rejected as MISSING_PATH, not silently applied'
);

SELECT is(
  (
    SELECT b.content || '|' || COALESCE(b.metadata->>'status', '')
    FROM artifact_blocks b JOIN artifacts a ON a.id = b.artifact_id
    WHERE a.key = 'artifact_v3_archived_block_test' AND b.path = '/body'
  ),
  'alpha|archived',
  'archived block content and status are unchanged after the rejected replace_block'
);

SELECT is(
  apply_artifact_agent_patch_tx(
    'artifact_v3_archived_block_test',
    2,
    jsonb_build_array(jsonb_build_object(
      'op', 'update_block_metadata',
      'path', '/body',
      'expected_hash', (
        SELECT b.content_hash FROM artifact_blocks b JOIN artifacts a ON a.id = b.artifact_id
        WHERE a.key = 'artifact_v3_archived_block_test' AND b.path = '/body'
      ),
      'metadata_patch', jsonb_build_object('status', 'active')
    )),
    'undelete /body'
  )->>'new_version',
  '3',
  'update_block_metadata remains the undelete path for an archived block'
);

-- A proposal that becomes 'conflicted' (artifact advanced past its
-- base_version before it could be applied) can be superseded by a
-- corrective proposal, closing the provenance-chain gap.
SELECT create_artifact_v2(
  'artifact_v3_supersede_conflicted_test',
  'Supersede Conflicted Test',
  'policy',
  '{"authority_level":"approved_instruction"}'::jsonb,
  '[{"path":"/body","content":"v1"}]'::jsonb,
  'agent:test',
  '50000000-0000-0000-0000-000000000005'::uuid
);

CREATE TEMP TABLE artifact_v3_supersede_state AS
SELECT a.id AS artifact_id, b.content_hash AS hash_v1
FROM artifacts a JOIN artifact_blocks b ON b.artifact_id = a.id AND b.path = '/body'
WHERE a.key = 'artifact_v3_supersede_conflicted_test';

ALTER TABLE artifact_v3_supersede_state ADD COLUMN proposal_a_id UUID;
ALTER TABLE artifact_v3_supersede_state ADD COLUMN proposal_b_id UUID;
GRANT SELECT ON artifact_v3_supersede_state TO service_role, authenticated;

-- Proposal A: based on v1. It will go stale once proposal B is approved first.
UPDATE artifact_v3_supersede_state
SET proposal_a_id = (
  SELECT (propose_artifact_patch_tx(
    'artifact_v3_supersede_conflicted_test', 1,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block', 'path', '/body', 'expected_hash', s.hash_v1, 'content', 'proposal A content'
    )),
    'proposal A', 'agent', 'agent-a'
  )->>'proposal_id')::uuid
  FROM artifact_v3_supersede_state s
);

-- Proposal B: also based on v1, approved first so the artifact advances to v2.
UPDATE artifact_v3_supersede_state
SET proposal_b_id = (
  SELECT (propose_artifact_patch_tx(
    'artifact_v3_supersede_conflicted_test', 1,
    jsonb_build_array(jsonb_build_object(
      'op', 'replace_block', 'path', '/body', 'expected_hash', s.hash_v1, 'content', 'proposal B content'
    )),
    'proposal B', 'agent', 'agent-b'
  )->>'proposal_id')::uuid
  FROM artifact_v3_supersede_state s
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Approve B first: artifact advances to v2.
SELECT is(
  review_artifact_change_tx(proposal_b_id, 'approve')->>'status',
  'approved',
  'proposal B approves cleanly and advances the artifact to v2'
)
FROM artifact_v3_supersede_state;

-- Approving A now conflicts: base_version 1 != current_version 2.
SELECT is(
  review_artifact_change_tx(proposal_a_id, 'approve')->>'status',
  'conflicted',
  'proposal A conflicts at apply time because the artifact already advanced'
)
FROM artifact_v3_supersede_state;

RESET ROLE;

-- Corrective proposal C supersedes the now-conflicted proposal A.
SELECT lives_ok(
  format(
    $fmt$SELECT propose_artifact_patch_tx(
      'artifact_v3_supersede_conflicted_test', 2,
      jsonb_build_array(jsonb_build_object(
        'op','replace_block','path','/body','expected_hash',
        (SELECT content_hash FROM artifact_blocks WHERE artifact_id = %L AND path = '/body'),
        'content','proposal C corrective content'
      )),
      'proposal C: corrective', 'agent', 'agent-c', '{}'::jsonb, %L::uuid
    )$fmt$,
    artifact_id, proposal_a_id
  ),
  'a corrective proposal can supersede a conflicted proposal'
)
FROM artifact_v3_supersede_state;

SELECT is(
  (SELECT status FROM artifact_change_proposals WHERE id = proposal_a_id),
  'superseded',
  'the conflicted proposal transitions to superseded once a corrective proposal supersedes it'
)
FROM artifact_v3_supersede_state;

SELECT * FROM finish();
ROLLBACK;
