#!/usr/bin/env bash
set -euo pipefail

# Red/green tests for scripts/codex-runtime-check.sh.
# Uses a temporary minimal workspace and never mutates the real repo.
#
# Assurance expectations:
# - Any new runtime check needs a green/pass case and a red/fail case.
# - Red cases should prove the check fails for the intended reason.
# - Use this harness before calling Control Room guardrail work complete.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

note() {
  printf '%s\n' "$*"
}

record() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS: %s (rc=%s)\n' "$name" "$actual"
    pass=$((pass + 1))
  else
    printf 'FAIL: %s (expected rc=%s, got rc=%s)\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

make_fixture() {
  local dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest/.agents" "$dest/.claude"
  cp -R "$ROOT/scripts" "$dest/"
  cp -R "$ROOT/.agents/skills" "$dest/.agents/"
  cp -R "$(readlink "$ROOT/.claude/skills")" "$dest/.claude/skills"
  cp "$ROOT/CLAUDE.md" "$dest/CLAUDE.md"
  ln -s CLAUDE.md "$dest/AGENTS.md"
}

run_case() {
  local name="$1"
  local expected="$2"
  local setup="$3"
  local env_prefix="${4:-}"
  local work="$TMP_ROOT/$name"

  make_fixture "$work"
  (
    cd "$work"
    eval "$setup"
    set +e
    if [[ -n "$env_prefix" ]]; then
      eval "$env_prefix bash scripts/codex-runtime-check.sh" >/tmp/ecos-runtime-selftest.out 2>&1
    else
      bash scripts/codex-runtime-check.sh >/tmp/ecos-runtime-selftest.out 2>&1
    fi
    printf '%s' "$?"
  ) >"/tmp/ecos-runtime-selftest-rc"

  local actual
  actual="$(cat /tmp/ecos-runtime-selftest-rc)"
  record "$name" "$expected" "$actual"
}

note "Running codex-runtime-check red/green self-test..."
note "Assurance: every runtime guardrail added here needs green and red proof."

run_case "green-default" 0 ":"
run_case "green-strict-skill" 0 ":" "STRICT_SKILL_BODY_CHECK=1"
run_case "red-agents-not-same-file" 2 "rm AGENTS.md && cp CLAUDE.md AGENTS.md"
run_case "red-line-ceiling" 2 "for i in {1..20}; do printf 'extra line %s\\n' \"\$i\" >> CLAUDE.md; done"
run_case "red-lowercase-skill-file" 2 "mkdir -p .agents/skills/red-lowercase && printf 'bad\\n' > .agents/skills/red-lowercase/skill.md"
run_case "red-skill-name-mismatch" 2 "rm -rf .agents/skills/music"
run_case "red-unexpected-skill-body-drift" 2 "printf '\\n# unexpected drift\\n' >> .agents/skills/music/SKILL.md" "STRICT_SKILL_BODY_CHECK=1"
run_case "red-doc-authority" 2 "mkdir -p docs && printf '# No authority\\n' > docs/no-authority.md" "STRICT_DOC_AUTHORITY_CHECK=1"
run_case "red-missing-assurance" 2 "awk 'BEGIN{skip=0} /^## Assurance Pass$/{skip=1} /^## Finish Criteria$/{skip=0} !skip{print}' .agents/skills/ecos-control-room/SKILL.md > /tmp/ecos-control-room-no-assurance && mv /tmp/ecos-control-room-no-assurance .agents/skills/ecos-control-room/SKILL.md"

rm -f /tmp/ecos-runtime-selftest.out /tmp/ecos-runtime-selftest-rc

printf 'Self-test complete: %s passed, %s failed.\n' "$pass" "$fail"
if (( fail > 0 )); then
  exit 2
fi
