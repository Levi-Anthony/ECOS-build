#!/usr/bin/env bash

set -euo pipefail
umask 077

PROJECT_REF="itqjtjcsjwvzxcowhqyt"
PROJECT_NAME="ssmm-spike-1"
BASELINE_ID="stage2b-empty-20260804"
REQUIRED_CLI_VERSION="2.109.1"
BASELINE_SCHEMA_SHA256="862613c1072315c8c500084b9835ead6e45979c4e9e6abdff6be4b7174df3422"
BASELINE_ROLES_SHA256="168a95a9c745af5ed4679751f90419ac9dc434240a213b03e32a06d5664c2308"
MIGRATIONS=(
  202607260001
  202607310001
  202607310002
  202607310003
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROLLBACK_SQL="$PROJECT_DIR/supabase/rollback/rollback_ssmm_spike1.sql"
VERIFY_SQL="$PROJECT_DIR/supabase/rollback/verify_stage2b_baseline.sql"
VALIDATOR="$PROJECT_DIR/scripts/validate-rollback-evidence.mjs"

usage() {
  cat <<'USAGE'
Usage:
  scripts/ssmm-stage3-rollback.sh plan
  scripts/ssmm-stage3-rollback.sh execute \
    --project-ref itqjtjcsjwvzxcowhqyt \
    --rollback-id <human-authorized-id> \
    --deployed-commit <40-hex-reviewed-commit> \
    --evidence-dir <protected-directory> \
    --confirm-baseline stage2b-empty-20260804

The execute mode performs remote mutation. A human receipt must explicitly
authorize function deletion, secret unsetting, rollback SQL, migration-history
repair, and the post-rollback remote reads before this command is run.
USAGE
}

fail() {
  printf 'ROLLBACK STOP: %s\n' "$1" >&2
  exit 1
}

record_command() {
  printf '%s\n' "$1" >> "$COMMAND_LOG"
}

MODE="${1:-}"
if [ -z "$MODE" ]; then
  usage
  exit 2
fi
shift

if [ "$MODE" = "plan" ]; then
  cat <<PLAN
SSMM Stage 3 rollback plan (no remote command executed)
1. Revalidate linked project $PROJECT_REF and reviewed clean Git commit.
2. Stop on any function other than ssmm-runtime or any secret outside the eight SSMM names.
3. Delete ssmm-runtime first so no caller can write during recovery.
4. Execute the allowlisted transactional database rollback with RESTRICT semantics.
5. Mark only ${MIGRATIONS[*]} reverted in migration history.
6. Unset only SSMM-introduced secret names that are present; never retrieve values.
7. Prove SSMM absence, empty function/secret/table inventories, exact Stage 2B schema/role hashes, and four-migration dry-run order.
Authentication review remains open: verify_jwt=false and custom shared-secret authentication are not ratified by this plan.
PLAN
  exit 0
fi

[ "$MODE" = "execute" ] || fail "mode must be plan or execute"

CONFIRMED_REF=""
ROLLBACK_ID=""
DEPLOYED_COMMIT=""
EVIDENCE_DIR=""
CONFIRMED_BASELINE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-ref) CONFIRMED_REF="${2:-}"; shift 2 ;;
    --rollback-id) ROLLBACK_ID="${2:-}"; shift 2 ;;
    --deployed-commit) DEPLOYED_COMMIT="${2:-}"; shift 2 ;;
    --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
    --confirm-baseline) CONFIRMED_BASELINE="${2:-}"; shift 2 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[ "$CONFIRMED_REF" = "$PROJECT_REF" ] || fail "project ref confirmation mismatch"
[ "$CONFIRMED_BASELINE" = "$BASELINE_ID" ] || fail "baseline confirmation mismatch"
[ -n "$ROLLBACK_ID" ] || fail "rollback identifier required"
printf '%s' "$ROLLBACK_ID" | grep -Eq '^[A-Za-z0-9._-]+$' || fail "rollback identifier contains unsafe characters"
printf '%s' "$DEPLOYED_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || fail "deployed commit must be 40 lowercase hex characters"
[ -n "$EVIDENCE_DIR" ] || fail "evidence directory required"

for command in git node shasum supabase; do
  command -v "$command" >/dev/null 2>&1 || fail "required command unavailable: $command"
done
[ "$(supabase --version)" = "$REQUIRED_CLI_VERSION" ] || fail "Supabase CLI must be exactly $REQUIRED_CLI_VERSION"

if [ -e "$EVIDENCE_DIR" ] && [ -n "$(find "$EVIDENCE_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  fail "evidence directory must be absent or empty"
fi
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"
EVIDENCE_DIR="$(cd "$EVIDENCE_DIR" && pwd -P)"
COMMAND_LOG="$EVIDENCE_DIR/commands.txt"
: > "$COMMAND_LOG"
chmod 600 "$COMMAND_LOG"

cd "$PROJECT_DIR"
REPOSITORY_DIR="$(git rev-parse --show-toplevel)"
case "$EVIDENCE_DIR/" in
  "$REPOSITORY_DIR"/*) fail "evidence directory must be outside the repository" ;;
esac
LINK_FILE="supabase/.temp/project-ref"
[ -f "$LINK_FILE" ] || fail "linked project reference is absent"
[ "$(tr -d '\r\n' < "$LINK_FILE")" = "$PROJECT_REF" ] || fail "linked project reference mismatch"
[ "$(git rev-parse HEAD)" = "$DEPLOYED_COMMIT" ] || fail "Git HEAD differs from deployed commit"
[ -z "$(git status --porcelain --untracked-files=all)" ] || fail "worktree is not clean"

cat > "$EVIDENCE_DIR/target-check.txt" <<TARGET
Environment: isolated SSMM Spike 1 Build-register project
Project name: $PROJECT_NAME
Project ref: $PROJECT_REF
Reviewed deployed commit: $DEPLOYED_COMMIT
Rollback identifier: $ROLLBACK_ID
Baseline identifier: $BASELINE_ID
Operation class: authorized remote rollback mutation and verification
Production affected: no
Legacy ECB/OB1 affected: no
Crucible affected: no
TARGET
chmod 600 "$EVIDENCE_DIR/target-check.txt"

record_command "supabase functions list --project-ref $PROJECT_REF --output-format json"
supabase functions list --project-ref "$PROJECT_REF" --output-format json \
  > "$EVIDENCE_DIR/functions-before.json"
chmod 600 "$EVIDENCE_DIR/functions-before.json"
node "$VALIDATOR" functions "$EVIDENCE_DIR/functions-before.json" \
  > "$EVIDENCE_DIR/function-names-before.txt"
record_command "supabase secrets list --project-ref $PROJECT_REF --output-format json"
supabase secrets list --project-ref "$PROJECT_REF" --output-format json \
  > "$EVIDENCE_DIR/secrets-before.json"
chmod 600 "$EVIDENCE_DIR/secrets-before.json"
node "$VALIDATOR" secrets "$EVIDENCE_DIR/secrets-before.json" \
  > "$EVIDENCE_DIR/secret-names-before.txt"

if grep -qx 'ssmm-runtime' "$EVIDENCE_DIR/function-names-before.txt"; then
  record_command "supabase functions delete ssmm-runtime --project-ref $PROJECT_REF --yes"
  supabase functions delete ssmm-runtime --project-ref "$PROJECT_REF" --yes
fi

record_command "supabase db query --linked --file supabase/rollback/rollback_ssmm_spike1.sql"
supabase db query --linked --file "$ROLLBACK_SQL" \
  > "$EVIDENCE_DIR/database-rollback.txt"
chmod 600 "$EVIDENCE_DIR/database-rollback.txt"

record_command "supabase migration repair ${MIGRATIONS[*]} --status reverted --linked"
supabase migration repair "${MIGRATIONS[@]}" --status reverted --linked \
  > "$EVIDENCE_DIR/migration-repair.txt"
chmod 600 "$EVIDENCE_DIR/migration-repair.txt"

while IFS= read -r secret_name; do
  [ -n "$secret_name" ] || continue
  record_command "supabase secrets unset $secret_name --project-ref $PROJECT_REF --yes"
  supabase secrets unset "$secret_name" --project-ref "$PROJECT_REF" --yes
done < "$EVIDENCE_DIR/secret-names-before.txt"

record_command "supabase db query --linked --file supabase/rollback/verify_stage2b_baseline.sql"
supabase db query --linked --file "$VERIFY_SQL" \
  > "$EVIDENCE_DIR/database-verification.txt"
chmod 600 "$EVIDENCE_DIR/database-verification.txt"

record_command "supabase functions list --project-ref $PROJECT_REF --output-format json"
supabase functions list --project-ref "$PROJECT_REF" --output-format json \
  > "$EVIDENCE_DIR/functions-after.json"
node "$VALIDATOR" functions "$EVIDENCE_DIR/functions-after.json" --empty

record_command "supabase secrets list --project-ref $PROJECT_REF --output-format json"
supabase secrets list --project-ref "$PROJECT_REF" --output-format json \
  > "$EVIDENCE_DIR/secrets-after.json"
node "$VALIDATOR" secrets "$EVIDENCE_DIR/secrets-after.json" --empty

record_command "supabase inspect db table-stats --linked --output-format json"
supabase inspect db table-stats --linked --output-format json \
  > "$EVIDENCE_DIR/table-stats-after.txt"
node "$VALIDATOR" table-stats "$EVIDENCE_DIR/table-stats-after.txt"

record_command "supabase db dump --linked --file <evidence-dir>/schema-after.sql"
supabase db dump --linked --file "$EVIDENCE_DIR/schema-after.sql"
record_command "supabase db dump --linked --role-only --file <evidence-dir>/roles-after.sql"
supabase db dump --linked --role-only --file "$EVIDENCE_DIR/roles-after.sql"
chmod 600 "$EVIDENCE_DIR"/*

SCHEMA_SHA="$(shasum -a 256 "$EVIDENCE_DIR/schema-after.sql" | awk '{print $1}')"
ROLES_SHA="$(shasum -a 256 "$EVIDENCE_DIR/roles-after.sql" | awk '{print $1}')"
[ "$SCHEMA_SHA" = "$BASELINE_SCHEMA_SHA256" ] || fail "post-rollback schema hash differs from Stage 2B baseline"
[ "$ROLES_SHA" = "$BASELINE_ROLES_SHA256" ] || fail "post-rollback role hash differs from Stage 2B baseline"

record_command "supabase db push --dry-run"
supabase db push --dry-run > "$EVIDENCE_DIR/post-rollback-dry-run.txt" 2>&1
node "$VALIDATOR" dry-run "$EVIDENCE_DIR/post-rollback-dry-run.txt" \
  > "$EVIDENCE_DIR/expected-migrations-after.txt"

cat > "$EVIDENCE_DIR/rollback-result.txt" <<RESULT
rollback_id=$ROLLBACK_ID
project_ref=$PROJECT_REF
deployed_commit=$DEPLOYED_COMMIT
baseline=$BASELINE_ID
schema_sha256=$SCHEMA_SHA
roles_sha256=$ROLES_SHA
result=stage2b_baseline_verified
RESULT
chmod 600 "$EVIDENCE_DIR/rollback-result.txt"

printf 'Rollback %s verified against %s.\n' "$ROLLBACK_ID" "$BASELINE_ID"
