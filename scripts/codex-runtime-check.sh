#!/usr/bin/env bash
set -euo pipefail

# Read-only local-runtime check for Codex/Claude agent surfaces.
# These surfaces are gitignored by design; this script keeps their invariants
# explicit without turning runtime files into repo canon.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0

note() {
  printf '%s\n' "$*"
}

err() {
  printf 'ERROR: %s\n' "$*" >&2
  fail=1
}

check_agents_md() {
  if [[ ! -f CLAUDE.md ]]; then
    err "CLAUDE.md missing"
    return
  fi

  if [[ ! -f AGENTS.md ]]; then
    err "AGENTS.md missing"
    return
  fi

  if [[ ! AGENTS.md -ef CLAUDE.md ]]; then
    err "AGENTS.md must resolve to CLAUDE.md so Codex runtime instructions mirror canonical local context"
  fi

  local lines
  lines="$(wc -l < CLAUDE.md | tr -d ' ')"
  note "CLAUDE.md/AGENTS.md lines: $lines"
  if (( lines > 120 )); then
    err "CLAUDE.md exceeds 120-line ceiling"
  fi
}

check_skill_surface() {
  local label="$1"
  local base="$2"
  local find_cmd=(find "$base")

  if [[ "$label" == "Claude" ]]; then
    find_cmd=(find -L "$base")
  fi

  if [[ ! -e "$base" ]]; then
    note "$label skills: $base not present; skipping"
    return
  fi

  local lower_count upper_count
  lower_count="$("${find_cmd[@]}" -maxdepth 2 -type f -name 'skill.md' | wc -l | tr -d ' ')"
  upper_count="$("${find_cmd[@]}" -maxdepth 2 -type f -name 'SKILL.md' | wc -l | tr -d ' ')"
  note "$label skills: $upper_count SKILL.md, $lower_count lowercase skill.md"

  if (( lower_count > 0 )); then
    err "$label skill surface contains lowercase skill.md files"
    "${find_cmd[@]}" -maxdepth 2 -type f -name 'skill.md' >&2
  fi

  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    if [[ ! -f "$dir/SKILL.md" ]]; then
      err "$label skill directory missing SKILL.md: $dir"
    fi
  done < <("${find_cmd[@]}" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort)
}

compare_skill_names() {
  local codex_base=".agents/skills"
  local claude_base=".claude/skills"
  local drift_allowlist="scripts/skill-body-drift-allowlist.txt"
  if [[ ! -d "$codex_base" || ! -e "$claude_base" ]]; then
    return
  fi

  local codex_names claude_names
  codex_names="$(mktemp)"
  claude_names="$(mktemp)"
  trap 'rm -f "$codex_names" "$claude_names"' RETURN

  find "$codex_base" -mindepth 2 -maxdepth 2 -type f -name 'SKILL.md' \
    | sed 's#^\.agents/skills/##; s#/SKILL.md$##' \
    | sort > "$codex_names"
  find -L "$claude_base" -mindepth 2 -maxdepth 2 -type f -name 'SKILL.md' \
    | sed 's#^\.claude/skills/##; s#/SKILL.md$##' \
    | sort > "$claude_names"

  if ! diff -u "$codex_names" "$claude_names" >/dev/null; then
    err "Codex and Claude skill name sets differ"
    diff -u "$codex_names" "$claude_names" >&2 || true
  fi

  local body_drift=0
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if ! diff -q "$codex_base/$name/SKILL.md" "$claude_base/$name/SKILL.md" >/dev/null; then
      local diff_hash expected_hash
      diff_hash="$({ diff -u --label "codex/$name/SKILL.md" --label "claude/$name/SKILL.md" "$codex_base/$name/SKILL.md" "$claude_base/$name/SKILL.md" || true; } | shasum -a 256 | awk '{print $1}')"
      expected_hash=""
      if [[ -f "$drift_allowlist" ]]; then
        expected_hash="$(awk -v skill="$name" '$1 == skill { print $2; exit }' "$drift_allowlist")"
      fi
      if [[ -n "$expected_hash" && "$diff_hash" == "$expected_hash" ]]; then
        printf 'INFO: allowed Codex/Claude skill projection drift for: %s\n' "$name" >&2
      else
        printf 'WARN: unexpected Codex/Claude skill body drift for: %s (diff hash %s)\n' "$name" "$diff_hash" >&2
        body_drift=1
      fi
    fi
  done < "$codex_names"

  if (( body_drift > 0 )) && [[ "${STRICT_SKILL_BODY_CHECK:-0}" == "1" ]]; then
    err "unexpected Codex and Claude skill body drift found with STRICT_SKILL_BODY_CHECK=1"
  fi
}

check_document_authority_headers() {
  if [[ ! -d docs ]]; then
    return
  fi

  local missing_headers
  missing_headers="$(mktemp)"
  trap 'rm -f "$missing_headers"' RETURN

  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    if ! sed -n '1,40p' "$file" | grep -qE 'ECB artifact key:|canonical_source:|GitHub-canonical|repo pointer|authority:'; then
      printf '%s\n' "$file" >> "$missing_headers"
    fi
  done < <(find docs -type f -name '*.md' | sort)

  if [[ -s "$missing_headers" ]]; then
    printf 'WARN: docs Markdown files missing explicit authority breadcrumb:\n' >&2
    sed 's/^/WARN:   /' "$missing_headers" >&2
    if [[ "${STRICT_DOC_AUTHORITY_CHECK:-0}" == "1" ]]; then
      err "docs authority breadcrumbs missing with STRICT_DOC_AUTHORITY_CHECK=1"
    fi
  fi
}

check_control_room_assurance() {
  local file
  for file in .agents/skills/ecos-control-room/SKILL.md .claude/skills/ecos-control-room/SKILL.md; do
    if [[ ! -f "$file" ]]; then
      err "Control Room skill missing: $file"
      continue
    fi

    local missing=0
    for pattern in \
      "## Assurance Pass" \
      "Gate Risky Work" \
      "work class" \
      "risk tier" \
      "red/fail proof" \
      "remaining unproven assumptions"; do
      if ! grep -qE "$pattern" "$file"; then
        printf 'WARN: %s missing Assurance phrase: %s\n' "$file" "$pattern" >&2
        missing=1
      fi
    done

    if (( missing > 0 )); then
      err "Control Room Assurance Pass incomplete in $file"
    fi
  done
}

check_agents_md
check_skill_surface "Codex" ".agents/skills"
check_skill_surface "Claude" ".claude/skills"
compare_skill_names
check_document_authority_headers
check_control_room_assurance

if (( fail > 0 )); then
  exit 2
fi

note "Codex runtime check passed."
