begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

create or replace function pg_temp.request_fingerprint(p_text text)
returns text language sql immutable as $$
  select encode(extensions.digest(convert_to(p_text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function pg_temp.initial_state()
returns jsonb language sql immutable as $$
  select '{"loop_status":"active","authoritative_phase":"sense","current_step":"sense_entry","working_state":{},"purpose_handle":{"id":"purpose","label":"Purpose"},"orientation_handle":{"id":"orientation","label":"Orientation"},"no_active_reason":"never_started","sense_state":{"grounded_inputs":[],"field_representation":{},"uncertainties":[],"material_constraints":[],"purpose_orientation_context":{},"sense_completion_basis":null,"inherited_residue":null},"shape_proposals":[],"proposed_shape":null,"installed_shape":null,"move_custody":null,"active_adjustment":null,"metabolize_state":null}'::jsonb;
$$;

create or replace function pg_temp.shape_content(p_target text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'move_target', p_target, 'decision', 'Do the bounded Move',
    'orientation', 'Prefer contact over abstraction',
    'immediate_why', 'The live obligation is here',
    'reason_chain_handles', jsonb_build_array('project:test'),
    'exit_condition', 'One bounded result exists',
    'degrees_of_freedom', jsonb_build_array('wording'),
    'quick_check_adjustments', jsonb_build_array('location'),
    'help_required_conditions', jsonb_build_array('target changes'),
    'invalidation_conditions', jsonb_build_array('target disappears'),
    'anticipated_obstacles', jsonb_build_array('fatigue'),
    'completion_evidence', jsonb_build_array('saved result'),
    'installation_requirements', jsonb_build_array('open workspace'),
    'first_physical_action', 'Open the workspace',
    'interruption_handling', 'Return through the cockpit',
    'cockpit_cues', jsonb_build_array('show exit'),
    'uncertainty', 'Energy may change',
    'purpose_handle', jsonb_build_object('id', 'purpose', 'label', 'Purpose')
  );
$$;

create or replace function pg_temp.proposal(p_id uuid, p_version integer, p_status text, p_target text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_id, 'proposal_version', p_version,
    'proposal_content', pg_temp.shape_content(p_target),
    'machine_interpretation', '{}'::jsonb,
    'proposal_status', p_status,
    'created_at', format('2026-07-31T00:00:%sZ', lpad(p_version::text, 2, '0'))
  );
$$;

create or replace function pg_temp.installed_shape(p_id uuid, p_version integer, p_status text default 'pending')
returns jsonb language sql immutable as $$
  select pg_temp.shape_content('Proposal B target') || jsonb_build_object(
    'accepted_proposal_id', p_id, 'accepted_by', 'levi',
    'accepted_at', '2026-07-31T00:05:00Z',
    'installation_actions', case when p_status = 'pending' then '[]'::jsonb else '[{"description":"Opened workspace","evidence":"visible","completed_at":"2026-07-31T00:06:00Z"}]'::jsonb end,
    'installation_status', p_status, 'installed_at', null,
    'declared_starting_conditions', 'At the desk',
    'small_move_exception', false, 'installation_waiver', null,
    'transition_event_identifier', null, 'shape_version', p_version
  );
$$;

create or replace function pg_temp.apply_request(
  p_loop_id uuid, p_client_event_id text, p_action text,
  p_expected_revision bigint, p_proposal_id uuid, p_proposal_version integer,
  p_input jsonb, p_events jsonb, p_next_state jsonb, p_close boolean default false
)
returns jsonb language plpgsql as $$
declare v_canonical jsonb; v_text text;
begin
  v_canonical := jsonb_build_object(
    'accepted_proposal_id', p_proposal_id,
    'accepted_proposal_version', p_proposal_version,
    'action', p_action,
    'client', jsonb_build_object('shortcut_version', 'pgTAP-v0.3', 'source', 'direct_test'),
    'expected_loop_revision', p_expected_revision,
    'input', coalesce(p_input, '{}'::jsonb),
    'loop_id', p_loop_id,
    'protocol_version', 'spike1-slice-contract-0.3'
  );
  v_text := v_canonical::text;
  return ssmm_spike1.apply_runtime_events(
    p_loop_id, p_client_event_id, p_action, v_canonical, v_text,
    pg_temp.request_fingerprint(v_text), p_expected_revision,
    p_proposal_id, p_proposal_version, p_events,
    'spike1-slice-contract-0.3', 'spike1-shape-0.3', 'direct_test',
    p_next_state, p_close
  );
end;
$$;

select has_column('ssmm_spike1', 'main_loops', 'authoritative_revision', 'main loop has a monotonic authoritative revision');
select has_table('ssmm_spike1', 'runtime_requests', 'semantic request ledger exists');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ssmm_spike1' and c.relname = 'runtime_requests'), 'request ledger has RLS enabled');

create temporary table opened as
select pg_temp.apply_request(
  null, 'test-open-0001', 'open_current_surface', null, null, null, '{}'::jsonb,
  '[{"event_type":"loop_created","actor":"system","perspective":"lr_system_evidence","payload":{}},{"event_type":"sense_started","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb,
  pg_temp.initial_state()
) as result;

select is((select (result->'loop'->>'authoritative_revision')::bigint from opened), 1::bigint, 'initial persisted mutation returns revision one');
select is((select authoritative_revision from ssmm_spike1.main_loops where id = ((select result->'loop'->>'loop_id' from opened))::uuid), 1::bigint, 'initial mutation increments the row exactly once');
select is((select count(*)::integer from ssmm_spike1.runtime_requests), 1, 'initial mutation records one semantic request');

create temporary table replay as
select pg_temp.apply_request(
  null, 'test-open-0001', 'open_current_surface', null, null, null, '{}'::jsonb,
  '[{"event_type":"loop_created","actor":"system","perspective":"lr_system_evidence","payload":{}},{"event_type":"sense_started","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb,
  pg_temp.initial_state()
) as result;
select ok((select (result->>'idempotent_replay')::boolean from replay), 'same event ID plus identical semantic request replays');
select is((select authoritative_revision from ssmm_spike1.main_loops where id = ((select result->'loop'->>'loop_id' from opened))::uuid), 1::bigint, 'identical replay does not increment revision');

select throws_ok($$select pg_temp.apply_request(null, 'test-open-0001', 'submit_sense_input', 1, null, null, '{}'::jsonb, '[{"event_type":"sense_input_recorded","actor":"levi","perspective":"ul_levi_report","payload":{}}]'::jsonb, pg_temp.initial_state())$$, '40001', 'idempotency_fingerprint_conflict', 'same event ID plus different action conflicts');
select throws_ok($$select pg_temp.apply_request(null, 'test-open-0001', 'open_current_surface', null, null, null, '{"different":true}'::jsonb, '[{"event_type":"loop_created","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb, pg_temp.initial_state())$$, '40001', 'idempotency_fingerprint_conflict', 'same event ID plus different payload conflicts');
select throws_ok($$select pg_temp.apply_request(null, 'test-open-0001', 'open_current_surface', 1, null, null, '{}'::jsonb, '[{"event_type":"loop_created","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb, pg_temp.initial_state())$$, '40001', 'idempotency_fingerprint_conflict', 'same event ID plus different expected revision conflicts');

create temporary table proposal_a_state as
select jsonb_set(jsonb_set(jsonb_set((select result->'loop' from opened), '{authoritative_phase}', '"shape"'::jsonb), '{current_step}', '"shape_review"'::jsonb), '{shape_proposals}', jsonb_build_array(pg_temp.proposal('00000000-0000-4000-8000-000000000101'::uuid, 1, 'proposed', 'Proposal A target'))) || jsonb_build_object('proposed_shape', pg_temp.proposal('00000000-0000-4000-8000-000000000101'::uuid, 1, 'proposed', 'Proposal A target')) as state;
create temporary table proposal_a as
select pg_temp.apply_request(((select result->'loop'->>'loop_id' from opened))::uuid, 'test-proposal-a-0001', 'request_shape_proposal', 1, null, null, '{"sense_completion_basis":"enough"}'::jsonb, '[{"event_type":"shape_proposal_created","actor":"runtime","perspective":"proposal","payload":{}}]'::jsonb, (select state from proposal_a_state)) as result;
select is((select (result->'loop'->>'authoritative_revision')::bigint from proposal_a), 2::bigint, 'proposal A mutation increments revision to two');

create temporary table proposal_b_state as
select jsonb_set(jsonb_set((select result->'loop' from proposal_a), '{shape_proposals}', jsonb_build_array(pg_temp.proposal('00000000-0000-4000-8000-000000000101'::uuid, 1, 'superseded', 'Proposal A target'), pg_temp.proposal('00000000-0000-4000-8000-000000000102'::uuid, 2, 'proposed', 'Proposal B target'))), '{proposed_shape}', pg_temp.proposal('00000000-0000-4000-8000-000000000102'::uuid, 2, 'proposed', 'Proposal B target')) as state;
create temporary table proposal_b as
select pg_temp.apply_request(((select result->'loop'->>'loop_id' from opened))::uuid, 'test-proposal-b-0001', 'correct_shape_proposal', 2, null, null, '{"correction":"Use B"}'::jsonb, '[{"event_type":"shape_proposal_corrected","actor":"levi","perspective":"ul_levi_report","payload":{}},{"event_type":"shape_proposal_created","actor":"runtime","perspective":"proposal","payload":{}}]'::jsonb, (select state from proposal_b_state)) as result;
select is((select (result->'loop'->>'authoritative_revision')::bigint from proposal_b), 3::bigint, 'proposal B supersession increments revision to three');
select is((select proposal_status from ssmm_spike1.shape_proposals where id = '00000000-0000-4000-8000-000000000101'::uuid), 'superseded', 'proposal A is superseded');
select is((select proposal_status from ssmm_spike1.shape_proposals where id = '00000000-0000-4000-8000-000000000102'::uuid), 'proposed', 'proposal B is the current eligible proposal');

create temporary table before_stale as
select (select authoritative_revision from ssmm_spike1.main_loops where id = ((select result->'loop'->>'loop_id' from opened))::uuid) as revision,
       (select count(*) from ssmm_spike1.events where loop_id = ((select result->'loop'->>'loop_id' from opened))::uuid) as events,
       (select count(*) from ssmm_spike1.installed_shapes where loop_id = ((select result->'loop'->>'loop_id' from opened))::uuid) as installed;

select throws_ok(format($sql$select pg_temp.apply_request(%L::uuid, 'test-stale-accept-0001', 'accept_shape_proposal', 3, '00000000-0000-4000-8000-000000000101'::uuid, 1, '{"declared_starting_conditions":"At desk"}'::jsonb, '[{"event_type":"shape_proposal_accepted","actor":"levi","perspective":"decision","payload":{}}]'::jsonb, %L::jsonb)$sql$, (select result->'loop'->>'loop_id' from opened), (select state::text from proposal_b_state)), '40001', 'stale_proposal', 'acceptance naming superseded proposal A is rejected');
select is((select authoritative_revision from ssmm_spike1.main_loops where id = ((select result->'loop'->>'loop_id' from opened))::uuid), (select revision from before_stale), 'stale proposal does not increment revision');
select is((select count(*) from ssmm_spike1.events where loop_id = ((select result->'loop'->>'loop_id' from opened))::uuid), (select events from before_stale), 'stale proposal produces no event');
select is((select count(*) from ssmm_spike1.installed_shapes where loop_id = ((select result->'loop'->>'loop_id' from opened))::uuid), (select installed from before_stale), 'stale proposal produces no installed projection');
select is((select proposal_status from ssmm_spike1.shape_proposals where id = '00000000-0000-4000-8000-000000000102'::uuid), 'proposed', 'stale proposal leaves the current proposal eligible');

select throws_ok(format($sql$select pg_temp.apply_request(%L::uuid, 'test-stale-revision-0001', 'submit_sense_input', 2, null, null, '{"grounded_input":"stale"}'::jsonb, '[{"event_type":"sense_input_recorded","actor":"levi","perspective":"ul_levi_report","payload":{}}]'::jsonb, %L::jsonb)$sql$, (select result->'loop'->>'loop_id' from opened), (select state::text from proposal_b_state)), '40001', 'stale_loop_revision', 'stale loop revision is rejected under the row lock');
select is((select authoritative_revision from ssmm_spike1.main_loops where id = ((select result->'loop'->>'loop_id' from opened))::uuid), 3::bigint, 'stale revision produces no revision increment');

create temporary table accepted_state as
select jsonb_set(jsonb_set(jsonb_set((select result->'loop' from proposal_b), '{shape_proposals}', jsonb_build_array(pg_temp.proposal('00000000-0000-4000-8000-000000000101'::uuid, 1, 'superseded', 'Proposal A target'), pg_temp.proposal('00000000-0000-4000-8000-000000000102'::uuid, 2, 'accepted', 'Proposal B target'))), '{proposed_shape}', 'null'::jsonb), '{installed_shape}', pg_temp.installed_shape('00000000-0000-4000-8000-000000000102'::uuid, 2, 'pending')) as state;
create temporary table accepted as
select pg_temp.apply_request(((select result->'loop'->>'loop_id' from opened))::uuid, 'test-accept-b-0001', 'accept_shape_proposal', 3, '00000000-0000-4000-8000-000000000102'::uuid, 2, '{"declared_starting_conditions":"At desk"}'::jsonb, '[{"event_type":"shape_proposal_accepted","actor":"levi","perspective":"decision","payload":{}},{"event_type":"shape_installation_started","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb, (select state from accepted_state)) as result;
select is((select (result->'loop'->>'authoritative_revision')::bigint from accepted), 4::bigint, 'proposal-bound acceptance increments revision exactly once');
select is((select accepted_proposal_id from ssmm_spike1.installed_shapes where loop_id = ((select result->'loop'->>'loop_id' from opened))::uuid), '00000000-0000-4000-8000-000000000102'::uuid, 'installed projection is bound to proposal B');
select is((select proposal_status from ssmm_spike1.shape_proposals where id = '00000000-0000-4000-8000-000000000102'::uuid), 'accepted', 'accepted proposal status is durable');

create temporary table installation_state as
select jsonb_set((select result->'loop' from accepted), '{installed_shape}', pg_temp.installed_shape('00000000-0000-4000-8000-000000000102'::uuid, 2, 'in_progress')) as state;
create temporary table installation_action as
select pg_temp.apply_request(((select result->'loop'->>'loop_id' from opened))::uuid, 'test-install-action-0001', 'record_installation_action', 4, '00000000-0000-4000-8000-000000000102'::uuid, 2, '{"description":"Opened workspace"}'::jsonb, '[{"event_type":"shape_installation_action_recorded","actor":"levi","perspective":"ur_observed_behavior","payload":{}}]'::jsonb, (select state from installation_state)) as result;
select is((select (result->'loop'->>'authoritative_revision')::bigint from installation_action), 5::bigint, 'installation action increments revision exactly once');
select is((select shape_version from ssmm_spike1.installed_shapes where loop_id = ((select result->'loop'->>'loop_id' from opened))::uuid), 2, 'installation remains bound to accepted proposal version two');
select throws_ok(format($sql$select pg_temp.apply_request(%L::uuid, 'test-install-wrong-proposal-0001', 'record_installation_action', 5, '00000000-0000-4000-8000-000000000101'::uuid, 1, '{"description":"Wrong proposal"}'::jsonb, '[{"event_type":"shape_installation_action_recorded","actor":"levi","perspective":"ur_observed_behavior","payload":{}}]'::jsonb, %L::jsonb)$sql$, (select result->'loop'->>'loop_id' from opened), (select state::text from installation_state)), '40001', 'stale_proposal', 'installation action naming another proposal is rejected');
select is((select authoritative_revision from ssmm_spike1.main_loops where id = ((select result->'loop'->>'loop_id' from opened))::uuid), 5::bigint, 'wrong-proposal installation attempt produces no revision increment');
select is((select resulting_loop_revision from ssmm_spike1.runtime_requests where client_event_id = 'test-install-action-0001'), 5::bigint, 'request ledger records the exact resulting revision');
select is((select length(request_fingerprint) from ssmm_spike1.runtime_requests where client_event_id = 'test-install-action-0001'), 64, 'request ledger stores a SHA-256 fingerprint');

update ssmm_spike1.main_loops set loop_status = 'closed', closed_at = now() where id = ((select result->'loop'->>'loop_id' from opened))::uuid;
create temporary table second_open as
select pg_temp.apply_request(null, 'test-open-second-0001', 'open_current_surface', null, null, null, '{}'::jsonb, '[{"event_type":"loop_created","actor":"system","perspective":"lr_system_evidence","payload":{}},{"event_type":"sense_started","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb, pg_temp.initial_state()) as result;
select is((select (result->'loop'->>'authoritative_revision')::bigint from second_open), 1::bigint, 'second loop starts at revision one');
select throws_ok(format($sql$select pg_temp.apply_request(%L::uuid, 'test-open-0001', 'submit_sense_input', 1, null, null, '{"grounded_input":"other loop"}'::jsonb, '[{"event_type":"sense_input_recorded","actor":"levi","perspective":"ul_levi_report","payload":{}}]'::jsonb, %L::jsonb)$sql$, (select result->'loop'->>'loop_id' from second_open), ((select result->'loop' from second_open))::text), '40001', 'idempotency_fingerprint_conflict', 'same event ID reused for another loop conflicts');
select is((select count(*)::integer from ssmm_spike1.runtime_requests where client_event_id = 'test-open-0001'), 1, 'cross-loop conflict leaves the original ledger entry unchanged');

select * from finish();
rollback;
