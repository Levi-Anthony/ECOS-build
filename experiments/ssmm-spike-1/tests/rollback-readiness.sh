#!/usr/bin/env bash

set -euo pipefail

DB_CONTAINER="supabase_db_ssmm-spike-1-unlinked"
MIGRATIONS=(202607260001 202607310001 202607310002 202607310003)
ROLLBACK_SQL="supabase/rollback/rollback_ssmm_spike1.sql"
VERIFY_SQL="supabase/rollback/verify_stage2b_baseline.sql"

node tests/rollback-readiness.mjs

run_sql_file() {
  docker exec -i "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 \
    -U postgres -d postgres -f - < "$1"
}

for version in "${MIGRATIONS[@]}"; do
  supabase db reset --local --no-seed --version "$version"
  run_sql_file "$ROLLBACK_SQL"
  run_sql_file "$VERIFY_SQL"
done

supabase db reset --local --no-seed
docker exec "$DB_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'create table ssmm_spike1.rollback_drift_guard_probe(id integer primary key);'
if run_sql_file "$ROLLBACK_SQL" > /tmp/ssmm-rollback-drift-guard.log 2>&1; then
  printf 'rollback drift guard accepted an unexpected table\n' >&2
  exit 1
fi
grep -q 'ssmm_rollback_unexpected_relations' /tmp/ssmm-rollback-drift-guard.log

supabase db reset --local --no-seed
run_sql_file "$ROLLBACK_SQL"
run_sql_file "$VERIFY_SQL"
run_sql_file "$ROLLBACK_SQL"
run_sql_file "$VERIFY_SQL"
supabase migration repair "${MIGRATIONS[@]}" --status reverted --local
supabase migration repair "${MIGRATIONS[@]}" --status reverted --local
supabase db push --dry-run --local > /tmp/ssmm-rollback-local-dry-run.txt 2>&1
node scripts/validate-rollback-evidence.mjs dry-run \
  /tmp/ssmm-rollback-local-dry-run.txt
supabase db push --local --yes
supabase test db

printf 'rollback_readiness_operational=passed\n'
