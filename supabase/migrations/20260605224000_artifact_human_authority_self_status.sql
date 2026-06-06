BEGIN;

CREATE OR REPLACE FUNCTION public.get_current_artifact_human_authority_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_active BOOLEAN;
  v_identity_matches BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED: authenticated reviewer session required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT
    authority.active,
    authority.principal_id = 'levi'
      AND authority.display_name = 'Levi Anthony'
  INTO v_active, v_identity_matches
  FROM public.artifact_human_authorities AS authority
  WHERE authority.user_id = v_user_id;

  IF NOT FOUND OR NOT v_identity_matches THEN
    RETURN jsonb_build_object('status', 'authority_missing');
  END IF;

  IF NOT v_active THEN
    RETURN jsonb_build_object('status', 'authority_inactive');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ready',
    'principal_id', 'levi',
    'display_name', 'Levi Anthony'
  );
END;
$function$;

ALTER FUNCTION public.get_current_artifact_human_authority_status() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_current_artifact_human_authority_status()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_artifact_human_authority_status()
  TO authenticated;

DO $postflight$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.get_current_artifact_human_authority_status()',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.get_current_artifact_human_authority_status()',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated',
    'public.get_current_artifact_human_authority_status()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Human authority self-status postflight failed: unexpected execute grants';
  END IF;

  IF has_table_privilege('authenticated', 'public.artifact_human_authorities', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.artifact_human_authorities', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'Human authority self-status postflight failed: runtime role has direct authority-table access';
  END IF;
END;
$postflight$;

COMMIT;
