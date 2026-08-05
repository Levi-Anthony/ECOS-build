# Spike 1 Remote Build Runbook

Status: staged procedure card; no remote operation is authorized by this file

This runbook is for the isolated Build-register project only. It preserves the
verified PR #19 authority-integrity baseline and separates remote inspection
from remote mutation. Completing one section never authorizes the next.

## 0. Authority and unresolved inputs

Before any command in this runbook is executed, the Site Packet must identify:

- reviewed Git commit and clean-worktree evidence;
- capability receipt covering the exact remote operation;
- target project `ssmm-spike-1`;
- target project ref `itqjtjcsjwvzxcowhqyt`;
- rollback source and ordered recovery commands;
- Levi-ratified Shape provider endpoint and model;
- reviewed client-authentication architecture;
- reviewed decision on platform JWT verification and any `--no-verify-jwt` use;
- secret variable names and scopes, without values.

Unresolved placeholders are stop conditions. Do not infer a provider, model,
credential design, or security posture from examples or prior drafts.

### Local → remote Levi review gate

Before `supabase link` or any other linked or remote operation, stop and return
the complete local reconciliation Site Packet to Levi. A later remote batch may
begin only after Levi reviews that packet and issues a new receipt naming the
exact target, reviewed Git state, operation class, and stop point. This runbook
is not that receipt.

## 1. Hard target and secret stops

- Never target `lqbrzoicorehwidkdhoi` (`open-brain`).
- Never target `gfqumzumfdeeojuwwvbu` (`open-brain-staging`).
- Never target `fjamkrfhopumigfscgnm` (`Crucible`).
- Stop if the linked ref is missing, ambiguous, or differs from
  `itqjtjcsjwvzxcowhqyt`.
- Stop if the verified Git head differs from the reviewed commit.
- Stop if rollback evidence is absent or remote drift is unexplained.
- Never print or record secret values, password-bearing database URLs, private
  authentication headers, or human Sense content not required for review.

Print this block before every remote command session:

```text
TARGET CHECK
Environment: isolated SSMM Spike 1 Build-register project
Project name: ssmm-spike-1
Intended project ref: itqjtjcsjwvzxcowhqyt
CLI linked ref: <read from supabase/.temp/project-ref>
Reviewed Git commit: <exact commit>
Command: <exact command>
Operation class: <read-only remote inspection | remote mutation>
Safety rationale: isolated Spike 1 evidence
Production affected: no
Legacy ECB/OB1 affected: no
Crucible affected: no
Rollback identifier: <identifier or not-applicable>
```

Resolve the linked ref from `supabase/.temp/project-ref`; do not infer it from
the working-directory or project name.

## 2. Remote predeployment inspection — separately gated

The following commands contact the remote project. `supabase link` also writes
local link state. Do not run them under a local-only capability receipt.

From `experiments/ssmm-spike-1`:

```sh
supabase link --project-ref itqjtjcsjwvzxcowhqyt
test "$(tr -d '\n' < supabase/.temp/project-ref)" = \
  "itqjtjcsjwvzxcowhqyt"
supabase migration list --linked
supabase db push --dry-run
```

For an empty isolated project, the dry-run must list exactly these committed
migrations in this order:

1. `202607260001_ssmm_spike1_runtime.sql`
2. `202607310001_ssmm_spike1_authority_integrity.sql`
3. `202607310002_ssmm_spike1_creation_revision.sql`
4. `202607310003_ssmm_spike1_plpgsql_qualification.sql`

Any missing, additional, reordered, or already-applied migration is remote drift
requiring classification. Do not repair migration history.

### Mandatory stop after dry-run

Stop after `supabase db push --dry-run`. Return a Site Packet containing target
identity, remote migration history, exact dry-run output, intended changes,
rollback evidence, and any drift. Do not run `supabase db push` in the same
unreviewed batch.

## 3. Remote database mutation — requires a new Levi receipt

Only after Levi reviews the dry-run Site Packet and authorizes this exact batch:

```sh
supabase db push
supabase migration list --linked
supabase test db --linked
supabase db lint --linked --schema ssmm_spike1 \
  --level warning --fail-on error
```

The mutation pass condition is all four migrations recorded remotely, the
authority-integrity pgTAP suite green, and no schema error at level `error`.
Test failures do not authorize repair, reset, or ad-hoc remote DDL.

Never use `supabase db reset --linked` against this project.

## 4. Remote configuration — separately gated

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted Edge
Functions. Configure only the Spike-owned variable names after provider/model
and security review:

```text
SSMM_RUNTIME_SHARED_SECRET
SSMM_SHAPE_ENDPOINT=<Levi-ratified-provider-endpoint>
SSMM_SHAPE_API_KEY
SSMM_SHAPE_MODEL=<Levi-ratified-model>
SSMM_PURPOSE_ID
SSMM_PURPOSE_LABEL
SSMM_ORIENTATION_ID
SSMM_ORIENTATION_LABEL
```

Values are provided outside Git and outside the Site Packet. Levi authors the
Purpose and orientation handles. `supabase secrets list` may verify configured
names; never print values or authentication headers.

The current runtime uses `SSMM_RUNTIME_SHARED_SECRET` for direct-test access.
That fact does not authorize placing the value on an iPhone. Shortcut client
authentication remains a separate architecture and security gate.

## 5. Function deployment — separately gated

Expected verified versions:

- protocol: `spike1-slice-contract-0.3`;
- Shape prompt: `spike1-shape-0.3`;
- Edge Function: `spike1-0.4.0`.

If the reviewed security plan explicitly authorizes the current custom-header
authentication path and disabling platform JWT verification, the corresponding
command is:

```sh
supabase functions deploy ssmm-runtime \
  --project-ref itqjtjcsjwvzxcowhqyt \
  --no-verify-jwt
```

Do not execute that command by default. `--no-verify-jwt`, client credential
exposure, grant broadening, RLS weakening, and `SECURITY DEFINER` changes each
require explicit review.

## 6. Remote probes — separately gated

Function URL:

```text
https://itqjtjcsjwvzxcowhqyt.supabase.co/functions/v1/ssmm-runtime
```

Required observations:

1. `GET` returns `405`.
2. `POST` without approved client authentication returns `401`.
3. A valid `open_current_surface` response reports protocol
   `spike1-slice-contract-0.3`, prompt `spike1-shape-0.3`, and function
   `spike1-0.4.0`.
4. `node tests/remote-shape-handoff.mjs` creates one loop only in an otherwise
   empty isolated project, persists one non-authoritative proposal, proves an
   exact semantic replay, and stops in Shape.
5. Proposal acceptance, installation, and Move entry have not occurred.

The remote handoff test uses an ignored environment file containing only the
approved function URL and direct-test credential. It must never receive a
service-role key.

## 7. Evidence and rollback receipt

Record only:

- project ref;
- reviewed Git commit;
- migration versions and remote history;
- function deployment ID/version;
- provider and ratified model names;
- non-sensitive secret fingerprints or configuration status;
- loop, proposal, event, and revision identifiers;
- test, lint, denial-path, and replay results;
- timestamps, drift, failures, and falsifier observations;
- rollback identifier and recovery result.

Redact every secret value, full authorization header, password-bearing URL, and
human Sense content not needed for review.
