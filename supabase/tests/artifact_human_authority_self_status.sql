BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions, pg_temp;

SELECT plan(15);

SELECT has_function(
  'public',
  'get_current_artifact_human_authority_status',
  ARRAY[]::TEXT[],
  'self-status RPC exists with no caller-supplied identity arguments'
);

SELECT is(
  to_regprocedure('public.get_current_artifact_human_authority_status(uuid)'),
  NULL,
  'self-status RPC has no spoofable identity overload'
);

SELECT is(
  (
    SELECT pg_get_userbyid(proc.proowner)
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'get_current_artifact_human_authority_status'
      AND proc.pronargs = 0
  ),
  'postgres',
  'self-status RPC is owned by postgres'
);

SELECT ok(
  (
    SELECT proc.prosecdef
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'get_current_artifact_human_authority_status'
      AND proc.pronargs = 0
  ),
  'self-status RPC is SECURITY DEFINER'
);

SELECT is(
  (
    SELECT array_to_string(proc.proconfig, ',')
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = 'get_current_artifact_human_authority_status'
      AND proc.pronargs = 0
  ),
  'search_path=public, pg_temp',
  'self-status RPC has the fixed search path'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_current_artifact_human_authority_status()', 'EXECUTE'),
  'anon cannot execute self-status RPC'
);

SELECT ok(
  NOT has_function_privilege('service_role', 'public.get_current_artifact_human_authority_status()', 'EXECUTE'),
  'service_role cannot execute self-status RPC'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_current_artifact_human_authority_status()', 'EXECUTE'),
  'authenticated can execute self-status RPC'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.artifact_human_authorities', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'public.artifact_human_authorities', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'runtime-facing roles cannot directly read or mutate human authority mappings'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT throws_ok(
  $$SELECT public.get_current_artifact_human_authority_status()$$,
  '42501',
  'AUTHENTICATION_REQUIRED: authenticated reviewer session required',
  'null auth.uid() raises insufficient privilege'
);

RESET ROLE;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
VALUES (
  '21000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'artifact-self-status@example.invalid',
  crypt('not-used-outside-test', gen_salt('bf')),
  now(),
  now(),
  now()
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '21000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  public.get_current_artifact_human_authority_status(),
  '{"status":"authority_missing"}'::jsonb,
  'unmapped authenticated reviewer returns authority_missing'
);

RESET ROLE;

INSERT INTO public.artifact_human_authorities (
  user_id,
  principal_id,
  display_name,
  active
)
VALUES (
  '21000000-0000-0000-0000-000000000002'::uuid,
  'levi',
  'Levi Anthony',
  false
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '21000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  public.get_current_artifact_human_authority_status(),
  '{"status":"authority_inactive"}'::jsonb,
  'inactive reviewer returns authority_inactive'
);

SELECT throws_matching(
  $$SELECT public.apply_artifact_human_patch_tx('unused', 1, '[]'::jsonb, 'inactive reviewer test')$$,
  '^HUMAN_AUTHORITY_REQUIRED:',
  'inactive reviewer cannot perform Human Door writes'
);

RESET ROLE;

UPDATE public.artifact_human_authorities
SET active = true
WHERE user_id = '21000000-0000-0000-0000-000000000002'::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '21000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  public.get_current_artifact_human_authority_status(),
  '{"status":"ready","principal_id":"levi","display_name":"Levi Anthony"}'::jsonb,
  'active canonical reviewer returns the exact ready payload'
);

RESET ROLE;

UPDATE public.artifact_human_authorities
SET display_name = 'Unexpected Name'
WHERE user_id = '21000000-0000-0000-0000-000000000002'::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '21000000-0000-0000-0000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  public.get_current_artifact_human_authority_status(),
  '{"status":"authority_missing"}'::jsonb,
  'non-canonical mapping does not expose arbitrary authority identity'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
