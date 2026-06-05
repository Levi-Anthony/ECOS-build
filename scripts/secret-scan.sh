#!/usr/bin/env bash
set -euo pipefail

pattern='(sk-(or-v1-)?[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|[0-9a-f]{64}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})'

matches="$(
  git grep -nI -E "$pattern" -- \
    . \
    ':!scripts/secret-scan.sh' \
    ':!supabase/functions/quick-capture/index.ts' \
    | cut -d: -f1-2 \
    | sort -u \
    || true
)"

if [[ -n "$matches" ]]; then
  printf 'Potential committed secrets found at:\n%s\n' "$matches" >&2
  exit 1
fi

echo "No committed secret patterns found."
