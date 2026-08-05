-- SSMM Spike 1 database rollback.
--
-- This file is intentionally not a forward migration. Execute it only through
-- the reviewed rollback procedure. It removes the exact SSMM-owned footprint,
-- refuses unexplained objects, preserves platform extensions/defaults, and is
-- safe when only a prefix of the four forward migrations was applied.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

do $rollback_preflight$
declare
  v_unexpected text;
begin
  if not exists (
    select 1 from pg_namespace where nspname = 'ssmm_spike1'
  ) then
    return;
  end if;

  select string_agg(format('%s:%s', c.relkind, c.relname), ', ' order by c.relname)
  into v_unexpected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ssmm_spike1'
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    and c.relname <> all (array[
      'main_loops', 'sense_states', 'shape_proposals', 'installed_shapes',
      'move_custody', 'adjustment_subloops', 'metabolize_states', 'events',
      'runtime_requests'
    ]::text[]);
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_relations: %', v_unexpected;
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
  into v_unexpected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ssmm_spike1'
    and c.relkind = 'i'
    and c.relname <> all (array[
      'main_loops_pkey', 'main_loops_one_focal_active',
      'sense_states_pkey', 'shape_proposals_pkey',
      'shape_proposals_loop_id_proposal_version_key',
      'shape_proposals_one_current', 'installed_shapes_pkey',
      'move_custody_pkey', 'adjustment_subloops_pkey',
      'metabolize_states_pkey', 'events_pkey',
      'events_client_event_id_key', 'events_loop_id_sequence_number_key',
      'events_one_authoritative_seam_transition', 'runtime_requests_pkey'
    ]::text[]);
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_indexes: %', v_unexpected;
  end if;

  select string_agg(c.conname, ', ' order by c.conname)
  into v_unexpected
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'ssmm_spike1'
    and c.conname <> all (array[
      'main_loops_pkey', 'main_loops_loop_status_check',
      'main_loops_authoritative_phase_check',
      'main_loops_authoritative_revision_check', 'sense_states_pkey',
      'sense_states_loop_id_fkey', 'sense_states_grounded_inputs_check',
      'sense_states_uncertainties_check',
      'sense_states_material_constraints_check', 'shape_proposals_pkey',
      'shape_proposals_loop_id_fkey',
      'shape_proposals_proposal_version_check',
      'shape_proposals_proposal_status_check',
      'shape_proposals_loop_id_proposal_version_key',
      'installed_shapes_pkey', 'installed_shapes_loop_id_fkey',
      'installed_shapes_accepted_proposal_id_fkey',
      'installed_shapes_accepted_by_check',
      'installed_shapes_installation_status_check',
      'installed_shapes_shape_version_check', 'move_custody_pkey',
      'move_custody_loop_id_fkey', 'move_custody_move_position_check',
      'adjustment_subloops_pkey', 'adjustment_subloops_parent_loop_id_fkey',
      'adjustment_subloops_parent_phase_check',
      'adjustment_subloops_adjustment_classification_check',
      'adjustment_subloops_nested_phase_check', 'metabolize_states_pkey',
      'metabolize_states_loop_id_fkey',
      'metabolize_states_verification_result_check', 'events_pkey',
      'events_loop_id_fkey', 'events_sequence_number_check',
      'events_client_event_id_key', 'events_event_type_check',
      'events_actor_check', 'events_perspective_check',
      'events_loop_id_sequence_number_key', 'runtime_requests_pkey',
      'runtime_requests_client_event_id_check',
      'runtime_requests_loop_id_fkey',
      'runtime_requests_request_fingerprint_check',
      'runtime_requests_resulting_loop_revision_check',
      'runtime_requests_check'
    ]::text[]);
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_constraints: %', v_unexpected;
  end if;

  select string_agg(
    format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)),
    ', ' order by p.proname, oidvectortypes(p.proargtypes)
  )
  into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ssmm_spike1'
    and not (
      (p.proname = 'get_loop_state' and oidvectortypes(p.proargtypes) = 'uuid')
      or (p.proname = 'get_current_loop_state' and oidvectortypes(p.proargtypes) = '')
      or (p.proname = 'get_latest_loop_state' and oidvectortypes(p.proargtypes) = '')
      or (p.proname = 'prevent_proposal_identity_mutation' and oidvectortypes(p.proargtypes) = '')
      or (p.proname = 'assert_runtime_request_fingerprint'
          and oidvectortypes(p.proargtypes) = 'jsonb, text, text')
      or (p.proname = 'check_runtime_request'
          and oidvectortypes(p.proargtypes) = 'text, jsonb, text, text')
      or (p.proname = 'apply_runtime_events_unchecked'
          and oidvectortypes(p.proargtypes) =
            'uuid, text, jsonb, text, text, text, jsonb, boolean')
      or (p.proname = 'apply_runtime_events_existing_loop_core'
          and oidvectortypes(p.proargtypes) =
            'uuid, text, text, jsonb, text, text, bigint, uuid, integer, jsonb, text, text, text, jsonb, boolean')
      or (p.proname = 'apply_runtime_events'
          and oidvectortypes(p.proargtypes) in (
            'uuid, text, jsonb, text, text, text, jsonb, boolean',
            'uuid, text, text, jsonb, text, text, bigint, uuid, integer, jsonb, text, text, text, jsonb, boolean'
          ))
    );
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_routines: %', v_unexpected;
  end if;

  select string_agg(p.policyname, ', ' order by p.policyname)
  into v_unexpected
  from pg_policies p
  where p.schemaname = 'ssmm_spike1'
    and p.policyname <> all (array[
      'main_loops_service_role_only', 'sense_states_service_role_only',
      'shape_proposals_service_role_only', 'installed_shapes_service_role_only',
      'move_custody_service_role_only', 'adjustment_subloops_service_role_only',
      'metabolize_states_service_role_only', 'events_service_role_only',
      'runtime_requests_service_role_read'
    ]::text[]);
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_policies: %', v_unexpected;
  end if;

  select string_agg(t.tgname, ', ' order by t.tgname)
  into v_unexpected
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ssmm_spike1'
    and not t.tgisinternal
    and t.tgname <> 'shape_proposals_identity_immutable';
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_triggers: %', v_unexpected;
  end if;

  select string_agg(t.typname, ', ' order by t.typname)
  into v_unexpected
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'ssmm_spike1'
    and t.typtype in ('d', 'e', 'm', 'r');
  if v_unexpected is not null then
    raise exception 'ssmm_rollback_unexpected_types: %', v_unexpected;
  end if;
end;
$rollback_preflight$;

do $drop_optional_trigger$
begin
  if to_regclass('ssmm_spike1.shape_proposals') is not null then
    execute 'drop trigger if exists shape_proposals_identity_immutable on ssmm_spike1.shape_proposals';
  end if;
end;
$drop_optional_trigger$;

drop function if exists ssmm_spike1.apply_runtime_events(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) restrict;
drop function if exists ssmm_spike1.apply_runtime_events(
  uuid, text, jsonb, text, text, text, jsonb, boolean
) restrict;
drop function if exists ssmm_spike1.apply_runtime_events_existing_loop_core(
  uuid, text, text, jsonb, text, text, bigint, uuid, integer,
  jsonb, text, text, text, jsonb, boolean
) restrict;
drop function if exists ssmm_spike1.check_runtime_request(
  text, jsonb, text, text
) restrict;
drop function if exists ssmm_spike1.assert_runtime_request_fingerprint(
  jsonb, text, text
) restrict;
drop function if exists ssmm_spike1.apply_runtime_events_unchecked(
  uuid, text, jsonb, text, text, text, jsonb, boolean
) restrict;
drop function if exists ssmm_spike1.prevent_proposal_identity_mutation()
  restrict;
drop function if exists ssmm_spike1.get_current_loop_state() restrict;
drop function if exists ssmm_spike1.get_latest_loop_state() restrict;
drop function if exists ssmm_spike1.get_loop_state(uuid) restrict;

drop table if exists ssmm_spike1.runtime_requests restrict;
drop table if exists ssmm_spike1.installed_shapes restrict;
drop table if exists ssmm_spike1.adjustment_subloops restrict;
drop table if exists ssmm_spike1.metabolize_states restrict;
drop table if exists ssmm_spike1.move_custody restrict;
drop table if exists ssmm_spike1.sense_states restrict;
drop table if exists ssmm_spike1.events restrict;
drop table if exists ssmm_spike1.shape_proposals restrict;
drop table if exists ssmm_spike1.main_loops restrict;

drop schema if exists ssmm_spike1 restrict;

commit;
