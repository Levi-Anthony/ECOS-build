create schema if not exists ssmm_spike1;

revoke all on schema ssmm_spike1 from public, anon, authenticated;
grant usage on schema ssmm_spike1 to service_role;

create table ssmm_spike1.main_loops (
  id uuid primary key default gen_random_uuid(),
  loop_status text not null default 'active'
    check (loop_status in ('active', 'closed', 'disposed', 'unknown')),
  authoritative_phase text not null
    check (authoritative_phase in ('sense', 'shape', 'move', 'metabolize', 'unknown')),
  phase_entered_at timestamptz not null default now(),
  current_step text not null,
  protocol_version text not null,
  prompt_version text not null,
  invocation_source text not null,
  working_state jsonb not null default '{}'::jsonb,
  purpose_handle jsonb not null,
  orientation_handle jsonb not null,
  no_active_reason text not null default 'never_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Slice 1 permits exactly one focal authoritative main loop without claiming
-- that the final ontology can never support sibling loops.
create unique index main_loops_one_focal_active
on ssmm_spike1.main_loops ((true))
where loop_status in ('active', 'unknown');

create table ssmm_spike1.sense_states (
  loop_id uuid primary key references ssmm_spike1.main_loops(id) on delete cascade,
  grounded_inputs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(grounded_inputs) = 'array'),
  field_representation jsonb not null default '{}'::jsonb,
  uncertainties jsonb not null default '[]'::jsonb
    check (jsonb_typeof(uncertainties) = 'array'),
  material_constraints jsonb not null default '[]'::jsonb
    check (jsonb_typeof(material_constraints) = 'array'),
  purpose_orientation_context jsonb not null default '{}'::jsonb,
  sense_completion_basis text,
  inherited_residue jsonb,
  updated_at timestamptz not null default now()
);

create table ssmm_spike1.shape_proposals (
  id uuid primary key,
  loop_id uuid not null references ssmm_spike1.main_loops(id) on delete cascade,
  proposal_version integer not null check (proposal_version > 0),
  proposal_content jsonb not null,
  machine_interpretation jsonb not null default '{}'::jsonb,
  proposal_status text not null
    check (proposal_status in ('proposed', 'rejected', 'accepted', 'superseded')),
  created_at timestamptz not null,
  unique (loop_id, proposal_version)
);

create unique index shape_proposals_one_current
on ssmm_spike1.shape_proposals (loop_id)
where proposal_status = 'proposed';

create table ssmm_spike1.installed_shapes (
  loop_id uuid primary key references ssmm_spike1.main_loops(id) on delete cascade,
  accepted_proposal_id uuid not null references ssmm_spike1.shape_proposals(id),
  accepted_by text not null check (accepted_by = 'levi'),
  accepted_at timestamptz not null,
  move_target text not null,
  decision text not null,
  orientation text not null,
  immediate_why text not null,
  reason_chain_handles jsonb not null default '[]'::jsonb,
  exit_condition text not null,
  degrees_of_freedom jsonb not null default '[]'::jsonb,
  quick_check_adjustments jsonb not null default '[]'::jsonb,
  help_required_conditions jsonb not null default '[]'::jsonb,
  invalidation_conditions jsonb not null default '[]'::jsonb,
  anticipated_obstacles jsonb not null default '[]'::jsonb,
  completion_evidence jsonb not null default '[]'::jsonb,
  installation_requirements jsonb not null default '[]'::jsonb,
  installation_actions jsonb not null default '[]'::jsonb,
  installation_status text not null
    check (installation_status in ('pending', 'in_progress', 'installed')),
  installed_at timestamptz,
  declared_starting_conditions text not null default '',
  small_move_exception boolean not null default false,
  installation_waiver text,
  transition_event_identifier text,
  shape_version integer not null check (shape_version > 0),
  first_physical_action text not null,
  interruption_handling text not null,
  cockpit_cues jsonb not null default '[]'::jsonb,
  uncertainty text not null,
  purpose_handle jsonb not null,
  updated_at timestamptz not null default now()
);

create table ssmm_spike1.move_custody (
  loop_id uuid primary key references ssmm_spike1.main_loops(id) on delete cascade,
  move_position text not null check (move_position in (
    'not_started', 'starting', 'active', 'paused', 'interrupted', 'blocked',
    'awaiting_external_condition', 'completion_claimed'
  )),
  latest_progress jsonb,
  latest_interruption jsonb,
  active_friction jsonb,
  pause_reason text,
  last_resumed_at timestamptz,
  completion_claim jsonb,
  evidence_supplied jsonb not null default '[]'::jsonb,
  current_disposition text,
  pending_changed_conditions jsonb,
  updated_at timestamptz not null default now()
);

create table ssmm_spike1.adjustment_subloops (
  id uuid primary key,
  parent_loop_id uuid not null references ssmm_spike1.main_loops(id) on delete cascade,
  parent_phase text not null check (parent_phase = 'move'),
  parent_shape_version integer not null,
  reported_change text not null,
  adjustment_classification text not null check (
    adjustment_classification = 'bounded_adaptation'
  ),
  adjustment_boundary text not null,
  nested_phase text not null
    check (nested_phase in ('sense', 'shape', 'move', 'metabolize', 'closed')),
  adjustment_shape text not null,
  result text,
  effect_on_parent text,
  started_at timestamptz not null,
  closed_at timestamptz
);

create table ssmm_spike1.metabolize_states (
  loop_id uuid primary key references ssmm_spike1.main_loops(id) on delete cascade,
  move_disposition text not null,
  exit_condition_snapshot text not null,
  completion_claim_snapshot jsonb,
  verification_result text check (verification_result in (
    'verified', 'partially_verified', 'not_verified', 'cannot_verify',
    'exit_condition_disputed', 'additional_evidence_required'
  )),
  verification_assessment jsonb,
  credited_result text,
  consequences jsonb not null default '[]'::jsonb,
  residue jsonb,
  released_material jsonb not null default '[]'::jsonb,
  lessons jsonb not null default '[]'::jsonb,
  closure_basis text,
  residue_confirmed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table ssmm_spike1.events (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid not null references ssmm_spike1.main_loops(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  client_event_id text not null unique,
  event_type text not null check (event_type in (
    'loop_created', 'loop_resumed',
    'sense_started', 'sense_input_recorded', 'sense_field_updated', 'sense_completed',
    'shape_proposal_created', 'shape_proposal_rejected',
    'shape_proposal_corrected', 'shape_proposal_regenerated',
    'shape_proposal_accepted', 'shape_installation_started',
    'shape_installation_action_recorded', 'shape_installed',
    'parent_entered_move', 'move_position_updated', 'move_progress_recorded',
    'move_interrupted', 'move_resumed', 'move_friction_reported',
    'nested_adjustment_started', 'nested_adjustment_shaped',
    'nested_adjustment_executed', 'nested_adjustment_metabolized',
    'parent_move_restored', 'material_invalidation_reported',
    'move_completion_claimed', 'completion_evidence_recorded',
    'move_released', 'move_abandoned', 'parent_entered_metabolize',
    'completion_verified', 'completion_partially_verified',
    'completion_not_verified', 'completion_unverifiable',
    'metabolize_input_recorded', 'metabolize_residue_recorded',
    'loop_closed', 'loop_disposed',
    'authoritative_state_uncertain', 'authoritative_state_recovered',
    'runtime_error'
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
  unique (loop_id, sequence_number)
);

create unique index events_one_authoritative_seam_transition
on ssmm_spike1.events (loop_id, event_type)
where event_type in (
  'shape_installed',
  'parent_entered_move',
  'parent_entered_metabolize',
  'loop_closed',
  'loop_disposed'
);

alter table ssmm_spike1.main_loops enable row level security;
alter table ssmm_spike1.sense_states enable row level security;
alter table ssmm_spike1.shape_proposals enable row level security;
alter table ssmm_spike1.installed_shapes enable row level security;
alter table ssmm_spike1.move_custody enable row level security;
alter table ssmm_spike1.adjustment_subloops enable row level security;
alter table ssmm_spike1.metabolize_states enable row level security;
alter table ssmm_spike1.events enable row level security;

alter table ssmm_spike1.main_loops force row level security;
alter table ssmm_spike1.sense_states force row level security;
alter table ssmm_spike1.shape_proposals force row level security;
alter table ssmm_spike1.installed_shapes force row level security;
alter table ssmm_spike1.move_custody force row level security;
alter table ssmm_spike1.adjustment_subloops force row level security;
alter table ssmm_spike1.metabolize_states force row level security;
alter table ssmm_spike1.events force row level security;

-- service_role carries BYPASSRLS. Policies document the intended role while
-- explicit schema/table/function grants remain the enforceable access rail.
create policy main_loops_service_role_only on ssmm_spike1.main_loops
for all to service_role using (true) with check (true);
create policy sense_states_service_role_only on ssmm_spike1.sense_states
for all to service_role using (true) with check (true);
create policy shape_proposals_service_role_only on ssmm_spike1.shape_proposals
for all to service_role using (true) with check (true);
create policy installed_shapes_service_role_only on ssmm_spike1.installed_shapes
for all to service_role using (true) with check (true);
create policy move_custody_service_role_only on ssmm_spike1.move_custody
for all to service_role using (true) with check (true);
create policy adjustment_subloops_service_role_only on ssmm_spike1.adjustment_subloops
for all to service_role using (true) with check (true);
create policy metabolize_states_service_role_only on ssmm_spike1.metabolize_states
for all to service_role using (true) with check (true);
create policy events_service_role_only on ssmm_spike1.events
for all to service_role using (true) with check (true);

revoke all on all tables in schema ssmm_spike1 from public, anon, authenticated;
grant select, insert, update on all tables in schema ssmm_spike1 to service_role;

create or replace function ssmm_spike1.get_loop_state(p_loop_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ssmm_spike1, public
as $$
  select jsonb_build_object(
    'loop_id', l.id,
    'loop_status', l.loop_status,
    'authoritative_phase', l.authoritative_phase,
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

create or replace function ssmm_spike1.get_current_loop_state()
returns jsonb
language sql
stable
security invoker
set search_path = ssmm_spike1, public
as $$
  select ssmm_spike1.get_loop_state(l.id)
  from ssmm_spike1.main_loops l
  where l.loop_status in ('active', 'unknown')
  order by l.updated_at desc
  limit 1;
$$;

create or replace function ssmm_spike1.get_latest_loop_state()
returns jsonb
language sql
stable
security invoker
set search_path = ssmm_spike1, public
as $$
  select ssmm_spike1.get_loop_state(l.id)
  from ssmm_spike1.main_loops l
  order by l.updated_at desc
  limit 1;
$$;

create or replace function ssmm_spike1.apply_runtime_events(
  p_loop_id uuid,
  p_client_event_id text,
  p_events jsonb,
  p_protocol_version text,
  p_prompt_version text,
  p_invocation_source text,
  p_next_state jsonb,
  p_close_loop boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ssmm_spike1, public
as $$
declare
  v_loop ssmm_spike1.main_loops;
  v_event ssmm_spike1.events;
  v_events jsonb := '[]'::jsonb;
  v_item jsonb;
  v_proposal jsonb;
  v_installed jsonb := p_next_state->'installed_shape';
  v_custody jsonb := p_next_state->'move_custody';
  v_adjustment jsonb := p_next_state->'active_adjustment';
  v_metabolize jsonb := p_next_state->'metabolize_state';
  v_ordinal integer := 0;
  v_sequence integer;
  v_prior_phase text;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'events_required' using errcode = '22023';
  end if;
  if p_client_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$' then
    raise exception 'invalid_client_event_id' using errcode = '22023';
  end if;

  select * into v_event
  from ssmm_spike1.events
  where client_event_id = p_client_event_id;

  if found then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence_number), '[]'::jsonb)
    into v_events
    from ssmm_spike1.events e
    where e.client_event_id = p_client_event_id
       or e.client_event_id like p_client_event_id || ':%';

    return jsonb_build_object(
      'idempotent_replay', true,
      'loop', ssmm_spike1.get_loop_state(v_event.loop_id),
      'events', v_events
    );
  end if;

  begin
    if p_loop_id is null then
      insert into ssmm_spike1.main_loops (
        loop_status, authoritative_phase, current_step,
        protocol_version, prompt_version, invocation_source,
        working_state, purpose_handle, orientation_handle, no_active_reason
      ) values (
        p_next_state->>'loop_status',
        p_next_state->>'authoritative_phase',
        p_next_state->>'current_step',
        p_protocol_version,
        p_prompt_version,
        p_invocation_source,
        coalesce(p_next_state->'working_state', '{}'::jsonb),
        p_next_state->'purpose_handle',
        p_next_state->'orientation_handle',
        coalesce(p_next_state->>'no_active_reason', 'never_started')
      )
      returning * into v_loop;
      v_prior_phase := null;
    else
      select * into v_loop
      from ssmm_spike1.main_loops
      where id = p_loop_id
      for update;

      if not found then
        raise exception 'loop_not_found' using errcode = 'P0002';
      end if;
      if v_loop.loop_status in ('closed', 'disposed') then
        raise exception 'terminal_loop' using errcode = '55000';
      end if;
      v_prior_phase := v_loop.authoritative_phase;
    end if;

    -- The main-loop row lock serializes sequence allocation. The unique
    -- constraint is a backstop, not the ordering mechanism.
    select coalesce(max(sequence_number), 0) + 1
    into v_sequence
    from ssmm_spike1.events
    where loop_id = v_loop.id;

    for v_item in select value from jsonb_array_elements(p_events)
    loop
      insert into ssmm_spike1.events (
        loop_id, sequence_number, client_event_id, event_type, actor,
        perspective, payload, protocol_version, prompt_version
      ) values (
        v_loop.id,
        v_sequence + v_ordinal,
        case when v_ordinal = 0 then p_client_event_id
             else p_client_event_id || ':' || v_ordinal::text end,
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

    update ssmm_spike1.main_loops
    set loop_status = p_next_state->>'loop_status',
        authoritative_phase = p_next_state->>'authoritative_phase',
        phase_entered_at = case
          when v_prior_phase is distinct from p_next_state->>'authoritative_phase'
          then now() else phase_entered_at end,
        current_step = p_next_state->>'current_step',
        protocol_version = p_protocol_version,
        prompt_version = p_prompt_version,
        working_state = coalesce(p_next_state->'working_state', '{}'::jsonb),
        purpose_handle = p_next_state->'purpose_handle',
        orientation_handle = p_next_state->'orientation_handle',
        no_active_reason = coalesce(
          p_next_state->>'no_active_reason',
          no_active_reason
        ),
        updated_at = now(),
        closed_at = case when p_close_loop then now() else closed_at end
    where id = v_loop.id;

    insert into ssmm_spike1.sense_states (
      loop_id, grounded_inputs, field_representation, uncertainties,
      material_constraints, purpose_orientation_context,
      sense_completion_basis, inherited_residue
    ) values (
      v_loop.id,
      coalesce(p_next_state->'sense_state'->'grounded_inputs', '[]'::jsonb),
      coalesce(p_next_state->'sense_state'->'field_representation', '{}'::jsonb),
      coalesce(p_next_state->'sense_state'->'uncertainties', '[]'::jsonb),
      coalesce(p_next_state->'sense_state'->'material_constraints', '[]'::jsonb),
      coalesce(p_next_state->'sense_state'->'purpose_orientation_context', '{}'::jsonb),
      p_next_state->'sense_state'->>'sense_completion_basis',
      p_next_state->'sense_state'->'inherited_residue'
    )
    on conflict (loop_id) do update set
      grounded_inputs = excluded.grounded_inputs,
      field_representation = excluded.field_representation,
      uncertainties = excluded.uncertainties,
      material_constraints = excluded.material_constraints,
      purpose_orientation_context = excluded.purpose_orientation_context,
      sense_completion_basis = excluded.sense_completion_basis,
      inherited_residue = excluded.inherited_residue,
      updated_at = now();

    for v_proposal in
      select value from jsonb_array_elements(
        coalesce(p_next_state->'shape_proposals', '[]'::jsonb)
      )
    loop
      insert into ssmm_spike1.shape_proposals (
        id, loop_id, proposal_version, proposal_content,
        machine_interpretation, proposal_status, created_at
      ) values (
        (v_proposal->>'id')::uuid,
        v_loop.id,
        (v_proposal->>'proposal_version')::integer,
        v_proposal->'proposal_content',
        coalesce(v_proposal->'machine_interpretation', '{}'::jsonb),
        v_proposal->>'proposal_status',
        (v_proposal->>'created_at')::timestamptz
      )
      on conflict (id) do update set
        proposal_content = excluded.proposal_content,
        machine_interpretation = excluded.machine_interpretation,
        proposal_status = excluded.proposal_status;
    end loop;

    if v_installed is not null and jsonb_typeof(v_installed) = 'object' then
      insert into ssmm_spike1.installed_shapes (
        loop_id, accepted_proposal_id, accepted_by, accepted_at,
        move_target, decision, orientation, immediate_why,
        reason_chain_handles, exit_condition, degrees_of_freedom,
        quick_check_adjustments, help_required_conditions,
        invalidation_conditions, anticipated_obstacles,
        completion_evidence, installation_requirements,
        installation_actions, installation_status, installed_at,
        declared_starting_conditions, small_move_exception,
        installation_waiver, transition_event_identifier, shape_version,
        first_physical_action, interruption_handling, cockpit_cues,
        uncertainty, purpose_handle
      ) values (
        v_loop.id,
        (v_installed->>'accepted_proposal_id')::uuid,
        v_installed->>'accepted_by',
        (v_installed->>'accepted_at')::timestamptz,
        v_installed->>'move_target',
        v_installed->>'decision',
        v_installed->>'orientation',
        v_installed->>'immediate_why',
        coalesce(v_installed->'reason_chain_handles', '[]'::jsonb),
        v_installed->>'exit_condition',
        coalesce(v_installed->'degrees_of_freedom', '[]'::jsonb),
        coalesce(v_installed->'quick_check_adjustments', '[]'::jsonb),
        coalesce(v_installed->'help_required_conditions', '[]'::jsonb),
        coalesce(v_installed->'invalidation_conditions', '[]'::jsonb),
        coalesce(v_installed->'anticipated_obstacles', '[]'::jsonb),
        coalesce(v_installed->'completion_evidence', '[]'::jsonb),
        coalesce(v_installed->'installation_requirements', '[]'::jsonb),
        coalesce(v_installed->'installation_actions', '[]'::jsonb),
        v_installed->>'installation_status',
        nullif(v_installed->>'installed_at', '')::timestamptz,
        coalesce(v_installed->>'declared_starting_conditions', ''),
        coalesce((v_installed->>'small_move_exception')::boolean, false),
        v_installed->>'installation_waiver',
        v_installed->>'transition_event_identifier',
        (v_installed->>'shape_version')::integer,
        v_installed->>'first_physical_action',
        v_installed->>'interruption_handling',
        coalesce(v_installed->'cockpit_cues', '[]'::jsonb),
        v_installed->>'uncertainty',
        v_installed->'purpose_handle'
      )
      on conflict (loop_id) do update set
        installation_actions = excluded.installation_actions,
        installation_status = excluded.installation_status,
        installed_at = excluded.installed_at,
        installation_waiver = excluded.installation_waiver,
        transition_event_identifier = excluded.transition_event_identifier,
        updated_at = now();
    end if;

    if v_custody is not null and jsonb_typeof(v_custody) = 'object' then
      insert into ssmm_spike1.move_custody (
        loop_id, move_position, latest_progress, latest_interruption,
        active_friction, pause_reason, last_resumed_at, completion_claim,
        evidence_supplied, current_disposition, pending_changed_conditions
      ) values (
        v_loop.id,
        v_custody->>'move_position',
        v_custody->'latest_progress',
        v_custody->'latest_interruption',
        v_custody->'active_friction',
        v_custody->>'pause_reason',
        nullif(v_custody->>'last_resumed_at', '')::timestamptz,
        v_custody->'completion_claim',
        coalesce(v_custody->'evidence_supplied', '[]'::jsonb),
        v_custody->>'current_disposition',
        v_custody->'pending_changed_conditions'
      )
      on conflict (loop_id) do update set
        move_position = excluded.move_position,
        latest_progress = excluded.latest_progress,
        latest_interruption = excluded.latest_interruption,
        active_friction = excluded.active_friction,
        pause_reason = excluded.pause_reason,
        last_resumed_at = excluded.last_resumed_at,
        completion_claim = excluded.completion_claim,
        evidence_supplied = excluded.evidence_supplied,
        current_disposition = excluded.current_disposition,
        pending_changed_conditions = excluded.pending_changed_conditions,
        updated_at = now();
    end if;

    if v_adjustment is not null and jsonb_typeof(v_adjustment) = 'object' then
      insert into ssmm_spike1.adjustment_subloops (
        id, parent_loop_id, parent_phase, parent_shape_version,
        reported_change, adjustment_classification, adjustment_boundary,
        nested_phase, adjustment_shape, result, effect_on_parent,
        started_at, closed_at
      ) values (
        (v_adjustment->>'id')::uuid,
        v_loop.id,
        v_adjustment->>'parent_phase',
        (v_adjustment->>'parent_shape_version')::integer,
        v_adjustment->>'reported_change',
        v_adjustment->>'adjustment_classification',
        v_adjustment->>'adjustment_boundary',
        v_adjustment->>'nested_phase',
        v_adjustment->>'adjustment_shape',
        v_adjustment->>'result',
        v_adjustment->>'effect_on_parent',
        (v_adjustment->>'started_at')::timestamptz,
        nullif(v_adjustment->>'closed_at', '')::timestamptz
      )
      on conflict (id) do update set
        nested_phase = excluded.nested_phase,
        result = excluded.result,
        effect_on_parent = excluded.effect_on_parent,
        closed_at = excluded.closed_at;
    end if;

    if v_metabolize is not null and jsonb_typeof(v_metabolize) = 'object' then
      insert into ssmm_spike1.metabolize_states (
        loop_id, move_disposition, exit_condition_snapshot,
        completion_claim_snapshot, verification_result,
        verification_assessment, credited_result, consequences, residue,
        released_material, lessons, closure_basis, residue_confirmed
      ) values (
        v_loop.id,
        v_metabolize->>'move_disposition',
        coalesce(v_metabolize->>'exit_condition_snapshot', ''),
        v_metabolize->'completion_claim_snapshot',
        nullif(v_metabolize->>'verification_result', ''),
        v_metabolize->'verification_assessment',
        v_metabolize->>'credited_result',
        coalesce(v_metabolize->'consequences', '[]'::jsonb),
        v_metabolize->'residue',
        coalesce(v_metabolize->'released_material', '[]'::jsonb),
        coalesce(v_metabolize->'lessons', '[]'::jsonb),
        v_metabolize->>'closure_basis',
        coalesce((v_metabolize->>'residue_confirmed')::boolean, false)
      )
      on conflict (loop_id) do update set
        move_disposition = excluded.move_disposition,
        exit_condition_snapshot = excluded.exit_condition_snapshot,
        completion_claim_snapshot = excluded.completion_claim_snapshot,
        verification_result = excluded.verification_result,
        verification_assessment = excluded.verification_assessment,
        credited_result = excluded.credited_result,
        consequences = excluded.consequences,
        residue = excluded.residue,
        released_material = excluded.released_material,
        lessons = excluded.lessons,
        closure_basis = excluded.closure_basis,
        residue_confirmed = excluded.residue_confirmed,
        updated_at = now();
    end if;

    return jsonb_build_object(
      'idempotent_replay', false,
      'loop', ssmm_spike1.get_loop_state(v_loop.id),
      'events', v_events
    );
  exception when unique_violation then
    select * into v_event
    from ssmm_spike1.events
    where client_event_id = p_client_event_id;

    if found then
      select coalesce(jsonb_agg(to_jsonb(e) order by e.sequence_number), '[]'::jsonb)
      into v_events
      from ssmm_spike1.events e
      where e.client_event_id = p_client_event_id
         or e.client_event_id like p_client_event_id || ':%';

      return jsonb_build_object(
        'idempotent_replay', true,
        'loop', ssmm_spike1.get_loop_state(v_event.loop_id),
        'events', v_events
      );
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_events) requested
      join ssmm_spike1.events existing
        on existing.loop_id = v_loop.id
       and existing.event_type = requested->>'event_type'
      where requested->>'event_type' in (
        'shape_installed', 'parent_entered_move',
        'parent_entered_metabolize', 'loop_closed', 'loop_disposed'
      )
    ) then
      raise exception 'authoritative_transition_already_recorded'
        using errcode = '55000';
    end if;
    raise;
  end;
end;
$$;

revoke all on function ssmm_spike1.get_loop_state(uuid)
from public, anon, authenticated;
revoke all on function ssmm_spike1.get_current_loop_state()
from public, anon, authenticated;
revoke all on function ssmm_spike1.get_latest_loop_state()
from public, anon, authenticated;
revoke all on function ssmm_spike1.apply_runtime_events(
  uuid, text, jsonb, text, text, text, jsonb, boolean
) from public, anon, authenticated;

grant execute on function ssmm_spike1.get_loop_state(uuid) to service_role;
grant execute on function ssmm_spike1.get_current_loop_state() to service_role;
grant execute on function ssmm_spike1.get_latest_loop_state() to service_role;
grant execute on function ssmm_spike1.apply_runtime_events(
  uuid, text, jsonb, text, text, text, jsonb, boolean
) to service_role;
