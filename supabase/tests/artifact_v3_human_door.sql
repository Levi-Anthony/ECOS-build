BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions, pg_temp;

SELECT plan(19);

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

SELECT * FROM finish();
ROLLBACK;
