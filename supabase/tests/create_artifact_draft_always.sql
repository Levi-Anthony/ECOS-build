-- Regression test for the create_artifact authority defect fix (draft-always at birth).
-- Before the fix, non-"sensitive" kinds were born status=active / review_policy=live_audit.
-- After the fix, EVERY agent-created artifact is born draft / human_gate.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions, pg_temp;

SELECT plan(6);

-- Plain non-sensitive kind ('document').
SELECT create_artifact_v2(
  'create_draft_always_document',
  'Draft-Always Document',
  'document',
  '{}'::jsonb,
  '[{"path":"/body","content":"hello"}]'::jsonb,
  'agent:test',
  '40000000-0000-0000-0000-000000000001'::uuid
);

SELECT is(
  (SELECT status FROM artifacts WHERE key = 'create_draft_always_document'),
  'draft',
  'non-sensitive (document) is born status=draft'
);
SELECT is(
  (SELECT review_policy FROM artifacts WHERE key = 'create_draft_always_document'),
  'human_gate',
  'non-sensitive (document) is born review_policy=human_gate'
);

-- The exact defect kind: eval_plan with human_gate intent that previously landed active/live_audit.
SELECT create_artifact_v2(
  'create_draft_always_eval_plan',
  'Draft-Always Eval Plan',
  'eval_plan',
  '{"authority_level":"draft_evaluation_plan","review_policy":"human_gate"}'::jsonb,
  '[{"path":"/body","content":"plan"}]'::jsonb,
  'agent:test',
  '40000000-0000-0000-0000-000000000002'::uuid
);

SELECT is(
  (SELECT status FROM artifacts WHERE key = 'create_draft_always_eval_plan'),
  'draft',
  'eval_plan (the original defect case) is born status=draft'
);
SELECT is(
  (SELECT review_policy FROM artifacts WHERE key = 'create_draft_always_eval_plan'),
  'human_gate',
  'eval_plan (the original defect case) is born review_policy=human_gate'
);

-- T4: snapshot/checkpoint machinery functions on a draft artifact (auto-snapshot at create).
SELECT isnt(
  (SELECT count(*) FROM artifact_snapshots s
     JOIN artifacts a ON a.id = s.artifact_id
    WHERE a.key = 'create_draft_always_document')::int,
  0,
  'auto-snapshot is written for a draft artifact at creation'
);

-- The initial revision records human_gate (matches the artifact, not live_audit).
SELECT is(
  (SELECT r.metadata->>'review_policy' FROM artifact_revisions r
     JOIN artifacts a ON a.id = r.artifact_id
    WHERE a.key = 'create_draft_always_document'
    ORDER BY r.version DESC LIMIT 1),
  'human_gate',
  'initial revision metadata records review_policy=human_gate'
);

SELECT * FROM finish();
ROLLBACK;
