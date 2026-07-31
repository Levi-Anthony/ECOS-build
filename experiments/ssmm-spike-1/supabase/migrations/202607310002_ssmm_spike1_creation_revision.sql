alter function ssmm_spike1.apply_runtime_events(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) rename to apply_runtime_events_existing_loop_core;

revoke all on function ssmm_spike1.apply_runtime_events_existing_loop_core(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) from public, anon, authenticated, service_role;

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

  if p_action is distinct from 'open_current_surface'
     or p_expected_loop_revision is distinct from 0
     or p_accepted_proposal_id is not null
     or p_accepted_proposal_version is not null then
    raise exception 'stale_loop_revision'
      using errcode = 'PT409',
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

  perform pg_advisory_xact_lock(hashtextextended(p_client_event_id, 0));

  select * into v_existing_request
  from ssmm_spike1.runtime_requests
  where client_event_id = p_client_event_id;

  if found then
    select authoritative_revision into v_new_revision
    from ssmm_spike1.main_loops
    where id = v_existing_request.loop_id;

    if v_existing_request.request_fingerprint is distinct from p_request_fingerprint
       or v_existing_request.request_canonical is distinct from p_request_canonical
       or v_existing_request.request_canonical_text is distinct from p_request_canonical_text then
      raise exception 'idempotency_fingerprint_conflict'
        using errcode = 'PT409',
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

  select loop_id into v_legacy_loop_id
  from ssmm_spike1.events
  where client_event_id = p_client_event_id;

  if found then
    select authoritative_revision into v_new_revision
    from ssmm_spike1.main_loops
    where id = v_legacy_loop_id;
    raise exception 'idempotency_fingerprint_conflict'
      using errcode = 'PT409',
      detail = jsonb_build_object(
        'current_loop_revision', v_new_revision
      )::text;
  end if;

  -- Different first-open event IDs must still serialize against one focal loop.
  perform pg_advisory_xact_lock(
    hashtextextended('ssmm_spike1:focal-loop-creation', 0)
  );

  select authoritative_revision into v_active_revision
  from ssmm_spike1.main_loops
  where loop_status in ('active', 'unknown')
  order by updated_at desc
  limit 1
  for update;

  if found then
    raise exception 'stale_loop_revision'
      using errcode = 'PT409',
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

  update ssmm_spike1.main_loops
  set authoritative_revision = authoritative_revision + 1
  where id = v_loop_id
  returning authoritative_revision into v_new_revision;

  if not found or v_new_revision <> 1 then
    raise exception 'loop_revision_initialization_failed' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'idempotent_replay', false,
    'loop', ssmm_spike1.get_loop_state(v_loop_id),
    'events', v_result->'events'
  );

  insert into ssmm_spike1.runtime_requests (
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

revoke all on function ssmm_spike1.apply_runtime_events(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) from public, anon, authenticated;

grant execute on function ssmm_spike1.apply_runtime_events(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) to service_role;
