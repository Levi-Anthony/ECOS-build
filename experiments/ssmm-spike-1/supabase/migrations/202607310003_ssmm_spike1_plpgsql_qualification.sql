-- Resolve PL/pgSQL identifier ambiguity without changing the authority contract.
-- Every relation read or update in the request preflight and revisioned write
-- path uses an explicit alias. Parameters and locals retain their p_/v_
-- prefixes; no variable-conflict directive or database-wide setting is used.

create or replace function ssmm_spike1.check_runtime_request(
  p_client_event_id text,
  p_request_canonical jsonb,
  p_request_canonical_text text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, ssmm_spike1, extensions
as $$
declare
  v_request ssmm_spike1.runtime_requests;
  v_current_revision bigint;
begin
  perform ssmm_spike1.assert_runtime_request_fingerprint(
    p_request_canonical,
    p_request_canonical_text,
    p_request_fingerprint
  );

  select rr.*
  into v_request
  from ssmm_spike1.runtime_requests as rr
  where rr.client_event_id = p_client_event_id;

  if not found then
    return null;
  end if;

  select ml.authoritative_revision
  into v_current_revision
  from ssmm_spike1.main_loops as ml
  where ml.id = v_request.loop_id;

  if v_request.request_fingerprint is distinct from p_request_fingerprint
     or v_request.request_canonical is distinct from p_request_canonical
     or v_request.request_canonical_text is distinct from p_request_canonical_text then
    raise exception 'idempotency_fingerprint_conflict'
      using errcode = '40001',
      detail = jsonb_build_object(
        'current_loop_revision', v_current_revision
      )::text;
  end if;

  return jsonb_set(
    v_request.response_snapshot,
    '{idempotent_replay}',
    'true'::jsonb,
    true
  );
end;
$$;

create or replace function ssmm_spike1.apply_runtime_events_existing_loop_core(
  p_loop_id uuid,
  p_client_event_id text,
  p_action text,
  p_request_canonical jsonb,
  p_request_canonical_text text,
  p_request_fingerprint text,
  p_expected_loop_revision bigint,
  p_accepted_proposal_id uuid,
  p_accepted_proposal_version integer,
  p_events jsonb,
  p_protocol_version text,
  p_prompt_version text,
  p_invocation_source text,
  p_next_state jsonb,
  p_close_loop boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ssmm_spike1, extensions
as $$
declare
  v_loop ssmm_spike1.main_loops;
  v_existing_request ssmm_spike1.runtime_requests;
  v_current_proposal ssmm_spike1.shape_proposals;
  v_accepted_shape ssmm_spike1.installed_shapes;
  v_result jsonb;
  v_loop_id uuid;
  v_new_revision bigint;
  v_legacy_loop_id uuid;
begin
  perform ssmm_spike1.assert_runtime_request_fingerprint(
    p_request_canonical,
    p_request_canonical_text,
    p_request_fingerprint
  );

  if p_action is null or btrim(p_action) = '' then
    raise exception 'action_required' using errcode = '22023';
  end if;

  if p_request_canonical->>'protocol_version' is distinct from p_protocol_version
     or p_request_canonical->>'action' is distinct from p_action
     or nullif(p_request_canonical->>'loop_id', '')::uuid is distinct from p_loop_id
     or nullif(p_request_canonical->>'expected_loop_revision', '')::bigint
        is distinct from p_expected_loop_revision
     or nullif(p_request_canonical->>'accepted_proposal_id', '')::uuid
        is distinct from p_accepted_proposal_id
     or nullif(p_request_canonical->>'accepted_proposal_version', '')::integer
        is distinct from p_accepted_proposal_version then
    raise exception 'invalid_request_fingerprint' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_event_id, 0));

  select rr.*
  into v_existing_request
  from ssmm_spike1.runtime_requests as rr
  where rr.client_event_id = p_client_event_id;

  if found then
    select ml.authoritative_revision
    into v_new_revision
    from ssmm_spike1.main_loops as ml
    where ml.id = v_existing_request.loop_id;

    if v_existing_request.request_fingerprint is distinct from p_request_fingerprint
       or v_existing_request.request_canonical is distinct from p_request_canonical
       or v_existing_request.request_canonical_text is distinct from p_request_canonical_text then
      raise exception 'idempotency_fingerprint_conflict'
        using errcode = '40001',
        detail = jsonb_build_object(
          'current_loop_revision', v_new_revision
        )::text;
    end if;

    return jsonb_set(
      v_existing_request.response_snapshot,
      '{idempotent_replay}',
      'true'::jsonb,
      true
    );
  end if;

  select ev.loop_id
  into v_legacy_loop_id
  from ssmm_spike1.events as ev
  where ev.client_event_id = p_client_event_id;

  if found then
    select ml.authoritative_revision
    into v_new_revision
    from ssmm_spike1.main_loops as ml
    where ml.id = v_legacy_loop_id;

    raise exception 'idempotency_fingerprint_conflict'
      using errcode = '40001',
      detail = jsonb_build_object(
        'current_loop_revision', v_new_revision
      )::text;
  end if;

  if p_loop_id is null then
    if p_action <> 'open_current_surface' or p_expected_loop_revision is not null then
      raise exception 'stale_loop_revision'
        using errcode = '40001',
        detail = jsonb_build_object(
          'current_loop_revision', null
        )::text;
    end if;
  else
    select ml.*
    into v_loop
    from ssmm_spike1.main_loops as ml
    where ml.id = p_loop_id
    for update;

    if not found then
      raise exception 'loop_not_found' using errcode = 'P0002';
    end if;

    if p_expected_loop_revision is null
       or p_expected_loop_revision <> v_loop.authoritative_revision then
      raise exception 'stale_loop_revision'
        using errcode = '40001',
        detail = jsonb_build_object(
          'current_loop_revision', v_loop.authoritative_revision
        )::text;
    end if;

    if p_action = 'accept_shape_proposal' then
      select sp.*
      into v_current_proposal
      from ssmm_spike1.shape_proposals as sp
      where sp.loop_id = p_loop_id
        and sp.proposal_status = 'proposed'
      order by sp.proposal_version desc
      limit 1
      for update;

      if not found
         or p_accepted_proposal_id is null
         or p_accepted_proposal_version is null
         or v_current_proposal.id <> p_accepted_proposal_id
         or v_current_proposal.proposal_version <> p_accepted_proposal_version
         or v_current_proposal.proposal_status <> 'proposed' then
        raise exception 'stale_proposal'
          using errcode = '40001',
          detail = jsonb_build_object(
            'current_loop_revision', v_loop.authoritative_revision,
            'current_proposal_id', v_current_proposal.id,
            'current_proposal_version', v_current_proposal.proposal_version
          )::text;
      end if;
    elsif p_action in ('record_installation_action', 'confirm_shape_installed') then
      select ish.*
      into v_accepted_shape
      from ssmm_spike1.installed_shapes as ish
      where ish.loop_id = p_loop_id
      for update;

      if not found
         or p_accepted_proposal_id is null
         or p_accepted_proposal_version is null
         or v_accepted_shape.accepted_proposal_id <> p_accepted_proposal_id
         or v_accepted_shape.shape_version <> p_accepted_proposal_version
         or not exists (
           select 1
           from ssmm_spike1.shape_proposals as sp
           where sp.id = p_accepted_proposal_id
             and sp.loop_id = p_loop_id
             and sp.proposal_version = p_accepted_proposal_version
             and sp.proposal_status = 'accepted'
         ) then
        raise exception 'stale_proposal'
          using errcode = '40001',
          detail = jsonb_build_object(
            'current_loop_revision', v_loop.authoritative_revision,
            'current_proposal_id', v_accepted_shape.accepted_proposal_id,
            'current_proposal_version', v_accepted_shape.shape_version
          )::text;
      end if;
    end if;
  end if;

  if p_action in (
    'accept_shape_proposal',
    'record_installation_action',
    'confirm_shape_installed'
  ) and (
    p_next_state->'installed_shape' is null
    or p_next_state->'installed_shape'->>'accepted_proposal_id'
       is distinct from p_accepted_proposal_id::text
    or (p_next_state->'installed_shape'->>'shape_version')::integer
       is distinct from p_accepted_proposal_version
  ) then
    raise exception 'stale_proposal'
      using errcode = '40001',
      detail = jsonb_build_object(
        'current_loop_revision', case
          when p_loop_id is null then null else v_loop.authoritative_revision end,
        'current_proposal_id', p_accepted_proposal_id,
        'current_proposal_version', p_accepted_proposal_version
      )::text;
  end if;

  v_result := ssmm_spike1.apply_runtime_events_unchecked(
    p_loop_id,
    p_client_event_id,
    p_events,
    p_protocol_version,
    p_prompt_version,
    p_invocation_source,
    p_next_state,
    p_close_loop
  );

  v_loop_id := (v_result->'loop'->>'loop_id')::uuid;

  update ssmm_spike1.main_loops as ml
  set authoritative_revision = ml.authoritative_revision + 1
  where ml.id = v_loop_id
  returning ml.authoritative_revision into v_new_revision;

  if not found then
    raise exception 'loop_not_found' using errcode = 'P0002';
  end if;

  v_result := jsonb_build_object(
    'idempotent_replay', false,
    'loop', ssmm_spike1.get_loop_state(v_loop_id),
    'events', v_result->'events'
  );

  insert into ssmm_spike1.runtime_requests as rr (
    client_event_id,
    loop_id,
    action,
    request_canonical,
    request_canonical_text,
    request_fingerprint,
    expected_loop_revision,
    accepted_proposal_id,
    accepted_proposal_version,
    resulting_loop_revision,
    response_snapshot
  ) values (
    p_client_event_id,
    v_loop_id,
    p_action,
    p_request_canonical,
    p_request_canonical_text,
    p_request_fingerprint,
    p_expected_loop_revision,
    p_accepted_proposal_id,
    p_accepted_proposal_version,
    v_new_revision,
    v_result
  );

  return v_result;
end;
$$;

create or replace function ssmm_spike1.apply_runtime_events(
  p_loop_id uuid,
  p_client_event_id text,
  p_action text,
  p_request_canonical jsonb,
  p_request_canonical_text text,
  p_request_fingerprint text,
  p_expected_loop_revision bigint,
  p_accepted_proposal_id uuid,
  p_accepted_proposal_version integer,
  p_events jsonb,
  p_protocol_version text,
  p_prompt_version text,
  p_invocation_source text,
  p_next_state jsonb,
  p_close_loop boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ssmm_spike1, extensions
as $$
declare
  v_existing_request ssmm_spike1.runtime_requests;
  v_legacy_loop_id uuid;
  v_active_revision bigint;
  v_result jsonb;
  v_loop_id uuid;
  v_new_revision bigint;
begin
  if p_loop_id is not null then
    return ssmm_spike1.apply_runtime_events_existing_loop_core(
      p_loop_id,
      p_client_event_id,
      p_action,
      p_request_canonical,
      p_request_canonical_text,
      p_request_fingerprint,
      p_expected_loop_revision,
      p_accepted_proposal_id,
      p_accepted_proposal_version,
      p_events,
      p_protocol_version,
      p_prompt_version,
      p_invocation_source,
      p_next_state,
      p_close_loop
    );
  end if;

  perform ssmm_spike1.assert_runtime_request_fingerprint(
    p_request_canonical,
    p_request_canonical_text,
    p_request_fingerprint
  );

  -- Meaning-bound idempotency is evaluated before first-loop field validity.
  -- A reused key must be classified by its stored semantic request, even when
  -- the new request would not otherwise be a legal loop-creation mutation.
  perform pg_advisory_xact_lock(hashtextextended(p_client_event_id, 0));

  select rr.*
  into v_existing_request
  from ssmm_spike1.runtime_requests as rr
  where rr.client_event_id = p_client_event_id;

  if found then
    select ml.authoritative_revision
    into v_new_revision
    from ssmm_spike1.main_loops as ml
    where ml.id = v_existing_request.loop_id;

    if v_existing_request.request_fingerprint is distinct from p_request_fingerprint
       or v_existing_request.request_canonical is distinct from p_request_canonical
       or v_existing_request.request_canonical_text is distinct from p_request_canonical_text then
      raise exception 'idempotency_fingerprint_conflict'
        using errcode = '40001',
        detail = jsonb_build_object(
          'current_loop_revision', v_new_revision
        )::text;
    end if;

    return jsonb_set(
      v_existing_request.response_snapshot,
      '{idempotent_replay}',
      'true'::jsonb,
      true
    );
  end if;

  select ev.loop_id
  into v_legacy_loop_id
  from ssmm_spike1.events as ev
  where ev.client_event_id = p_client_event_id;

  if found then
    select ml.authoritative_revision
    into v_new_revision
    from ssmm_spike1.main_loops as ml
    where ml.id = v_legacy_loop_id;

    raise exception 'idempotency_fingerprint_conflict'
      using errcode = '40001',
      detail = jsonb_build_object(
        'current_loop_revision', v_new_revision
      )::text;
  end if;

  if p_action is distinct from 'open_current_surface'
     or p_expected_loop_revision is distinct from 0
     or p_accepted_proposal_id is not null
     or p_accepted_proposal_version is not null then
    raise exception 'stale_loop_revision'
      using errcode = '40001',
      detail = jsonb_build_object(
        'current_loop_revision', null
      )::text;
  end if;

  if p_request_canonical->>'protocol_version' is distinct from p_protocol_version
     or p_request_canonical->>'action' is distinct from p_action
     or nullif(p_request_canonical->>'loop_id', '')::uuid is not null
     or nullif(p_request_canonical->>'expected_loop_revision', '')::bigint
        is distinct from 0
     or nullif(p_request_canonical->>'accepted_proposal_id', '')::uuid is not null
     or nullif(p_request_canonical->>'accepted_proposal_version', '')::integer
        is not null then
    raise exception 'invalid_request_fingerprint' using errcode = '22023';
  end if;

  -- Different first-open event IDs must still serialize against one focal loop.
  perform pg_advisory_xact_lock(
    hashtextextended('ssmm_spike1:focal-loop-creation', 0)
  );

  select ml.authoritative_revision
  into v_active_revision
  from ssmm_spike1.main_loops as ml
  where ml.loop_status in ('active', 'unknown')
  order by ml.updated_at desc
  limit 1
  for update;

  if found then
    raise exception 'stale_loop_revision'
      using errcode = '40001',
      detail = jsonb_build_object(
        'current_loop_revision', v_active_revision
      )::text;
  end if;

  v_result := ssmm_spike1.apply_runtime_events_unchecked(
    null,
    p_client_event_id,
    p_events,
    p_protocol_version,
    p_prompt_version,
    p_invocation_source,
    p_next_state,
    p_close_loop
  );

  v_loop_id := (v_result->'loop'->>'loop_id')::uuid;

  update ssmm_spike1.main_loops as ml
  set authoritative_revision = ml.authoritative_revision + 1
  where ml.id = v_loop_id
  returning ml.authoritative_revision into v_new_revision;

  if not found or v_new_revision <> 1 then
    raise exception 'loop_revision_initialization_failed' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'idempotent_replay', false,
    'loop', ssmm_spike1.get_loop_state(v_loop_id),
    'events', v_result->'events'
  );

  insert into ssmm_spike1.runtime_requests as rr (
    client_event_id,
    loop_id,
    action,
    request_canonical,
    request_canonical_text,
    request_fingerprint,
    expected_loop_revision,
    accepted_proposal_id,
    accepted_proposal_version,
    resulting_loop_revision,
    response_snapshot
  ) values (
    p_client_event_id,
    v_loop_id,
    p_action,
    p_request_canonical,
    p_request_canonical_text,
    p_request_fingerprint,
    0,
    null,
    null,
    v_new_revision,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function ssmm_spike1.check_runtime_request(
  text, jsonb, text, text
) from public, anon, authenticated;
revoke all on function ssmm_spike1.apply_runtime_events_existing_loop_core(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function ssmm_spike1.apply_runtime_events(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) from public, anon, authenticated;

grant execute on function ssmm_spike1.check_runtime_request(
  text, jsonb, text, text
) to service_role;
grant execute on function ssmm_spike1.apply_runtime_events(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) to service_role;
