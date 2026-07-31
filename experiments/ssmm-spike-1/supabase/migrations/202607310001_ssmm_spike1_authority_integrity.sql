create extension if not exists pgcrypto with schema extensions;

alter table ssmm_spike1.main_loops
  add column authoritative_revision bigint not null default 0
  check (authoritative_revision >= 0);

create table ssmm_spike1.runtime_requests (
  client_event_id text primary key
    check (client_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'),
  loop_id uuid not null references ssmm_spike1.main_loops(id) on delete cascade,
  action text not null,
  request_canonical jsonb not null,
  request_canonical_text text not null,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  expected_loop_revision bigint,
  accepted_proposal_id uuid,
  accepted_proposal_version integer,
  resulting_loop_revision bigint not null check (resulting_loop_revision > 0),
  response_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  check (
    (accepted_proposal_id is null and accepted_proposal_version is null)
    or
    (accepted_proposal_id is not null and accepted_proposal_version > 0)
  )
);

alter table ssmm_spike1.runtime_requests enable row level security;
alter table ssmm_spike1.runtime_requests force row level security;
create policy runtime_requests_service_role_read
on ssmm_spike1.runtime_requests
for select to service_role using (true);

revoke all on table ssmm_spike1.runtime_requests
from public, anon, authenticated, service_role;
grant select on table ssmm_spike1.runtime_requests to service_role;

create or replace function ssmm_spike1.prevent_proposal_identity_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, ssmm_spike1
as $$
begin
  if new.id is distinct from old.id
     or new.loop_id is distinct from old.loop_id
     or new.proposal_version is distinct from old.proposal_version
     or new.proposal_content is distinct from old.proposal_content
     or new.machine_interpretation is distinct from old.machine_interpretation
     or new.created_at is distinct from old.created_at then
    raise exception 'proposal_identity_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger shape_proposals_identity_immutable
before update on ssmm_spike1.shape_proposals
for each row execute function ssmm_spike1.prevent_proposal_identity_mutation();

create or replace function ssmm_spike1.get_loop_state(p_loop_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, ssmm_spike1
as $$
  select jsonb_build_object(
    'loop_id', l.id,
    'loop_status', l.loop_status,
    'authoritative_phase', l.authoritative_phase,
    'authoritative_revision', l.authoritative_revision,
    'current_step', l.current_step,
    'working_state', l.working_state,
    'purpose_handle', l.purpose_handle,
    'orientation_handle', l.orientation_handle,
    'sense_state', coalesce(
      (select to_jsonb(s) - 'loop_id' - 'updated_at'
       from ssmm_spike1.sense_states s where s.loop_id = l.id),
      '{"grounded_inputs":[],"field_representation":{},"uncertainties":[],"material_constraints":[],"purpose_orientation_context":{},"sense_completion_basis":null,"inherited_residue":null}'::jsonb
    ),
    'shape_proposals', coalesce(
      (select jsonb_agg(to_jsonb(p) - 'loop_id' order by p.proposal_version)
       from ssmm_spike1.shape_proposals p where p.loop_id = l.id),
      '[]'::jsonb
    ),
    'proposed_shape',
      (select to_jsonb(p) - 'loop_id'
       from ssmm_spike1.shape_proposals p
       where p.loop_id = l.id and p.proposal_status = 'proposed'
       order by p.proposal_version desc limit 1),
    'installed_shape',
      (select to_jsonb(i) - 'loop_id' - 'updated_at'
       from ssmm_spike1.installed_shapes i where i.loop_id = l.id),
    'move_custody',
      (select to_jsonb(m) - 'loop_id' - 'updated_at'
       from ssmm_spike1.move_custody m where m.loop_id = l.id),
    'active_adjustment',
      (select to_jsonb(a)
       from ssmm_spike1.adjustment_subloops a
       where a.parent_loop_id = l.id
       order by a.started_at desc limit 1),
    'metabolize_state',
      (select to_jsonb(ms) - 'loop_id' - 'updated_at'
       from ssmm_spike1.metabolize_states ms where ms.loop_id = l.id),
    'no_active_reason', l.no_active_reason
  )
  from ssmm_spike1.main_loops l
  where l.id = p_loop_id;
$$;

alter function ssmm_spike1.apply_runtime_events(
  uuid, text, jsonb, text, text, text, jsonb, boolean
) rename to apply_runtime_events_unchecked;

revoke all on function ssmm_spike1.apply_runtime_events_unchecked(
  uuid, text, jsonb, text, text, text, jsonb, boolean
) from public, anon, authenticated, service_role;

create or replace function ssmm_spike1.assert_runtime_request_fingerprint(
  p_request_canonical jsonb,
  p_request_canonical_text text,
  p_request_fingerprint text
)
returns void
language plpgsql
immutable
security definer
set search_path = pg_catalog, extensions
as $$
begin
  if p_request_canonical is null
     or p_request_canonical_text is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or p_request_canonical_text::jsonb is distinct from p_request_canonical
     or encode(
       extensions.digest(convert_to(p_request_canonical_text, 'UTF8'), 'sha256'),
       'hex'
     ) is distinct from p_request_fingerprint then
    raise exception 'invalid_request_fingerprint' using errcode = '22023';
  end if;
end;
$$;

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

  select * into v_request
  from ssmm_spike1.runtime_requests
  where client_event_id = p_client_event_id;

  if not found then
    return null;
  end if;

  select authoritative_revision into v_current_revision
  from ssmm_spike1.main_loops
  where id = v_request.loop_id;

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

  select loop_id into v_legacy_loop_id
  from ssmm_spike1.events
  where client_event_id = p_client_event_id;

  if found then
    select authoritative_revision into v_new_revision
    from ssmm_spike1.main_loops
    where id = v_legacy_loop_id;
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
    select * into v_loop
    from ssmm_spike1.main_loops
    where id = p_loop_id
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
      select * into v_current_proposal
      from ssmm_spike1.shape_proposals
      where loop_id = p_loop_id
        and proposal_status = 'proposed'
      order by proposal_version desc
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
      select * into v_accepted_shape
      from ssmm_spike1.installed_shapes
      where loop_id = p_loop_id
      for update;

      if not found
         or p_accepted_proposal_id is null
         or p_accepted_proposal_version is null
         or v_accepted_shape.accepted_proposal_id <> p_accepted_proposal_id
         or v_accepted_shape.shape_version <> p_accepted_proposal_version
         or not exists (
           select 1
           from ssmm_spike1.shape_proposals p
           where p.id = p_accepted_proposal_id
             and p.loop_id = p_loop_id
             and p.proposal_version = p_accepted_proposal_version
             and p.proposal_status = 'accepted'
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

  update ssmm_spike1.main_loops
  set authoritative_revision = authoritative_revision + 1
  where id = v_loop_id
  returning authoritative_revision into v_new_revision;

  if not found then
    raise exception 'loop_not_found' using errcode = 'P0002';
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
    p_expected_loop_revision,
    p_accepted_proposal_id,
    p_accepted_proposal_version,
    v_new_revision,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function ssmm_spike1.assert_runtime_request_fingerprint(
  jsonb, text, text
) from public, anon, authenticated, service_role;
revoke all on function ssmm_spike1.check_runtime_request(
  text, jsonb, text, text
) from public, anon, authenticated;
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
