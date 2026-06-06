-- Roll back the Human Door operational threat model to the dashboard Basic Auth gate.
--
-- The dashboard already runs server-only with SUPABASE_SERVICE_ROLE_KEY and is protected by
-- SITE_PASSWORD. These wrappers let that dashboard runtime perform artifact review writes without
-- requiring a separate reviewer email/password sign-in path.
--
-- Authority is still database-derived from the canonical active Levi human-authority row. The
-- wrappers temporarily set the request JWT claims for that mapped user, then delegate to the
-- existing human-authority functions so revision/review audit records remain human|levi.

begin;

create or replace function public.artifact_dashboard_reviewer_user_id()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewer_user_id uuid;
begin
  select user_id
    into reviewer_user_id
  from public.artifact_human_authorities
  where principal_id = 'levi'
    and active = true;

  if reviewer_user_id is null then
    raise exception 'DASHBOARD_HUMAN_AUTHORITY_MISSING: levi';
  end if;

  return reviewer_user_id;
end;
$$;

create or replace function public.apply_artifact_dashboard_patch_tx(
  p_key text,
  p_base_version integer,
  p_ops jsonb,
  p_summary text,
  p_source_refs jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewer_user_id uuid;
  merged_source_refs jsonb;
begin
  reviewer_user_id := public.artifact_dashboard_reviewer_user_id();
  merged_source_refs := coalesce(p_source_refs, '{}'::jsonb)
    || jsonb_build_object('surface', 'crm-dashboard', 'gate', 'dashboard_basic_auth');

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', reviewer_user_id::text, 'role', 'authenticated')::text,
    true
  );

  return public.apply_artifact_human_patch_tx(
    p_key,
    p_base_version,
    p_ops,
    p_summary,
    merged_source_refs
  );
end;
$$;

create or replace function public.review_artifact_dashboard_change_tx(
  p_proposal_id uuid,
  p_action text,
  p_reason text default null,
  p_replacement_ops jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  reviewer_user_id uuid;
begin
  reviewer_user_id := public.artifact_dashboard_reviewer_user_id();

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', reviewer_user_id::text, 'role', 'authenticated')::text,
    true
  );

  return public.review_artifact_change_tx(
    p_proposal_id,
    p_action,
    p_reason,
    p_replacement_ops
  );
end;
$$;

revoke execute on function public.artifact_dashboard_reviewer_user_id() from public, anon, authenticated;
revoke execute on function public.apply_artifact_dashboard_patch_tx(text, integer, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.review_artifact_dashboard_change_tx(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.apply_artifact_dashboard_patch_tx(text, integer, jsonb, text, jsonb) to service_role;
grant execute on function public.review_artifact_dashboard_change_tx(uuid, text, text, jsonb) to service_role;

commit;
