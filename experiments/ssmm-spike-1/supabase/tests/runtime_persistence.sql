begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select has_table('ssmm_spike1', 'main_loops', 'authoritative main loop exists');
select has_table('ssmm_spike1', 'sense_states', 'Sense state is separate');
select has_table('ssmm_spike1', 'shape_proposals', 'Shape proposals are separate');
select has_table('ssmm_spike1', 'installed_shapes', 'installed Shape is separate');
select has_table('ssmm_spike1', 'move_custody', 'Move custody is separate');
select has_table(
  'ssmm_spike1',
  'adjustment_subloops',
  'bounded adjustment subloops are separate'
);
select has_table(
  'ssmm_spike1',
  'metabolize_states',
  'Metabolize output is separate'
);
select has_table('ssmm_spike1', 'events', 'append-only events exist');

select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ssmm_spike1'
      and c.relname in (
        'main_loops', 'sense_states', 'shape_proposals', 'installed_shapes',
        'move_custody', 'adjustment_subloops', 'metabolize_states', 'events'
      )
      and c.relrowsecurity
  ),
  8,
  'RLS is enabled on every persisted object'
);

create temporary table initial_result as
select ssmm_spike1.apply_runtime_events(
  null,
  'test-open-0001',
  '[
    {"event_type":"loop_created","actor":"system","perspective":"lr_system_evidence","payload":{}},
    {"event_type":"sense_started","actor":"system","perspective":"lr_system_evidence","payload":{}}
  ]'::jsonb,
  'spike1-slice-contract-0.2',
  'spike1-shape-0.3',
  'direct_test',
  '{
    "loop_status":"active",
    "authoritative_phase":"sense",
    "current_step":"sense_entry",
    "working_state":{},
    "purpose_handle":{"id":"purpose","label":"Purpose"},
    "orientation_handle":{"id":"orientation","label":"Orientation"},
    "no_active_reason":"never_started",
    "sense_state":{
      "grounded_inputs":[],
      "field_representation":{},
      "uncertainties":[],
      "material_constraints":[],
      "purpose_orientation_context":{},
      "sense_completion_basis":null,
      "inherited_residue":null
    },
    "shape_proposals":[],
    "proposed_shape":null,
    "installed_shape":null,
    "move_custody":null,
    "active_adjustment":null,
    "metabolize_state":null
  }'::jsonb,
  false
) as result;

select is(
  (select jsonb_array_length(result->'events') from initial_result),
  2,
  'one request atomically persists loop creation and Sense entry'
);
select is(
  (
    select count(*)::integer from ssmm_spike1.events
    where loop_id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  2,
  'two initial event rows exist'
);
select is(
  (select result->'loop'->>'authoritative_phase' from initial_result),
  'sense',
  'authoritative phase begins in Sense'
);

create temporary table replay_result as
select ssmm_spike1.apply_runtime_events(
  null,
  'test-open-0001',
  '[{"event_type":"runtime_error","actor":"system","perspective":"defect","payload":{}}]'::jsonb,
  'wrong',
  'wrong',
  'direct_test',
  '{"loop_status":"unknown"}'::jsonb,
  false
) as result;

select ok(
  (select (result->>'idempotent_replay')::boolean from replay_result),
  'same client event id returns an idempotent replay'
);
select is(
  (
    select count(*)::integer from ssmm_spike1.events
    where loop_id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  2,
  'replay creates no extra events'
);

create temporary table move_state as
select jsonb_build_object(
  'loop_status', 'active',
  'authoritative_phase', 'move',
  'current_step', 'move_cockpit',
  'working_state', '{}'::jsonb,
  'purpose_handle', '{"id":"purpose","label":"Purpose"}'::jsonb,
  'orientation_handle', '{"id":"orientation","label":"Orientation"}'::jsonb,
  'no_active_reason', 'never_started',
  'sense_state', '{
    "grounded_inputs":[{"grounded_input":"The draft is due"}],
    "field_representation":{"demand":"draft"},
    "uncertainties":[],
    "material_constraints":["twenty minutes"],
    "purpose_orientation_context":{},
    "sense_completion_basis":"Enough grounded input",
    "inherited_residue":null
  }'::jsonb,
  'shape_proposals', jsonb_build_array(jsonb_build_object(
    'id', '00000000-0000-4000-8000-000000000102',
    'proposal_version', 1,
    'proposal_content', '{
      "move_target":"Write one paragraph",
      "decision":"Write before rescoping",
      "orientation":"Prefer contact over abstraction",
      "immediate_why":"The draft is live",
      "reason_chain_handles":["project:draft"],
      "exit_condition":"One paragraph exists",
      "degrees_of_freedom":["wording"],
      "quick_check_adjustments":["location"],
      "help_required_conditions":["assignment changes"],
      "invalidation_conditions":["draft canceled"],
      "anticipated_obstacles":["fatigue"],
      "completion_evidence":["saved paragraph"],
      "installation_requirements":["open draft"],
      "first_physical_action":"Open the draft",
      "interruption_handling":"Return through cockpit",
      "cockpit_cues":["show exit"],
      "uncertainty":"Energy unknown",
      "purpose_handle":{"id":"purpose","label":"Purpose"}
    }'::jsonb,
    'machine_interpretation', '{}'::jsonb,
    'proposal_status', 'accepted',
    'created_at', '2026-07-27T00:00:00Z'
  )),
  'proposed_shape', null,
  'installed_shape', '{
    "accepted_proposal_id":"00000000-0000-4000-8000-000000000102",
    "accepted_by":"levi",
    "accepted_at":"2026-07-27T00:01:00Z",
    "move_target":"Write one paragraph",
    "decision":"Write before rescoping",
    "orientation":"Prefer contact over abstraction",
    "immediate_why":"The draft is live",
    "reason_chain_handles":["project:draft"],
    "exit_condition":"One paragraph exists",
    "degrees_of_freedom":["wording"],
    "quick_check_adjustments":["location"],
    "help_required_conditions":["assignment changes"],
    "invalidation_conditions":["draft canceled"],
    "anticipated_obstacles":["fatigue"],
    "completion_evidence":["saved paragraph"],
    "installation_requirements":["open draft"],
    "installation_actions":[{"description":"Opened draft","evidence":"visible","completed_at":"2026-07-27T00:02:00Z"}],
    "installation_status":"installed",
    "installed_at":"2026-07-27T00:03:00Z",
    "declared_starting_conditions":"At desk",
    "small_move_exception":false,
    "installation_waiver":null,
    "transition_event_identifier":"test-install-0001",
    "shape_version":1,
    "first_physical_action":"Open the draft",
    "interruption_handling":"Return through cockpit",
    "cockpit_cues":["show exit"],
    "uncertainty":"Energy unknown",
    "purpose_handle":{"id":"purpose","label":"Purpose"}
  }'::jsonb,
  'move_custody', '{
    "move_position":"not_started",
    "latest_progress":null,
    "latest_interruption":null,
    "active_friction":null,
    "pause_reason":null,
    "last_resumed_at":null,
    "completion_claim":null,
    "evidence_supplied":[],
    "current_disposition":null,
    "pending_changed_conditions":null
  }'::jsonb,
  'active_adjustment', null,
  'metabolize_state', null
) as state;

select lives_ok(
  format(
    $sql$
      select ssmm_spike1.apply_runtime_events(
        %L::uuid,
        'test-install-0001',
        '[
          {"event_type":"shape_proposal_accepted","actor":"levi","perspective":"decision","payload":{}},
          {"event_type":"shape_installation_started","actor":"system","perspective":"lr_system_evidence","payload":{}},
          {"event_type":"shape_installation_action_recorded","actor":"levi","perspective":"ur_observed_behavior","payload":{}},
          {"event_type":"shape_installed","actor":"levi","perspective":"decision","payload":{}},
          {"event_type":"parent_entered_move","actor":"system","perspective":"lr_system_evidence","payload":{}}
        ]'::jsonb,
        'spike1-slice-contract-0.2',
        'spike1-shape-0.3',
        'direct_test',
        %L::jsonb,
        false
      )
    $sql$,
    (select result->'loop'->>'loop_id' from initial_result),
    (select state::text from move_state)
  ),
  'accepted proposal, installation, and Move custody persist atomically'
);

select is(
  (
    select count(*)::integer from ssmm_spike1.shape_proposals
    where loop_id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  1,
  'proposal has its own persisted record'
);
select is(
  (
    select installation_status from ssmm_spike1.installed_shapes
    where loop_id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  'installed',
  'authoritative installed Shape has its own record'
);
select is(
  (
    select move_position from ssmm_spike1.move_custody
    where loop_id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  'not_started',
  'Move custody has its own position record'
);
select is(
  (
    select authoritative_phase from ssmm_spike1.main_loops
    where id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  'move',
  'parent remains authoritatively in Move'
);
select is(
  (
    select count(*)::integer from ssmm_spike1.events
    where loop_id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
      and event_type in ('shape_installed', 'parent_entered_move')
  ),
  2,
  'critical Shape-to-Move seam records exactly one event of each type'
);

select throws_ok(
  format(
    $sql$
      select ssmm_spike1.apply_runtime_events(
        %L::uuid,
        'test-install-duplicate-0002',
        '[{"event_type":"parent_entered_move","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb,
        'spike1-slice-contract-0.2',
        'spike1-shape-0.3',
        'direct_test',
        %L::jsonb,
        false
      )
    $sql$,
    (select result->'loop'->>'loop_id' from initial_result),
    (select state::text from move_state)
  ),
  '55000',
  'authoritative_transition_already_recorded',
  'a different client request cannot repeat an authoritative seam transition'
);

update ssmm_spike1.main_loops
set closed_at = '2026-01-01T00:00:00Z'::timestamptz
where id = ((select result->'loop'->>'loop_id' from initial_result))::uuid;

select lives_ok(
  format(
    $sql$
      select ssmm_spike1.apply_runtime_events(
        %L::uuid,
        'test-progress-0001',
        '[{"event_type":"move_progress_recorded","actor":"levi","perspective":"ul_levi_report","payload":{}}]'::jsonb,
        'spike1-slice-contract-0.2',
        'spike1-shape-0.3',
        'direct_test',
        %L::jsonb,
        false
      )
    $sql$,
    (select result->'loop'->>'loop_id' from initial_result),
    (select state::text from move_state)
  ),
  'non-closing Move write succeeds'
);
select is(
  (
    select closed_at from ssmm_spike1.main_loops
    where id = ((select result->'loop'->>'loop_id' from initial_result))::uuid
  ),
  '2026-01-01T00:00:00Z'::timestamptz,
  'non-closing write preserves closed_at'
);

select is(
  has_table_privilege('anon', 'ssmm_spike1.main_loops', 'select'),
  false,
  'anon has no main-loop read grant'
);
select is(
  has_table_privilege('authenticated', 'ssmm_spike1.events', 'insert'),
  false,
  'authenticated has no event write grant'
);
select is(
  has_table_privilege('service_role', 'ssmm_spike1.main_loops', 'select'),
  true,
  'service role has the intended read grant'
);

update ssmm_spike1.main_loops
set loop_status = 'closed'
where id = ((select result->'loop'->>'loop_id' from initial_result))::uuid;

select throws_ok(
  format(
    $sql$
      select ssmm_spike1.apply_runtime_events(
        %L::uuid,
        'test-terminal-0001',
        '[{"event_type":"loop_resumed","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb,
        'spike1-slice-contract-0.2',
        'spike1-shape-0.3',
        'direct_test',
        %L::jsonb,
        false
      )
    $sql$,
    (select result->'loop'->>'loop_id' from initial_result),
    (select state::text from move_state)
  ),
  '55000',
  'terminal_loop',
  'closed or disposed loops cannot be reopened implicitly'
);

select * from finish();
rollback;
