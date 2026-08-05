-- SQL portion of the Stage 2B baseline verification.
-- Function, secret-name, migration-history, table-stat, schema-dump, and role-
-- dump checks are performed by scripts/ssmm-stage3-rollback.sh.

do $baseline_verification$
begin
  if exists (
    select 1 from pg_namespace where nspname = 'ssmm_spike1'
  ) then
    raise exception 'stage2b_baseline_mismatch: schema ssmm_spike1 still exists';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ssmm_spike1'
  ) then
    raise exception 'stage2b_baseline_mismatch: SSMM relations remain';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'ssmm_spike1'
  ) then
    raise exception 'stage2b_baseline_mismatch: SSMM routines remain';
  end if;
end;
$baseline_verification$;

select json_build_object(
  'baseline', 'stage2b-empty-20260804',
  'ssmm_schema_absent', true,
  'ssmm_relations_absent', true,
  'ssmm_routines_absent', true
) as rollback_database_receipt;
