BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions, pg_temp;

SELECT plan(10);

SELECT has_function(
  'public',
  'artifact_dashboard_reviewer_user_id',
  ARRAY[]::TEXT[],
  'dashboard reviewer helper exists'
);

SELECT has_function(
  'public',
  'apply_artifact_dashboard_patch_tx',
  ARRAY['text', 'integer', 'jsonb', 'text', 'jsonb']::TEXT[],
  'dashboard patch wrapper exists'
);

SELECT has_function(
  'public',
  'review_artifact_dashboard_change_tx',
  ARRAY['uuid', 'text', 'text', 'jsonb']::TEXT[],
  'dashboard review wrapper exists'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.apply_artifact_dashboard_patch_tx(text, integer, jsonb, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.apply_artifact_dashboard_patch_tx(text, integer, jsonb, text, jsonb)', 'EXECUTE'),
  'browser-facing roles cannot execute dashboard patch wrapper'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.review_artifact_dashboard_change_tx(uuid, text, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.review_artifact_dashboard_change_tx(uuid, text, text, jsonb)', 'EXECUTE'),
  'browser-facing roles cannot execute dashboard review wrapper'
);

SELECT ok(
  has_function_privilege('service_role', 'public.apply_artifact_dashboard_patch_tx(text, integer, jsonb, text, jsonb)', 'EXECUTE'),
  'service_role can execute dashboard patch wrapper'
);

SELECT ok(
  has_function_privilege('service_role', 'public.review_artifact_dashboard_change_tx(uuid, text, text, jsonb)', 'EXECUTE'),
  'service_role can execute dashboard review wrapper'
);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
VALUES (
  '22000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'artifact-dashboard-wrapper@example.invalid',
  crypt('not-used-outside-test', gen_salt('bf')),
  now(),
  now(),
  now()
);

INSERT INTO public.artifact_human_authorities (
  user_id,
  principal_id,
  display_name,
  active
)
VALUES (
  '22000000-0000-0000-0000-000000000002'::uuid,
  'levi',
  'Levi Anthony',
  true
);

SET LOCAL ROLE service_role;

SELECT throws_matching(
  $$SELECT public.apply_artifact_dashboard_patch_tx(
    '__missing_dashboard_wrapper_probe__',
    1,
    '[]'::jsonb,
    'dashboard wrapper test',
    '{"test":true}'::jsonb
  )$$,
  '^ARTIFACT_NOT_FOUND:',
  'service_role dashboard patch wrapper reaches canonical human patch path'
);

SELECT throws_matching(
  $$SELECT public.review_artifact_dashboard_change_tx(
    '00000000-0000-0000-0000-000000000000'::uuid,
    'approve',
    'dashboard wrapper test',
    NULL
  )$$,
  '^PROPOSAL_NOT_FOUND:',
  'service_role dashboard review wrapper reaches canonical human review path'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)
    FROM public.artifact_revisions
    WHERE source_refs @> '{"test":true}'::jsonb
  ),
  0::bigint,
  'wrapper existence probes do not create revisions'
);

SELECT * FROM finish();
ROLLBACK;
