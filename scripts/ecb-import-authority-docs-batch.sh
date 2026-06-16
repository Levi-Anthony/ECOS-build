#!/usr/bin/env bash
set -euo pipefail

# Batch importer for repo Markdown files classified in ECB artifact:
# repo-doc-authority-classification-2026-06-15
#
# Dry run does not require ECB_KEY:
#   scripts/ecb-import-authority-docs-batch.sh --dry-run
#
# Real import requires ECB_KEY in the environment:
#   ECB_KEY=<brain key> scripts/ecb-import-authority-docs-batch.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMPORTER="$ROOT/scripts/ecb-import-markdown-doc.py"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

if (( $# > 0 )); then
  printf 'Usage: %s [--dry-run]\n' "$0" >&2
  exit 2
fi

run_import() {
  local file="$1"
  local key="$2"
  local title="$3"
  local kind="$4"
  local canonical_source="$5"
  local repo_role="$6"
  shift 6

  local args=(
    "$IMPORTER"
    --file "$file"
    --key "$key"
    --title "$title"
    --kind "$kind"
    --canonical-source "$canonical_source"
    --repo-role "$repo_role"
  )

  for tag in "$@"; do
    args+=(--tag "$tag")
  done

  if (( DRY_RUN )); then
    args+=(--dry-run)
  fi

  python3 "${args[@]}"
}

cd "$ROOT"

if (( ! DRY_RUN )) && [[ -z "${ECB_KEY:-}" ]]; then
  printf 'ERROR: set ECB_KEY or rerun with --dry-run\n' >&2
  exit 1
fi

run_import \
  docs/architecture/artifacts-v2.md \
  repo-doc-artifacts-v2-reference-2026-06-15 \
  "Artifact v2/v3 Reference — Patch-Based Canonical Artifacts + Human Door" \
  playbook \
  GitHub \
  implementation_reference \
  architecture artifacts-v2 code-coupled

run_import \
  docs/architecture/taste-canonical-pattern.md \
  taste-canonical-pattern-2026-05-04 \
  "TASTE — Canonical Pattern" \
  spec \
  ECB \
  mirror \
  taste architecture doctrine

run_import \
  docs/architecture/topology-decision-memo-2026-06-10.md \
  ecos-topology-decision-memo-2026-06-10 \
  "ECOS Topology Decision Memo — 2026-06-10" \
  decision_memo \
  ECB \
  mirror \
  architecture topology decision

run_import \
  docs/backfill-agent-prompt.md \
  brain-corpus-backfill-agent-prompt \
  "BRAIN Corpus Backfill — Agent Prompt" \
  prompt \
  ECB \
  export \
  brain backfill prompt

run_import \
  docs/people-intel-cheatsheet.md \
  people-intelligence-tools-cheat-sheet \
  "People-Intelligence Tools — Cheat Sheet" \
  playbook \
  ECB \
  export \
  people-intelligence tool-reference

run_import \
  docs/people-intel-mobile-prompts.md \
  people-intelligence-mobile-prompt-library \
  "People-Intelligence — Mobile Prompt Library" \
  prompt \
  ECB \
  export \
  people-intelligence prompt-library mobile

run_import \
  docs/people-intel-prompts.md \
  people-intelligence-prompts \
  "People-Intelligence Prompts" \
  prompt \
  ECB \
  export \
  people-intelligence prompt-library

run_import \
  docs/security/ecos-secrets-inventory.md \
  ecos-secrets-inventory-2026-06-04 \
  "ECOS Secrets Inventory" \
  security_ledger \
  mixed \
  operator_copy \
  security secrets inventory

run_import \
  docs/security/next-steps-instruction-book.md \
  ecos-secrets-next-steps-instruction-book-2026-06-04 \
  "ECOS Secrets Next-Steps Instruction Book" \
  runbook \
  mixed \
  operator_copy \
  security secrets runbook

run_import \
  docs/security/secrets-operating-model.md \
  secrets-operating-model-2026-06-04 \
  "Secrets Operating Model" \
  policy \
  ECB \
  mirror \
  security secrets doctrine

if (( DRY_RUN )); then
  printf 'Dry run complete; no ECB writes attempted.\n'
else
  printf 'Batch import complete.\n'
fi
