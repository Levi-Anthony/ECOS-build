create schema if not exists ssmm_spike1;

revoke all on schema ssmm_spike1 from public, anon, authenticated;
grant usage on schema ssmm_spike1 to service_role;

create table ssmm_spike1.sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active'
    check (status in (
      'active', 'waiting_for_move', 'moving', 'interrupted', 'blocked',
      'completed', 'released', 'abandoned'
    )),
  protocol_version text not null,
  prompt_version text not null,
  invocation_source text not null,
  current_step text not null,
  working_state jsonb not null default '{}'::jsonb,
  purpose_handle jsonb not null,
  orientation_handle jsonb not null,
  proposed_loop jsonb,
  active_loop jsonb,
  return_trigger jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table ssmm_spike1.events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ssmm_spike1.sessions(id),
  sequence_number integer not null check (sequence_number > 0),
  client_event_id text not null unique,
  event_type text not null check (event_type in (
    'session_started', 'sense_answered', 'field_reflected', 'field_corrected',
    'shape_proposed', 'shape_corrected', 'loop_installed', 'move_committed',
    'move_started', 'move_refused', 'return_trigger_set', 'session_resumed',
    'condition_changed', 'loop_continued', 'loop_blocked', 'loop_replaced',
    'loop_completed', 'loop_released', 'metabolize_recorded',
    'session_closed', 'runtime_error'
  )),
  actor text not null check (actor in ('levi', 'runtime', 'system')),
  perspective text check (perspective in (
    'ul_levi_report', 'ur_observed_behavior', 'll_shared_contract',
    'lr_system_evidence', 'inference', 'proposal', 'decision', 'defect',
    'falsifier_evidence'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  protocol_version text not null,
  prompt_version text not null,
  unique (session_id, sequence_number)
);

alter table ssmm_spike1.sessions enable row level security;
alter table ssmm_spike1.events enable row level security;
alter table ssmm_spike1.sessions force row level security;
alter table ssmm_spike1.events force row level security;

-- service_role carries BYPASSRLS. These policies document intended scope but
-- do not enforce it; the explicit revokes and grants below are the access rail.
create policy sessions_service_role_only
on ssmm_spike1.sessions
for all
to service_role
using (true)
with check (true);

create policy events_service_role_only
on ssmm_spike1.events
for all
to service_role
using (true)
with check (true);

revoke all on ssmm_spike1.sessions from public, anon, authenticated;
revoke all on ssmm_spike1.events from public, anon, authenticated;
grant select, insert, update on ssmm_spike1.sessions to service_role;
grant select, insert on ssmm_spike1.events to service_role;

create or replace function ssmm_spike1.apply_runtime_event(
  p_session_id uuid,
  p_client_event_id text,
  p_events jsonb,
  p_protocol_version text,
  p_prompt_version text,
  p_invocation_source text,
  p_next_status text,
  p_next_step text,
  p_working_state jsonb,
  p_purpose_handle jsonb,
  p_orientation_handle jsonb,
  p_proposed_loop jsonb default null,
  p_active_loop jsonb default null,
  p_return_trigger jsonb default null,
  p_close_session boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ssmm_spike1, public
as $$
declare
  v_session ssmm_spike1.sessions;
  v_event ssmm_spike1.events;
  v_events jsonb := '[]'::jsonb;
  v_item jsonb;
  v_ordinal integer := 0;
  v_sequence integer;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'events_required' using errcode = '22023';
  end if;
  if p_client_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$' then
    raise exception 'invalid_client_event_id' using errcode = '22023';
  end if;

  -- Fast replay path. Atomicity is still enforced by the unique-violation
  -- handler below because concurrent retries can both miss this read.
  select * into v_event
  from ssmm_spike1.events
  where client_event_id = p_client_event_id;

  if found then
    select * into v_session
    from ssmm_spike1.sessions
    where id = v_event.session_id;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence_number), '[]'::jsonb)
    into v_events
    from ssmm_spike1.events e
    where split_part(e.client_event_id, ':', 1) = p_client_event_id;

    return jsonb_build_object(
      'idempotent_replay', true,
      'session', to_jsonb(v_session),
      'events', v_events
    );
  end if;

  begin
    if p_session_id is null then
      insert into ssmm_spike1.sessions (
        status, protocol_version, prompt_version, invocation_source,
        current_step, working_state, purpose_handle, orientation_handle,
        proposed_loop, active_loop, return_trigger
      ) values (
        p_next_status, p_protocol_version, p_prompt_version, p_invocation_source,
        p_next_step, coalesce(p_working_state, '{}'::jsonb), p_purpose_handle,
        p_orientation_handle, p_proposed_loop, p_active_loop, p_return_trigger
      )
      returning * into v_session;
    else
      select * into v_session
      from ssmm_spike1.sessions
      where id = p_session_id
      for update;

      if not found then
        raise exception 'session_not_found' using errcode = 'P0002';
      end if;

      if v_session.status in ('completed', 'released', 'abandoned') then
        raise exception 'terminal_session' using errcode = '55000';
      end if;
    end if;

    -- The session row lock above serializes sequence allocation. Do not move
    -- this MAX calculation before FOR UPDATE; the unique constraint is only a
    -- backstop, not the ordering mechanism.
    select coalesce(max(sequence_number), 0) + 1
    into v_sequence
    from ssmm_spike1.events
    where session_id = v_session.id;

    for v_item in select value from jsonb_array_elements(p_events)
    loop
      insert into ssmm_spike1.events (
        session_id, sequence_number, client_event_id, event_type, actor,
        perspective, payload, protocol_version, prompt_version
      ) values (
        v_session.id,
        v_sequence + v_ordinal,
        case
          when v_ordinal = 0 then p_client_event_id
          else p_client_event_id || ':' || v_ordinal::text
        end,
        v_item->>'event_type',
        v_item->>'actor',
        v_item->>'perspective',
        coalesce(v_item->'payload', '{}'::jsonb),
        p_protocol_version,
        p_prompt_version
      )
      returning * into v_event;
      v_events := v_events || jsonb_build_array(to_jsonb(v_event));
      v_ordinal := v_ordinal + 1;
    end loop;

    update ssmm_spike1.sessions
    set status = p_next_status,
        protocol_version = p_protocol_version,
        prompt_version = p_prompt_version,
        current_step = p_next_step,
        working_state = coalesce(p_working_state, '{}'::jsonb),
        purpose_handle = p_purpose_handle,
        orientation_handle = p_orientation_handle,
        proposed_loop = p_proposed_loop,
        active_loop = p_active_loop,
        return_trigger = p_return_trigger,
        updated_at = now(),
        closed_at = case when p_close_session then now() else v_session.closed_at end
    where id = v_session.id
    returning * into v_session;

    return jsonb_build_object(
      'idempotent_replay', false,
      'session', to_jsonb(v_session),
      'events', v_events
    );
  exception when unique_violation then
    -- This subtransaction rolls back a concurrently-created losing session and
    -- all partial events before returning the winning request as a replay.
    select * into v_event
    from ssmm_spike1.events
    where client_event_id = p_client_event_id;

    if not found then
      raise;
    end if;

    select * into v_session
    from ssmm_spike1.sessions
    where id = v_event.session_id;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence_number), '[]'::jsonb)
    into v_events
    from ssmm_spike1.events e
    where split_part(e.client_event_id, ':', 1) = p_client_event_id;

    return jsonb_build_object(
      'idempotent_replay', true,
      'session', to_jsonb(v_session),
      'events', v_events
    );
  end;
end;
$$;

revoke all on function ssmm_spike1.apply_runtime_event(
  uuid, text, jsonb, text, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) from public, anon, authenticated;

grant execute on function ssmm_spike1.apply_runtime_event(
  uuid, text, jsonb, text, text, text, text, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean
) to service_role;
