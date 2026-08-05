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
- reviewed rollback source at
  `supabase/rollback/rollback_ssmm_spike1.sql`, the guarded orchestrator at
  `scripts/ssmm-stage3-rollback.sh`, and green local rollback evidence;
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
Rollback identifier: $ROLLBACK_ID (human receipt; required for mutation)
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

## 7. Rollback readiness — separately gated

Rollback is a remote mutation batch. Neither this runbook nor a successful
deployment receipt authorizes it implicitly. The rollback receipt must name:

- project ref `itqjtjcsjwvzxcowhqyt`;
- the exact deployed commit and rollback identifier;
- the Stage 2B baseline identifier `stage2b-empty-20260804`;
- function deletion, secret unsetting, rollback SQL, migration-history repair,
  schema/role dumps, function/secret/table inventory, and dry-run verification;
- a protected evidence directory outside Git.

The reviewed artifacts are:

```text
supabase/rollback/rollback_ssmm_spike1.sql
supabase/rollback/verify_stage2b_baseline.sql
scripts/ssmm-stage3-rollback.sh
scripts/validate-rollback-evidence.mjs
tests/rollback-readiness.mjs
tests/rollback-readiness.sh
```

The database rollback is transactional, uses only `RESTRICT`, refuses
unexplained relations/routines/policies/triggers/types, removes the dedicated
`ssmm_spike1` schema in dependency order, and never drops `pgcrypto` or another
platform extension. It is valid after any applied prefix of the four forward
migrations.

### 7.1 Predeployment rollback rehearsal

Run locally before requesting Stage 3:

```sh
supabase start
bash tests/rollback-readiness.sh
scripts/ssmm-stage3-rollback.sh plan
```

The test resets through each forward-migration prefix, executes rollback and
baseline verification, proves that an unexpected table blocks rollback, marks
the four local migration rows reverted, confirms the dry-run order, reapplies
all four migrations, and reruns pgTAP.

### 7.2 Exact remote rollback command

Only under a receipt authorizing every mutation and read in Section 7:

```sh
DEPLOYED_COMMIT="$(git rev-parse HEAD)"
ROLLBACK_ID="<human-authorized-rollback-id>"
EVIDENCE_DIR="/private/tmp/ssmm-stage3-rollback-${ROLLBACK_ID}"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"

scripts/ssmm-stage3-rollback.sh execute \
  --project-ref itqjtjcsjwvzxcowhqyt \
  --rollback-id "$ROLLBACK_ID" \
  --deployed-commit "$DEPLOYED_COMMIT" \
  --evidence-dir "$EVIDENCE_DIR" \
  --confirm-baseline stage2b-empty-20260804
```

`ROLLBACK_ID` is the value issued by the human receipt; it is not generated or
inferred by the operator. The script requires Supabase CLI `2.109.1`, the exact
linked ref, the exact deployed commit, and a clean worktree. A different CLI
version or target is a stop condition requiring review, not an upgrade prompt.

### 7.3 Ordered behavior and partial-deployment recovery

The guarded command always reconciles in this order:

1. List deployed functions and secret names. Stop before mutation if any slug
   other than `ssmm-runtime` or any name outside the eight-name allowlist exists.
2. Delete `ssmm-runtime` if present. For the documented empty prestate, removal
   is the exact function recovery action; there is no prior deployment to
   restore.
3. Execute `rollback_ssmm_spike1.sql` through `supabase db query --linked`.
4. Run exactly:

   ```sh
   supabase migration repair \
     202607260001 202607310001 202607310002 202607310003 \
     --status reverted --linked
   ```

5. Unset only allowlisted SSMM names that were present in the preflight. Values
   are never retrieved. Delaying this irreversible step until database/history
   recovery succeeds preserves configuration if SQL or repair stops.
6. Verify SSMM absence, empty function/secret/table inventories, exact schema
   and role hashes from Stage 2B, and a dry-run containing exactly the four
   forward migrations in order.

This one order handles every authorized partial state:

| Failure point | Expected observed state | Recovery behavior |
|---|---|---|
| Before database push | no SSMM schema, secrets, or function | all steps are verified no-ops; migration repair remains bounded to the four versions |
| During/after a migration prefix | partial/full SSMM schema, no function | allowlisted SQL removes the applied prefix; history is marked reverted |
| After secret configuration | SSMM schema plus a subset/all eight names | database/history are reversed, then only present SSMM names are unset |
| After function deployment | function may still accept traffic | function is deleted first, then database/history and secrets are reversed |
| After a success-path smoke | SSMM test rows exist inside the dedicated schema | schema removal deletes those rows; the receipt must acknowledge this intended data loss |
| After SQL succeeds but history repair fails | SSMM schema absent, history may still show applied versions | do not redeploy; rerun only the exact authorized repair and full verification |

If a previous function ever exists in a future non-empty baseline, this script
must not be reused as-is. Capture that source/version under a new read receipt,
add a reviewed restore path, update the baseline identifier and hashes, and
obtain new authorization. For the verified Stage 2B baseline the prior state is
function absence, so redeploying any function during rollback would be drift.

### 7.4 Stop conditions

Stop without mutation if identity, link, commit, worktree, CLI version, baseline
identifier, or receipt differs. Stop before deletion if function or secret-name
inventory contains anything outside the allowlists. The SQL stops atomically on
an unexplained SSMM object or any external dependency because every drop uses
`RESTRICT`. Stop after any command failure; do not improvise `CASCADE`, database
reset, direct migration-table SQL, secret retrieval, or a replacement function.

### 7.5 Post-rollback evidence

The orchestrator records exact commands and non-sensitive outputs with mode
`0600`. Pass requires:

- no `ssmm-runtime` deployment;
- no user-configured secret names;
- no table-stat rows;
- no `ssmm_spike1` schema, relations, or routines;
- schema SHA-256
  `862613c1072315c8c500084b9835ead6e45979c4e9e6abdff6be4b7174df3422`;
- role SHA-256
  `168a95a9c745af5ed4679751f90419ac9dc434240a213b03e32a06d5664c2308`;
- dry-run order `202607260001`, `202607310001`, `202607310002`,
  `202607310003` with no additional migration.

Hash mismatch is drift requiring inspection. Do not normalize or overwrite the
Stage 2B evidence directory.

## 8. Evidence receipt boundary

Record only project ref, reviewed Git commit, migration versions/history,
function deployment ID/version, provider/model names, non-sensitive secret
fingerprints or configuration status, bounded smoke identifiers, test/lint
results, timestamps, drift, failures, rollback identifier, and recovery result.

Redact every secret value, full authorization header, password-bearing URL, and
human Sense content not needed for review.

Rollback readiness does not ratify `verify_jwt=false`, custom shared-secret
authentication, provider/model selection, or Shortcut credential handling.
Those remain separate Stage 3 human review concerns.
