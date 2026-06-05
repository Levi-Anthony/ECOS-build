-- Run manually in the production Supabase SQL editor.
-- This is an operational repair, not a migration.

BEGIN ISOLATION LEVEL SERIALIZABLE;

LOCK TABLE public.artifact_human_authorities IN SHARE ROW EXCLUSIVE MODE;

DO $repair$
DECLARE
  v_match_count BIGINT;
  v_user_id UUID;
  v_conflicting_user_id UUID;
BEGIN
  SELECT
    count(*),
    (array_agg(u.id ORDER BY u.id))[1]
  INTO v_match_count, v_user_id
  FROM auth.users AS u
  WHERE lower(u.email) = lower('artifact-reviewer@ecos.local');

  IF v_match_count <> 1 THEN
    RAISE EXCEPTION
      'Artifact reviewer repair aborted: expected exactly one matching auth user, found %',
      v_match_count;
  END IF;

  SELECT authority.user_id
  INTO v_conflicting_user_id
  FROM public.artifact_human_authorities AS authority
  WHERE authority.principal_id = 'levi'
    AND authority.user_id <> v_user_id;

  IF v_conflicting_user_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Artifact reviewer repair aborted: principal_id levi already belongs to another auth user';
  END IF;

  INSERT INTO public.artifact_human_authorities AS authority (
    user_id,
    principal_id,
    display_name,
    active
  )
  VALUES (
    v_user_id,
    'levi',
    'Levi Anthony',
    true
  )
  ON CONFLICT (user_id) DO UPDATE
  SET principal_id = EXCLUDED.principal_id,
      display_name = EXCLUDED.display_name,
      active = EXCLUDED.active;

  IF NOT EXISTS (
    SELECT 1
    FROM public.artifact_human_authorities AS authority
    WHERE authority.user_id = v_user_id
      AND authority.principal_id = 'levi'
      AND authority.display_name = 'Levi Anthony'
      AND authority.active = true
  ) THEN
    RAISE EXCEPTION 'Artifact reviewer repair aborted: post-write verification failed';
  END IF;
END;
$repair$;

COMMIT;

SELECT jsonb_build_object(
  'status', CASE WHEN authority.active THEN 'ready' ELSE 'authority_inactive' END,
  'principal_id', authority.principal_id,
  'display_name', authority.display_name
) AS artifact_reviewer_repair_result
FROM public.artifact_human_authorities AS authority
WHERE authority.principal_id = 'levi';
