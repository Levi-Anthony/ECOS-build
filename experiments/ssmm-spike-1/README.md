# SSMM Spike 1

Status: revised local implementation; remote and human-field gates remain closed

This directory implements Slice Contract v0.2 plus the bounded authority
integrity amendment v0.3 without changing the live ECB substrate or ratifying a
generalized loop ontology.

The core claim is:

> Before the gap, the system helps install the Move. During the gap, it holds
> the Move. After the gap, it helps the result land.

The authoritative parent loop follows:

`Sense → Shape → Move → Metabolize → closed/disposed → new Sense`

The human-only execution interval is part of Move. Pressing the Action Button
during that interval must open the Move cockpit for the same authoritative
parent loop—not a generic phase menu and not a fresh Sense.

## Accountability

- Linear: `ECO-70`, child of Human Rail outcome `ECO-61`
- Project: Crucible
- Git branch: `codex/eco-70-ssmm-spike-1`
- Draft review: GitHub PR `#19`
- Authority: Linear coordinates; Git holds implementation evidence; ECB holds
  continuity. Slice Contract v0.2 governs the spike, amended only by the bounded
  authority-integrity contract in
  [`authority-integrity-v0.3.md`](docs/spike-1/authority-integrity-v0.3.md).

## Runtime model

The persistence layer separates:

- the authoritative `main_loop` with a monotonic revision;
- corrigible `sense_state`;
- versioned, non-authoritative `shape_proposals`;
- the accepted and installed `installed_shape`;
- durable `move_custody`;
- one explicit `adjustment_subloop` mechanism inside Move;
- `metabolize_state`;
- authoritative events;
- a semantic request ledger for meaning-bound idempotency.

Acceptance and installation are distinct. Acceptance, installation actions, and
installation confirmation must name the exact proposal ID and immutable version.
Every state mutation supplies the loop revision it was computed from; the
database rejects stale requests under the loop-row lock. Reusing an event ID
with different semantic content is a conflict, not a replay.

## Local verification

From `experiments/ssmm-spike-1`:

```sh
deno check supabase/functions/ssmm-runtime/index.ts
deno test supabase/functions/ssmm-runtime --allow-env
supabase start
supabase db reset --local
supabase test db
node tests/concurrent-idempotency.mjs
SSMM_RUNTIME_SHARED_SECRET=... node tests/http-authority-integrity.mjs
node --env-file=/path/to/local-test.env tests/http-custody-flow.mjs
supabase db lint --level warning
bash tests/rollback-readiness.sh
scripts/ssmm-stage3-rollback.sh plan
```

The dedicated CI job `ssmm-spike-1-authority-integrity` runs the deterministic
unit checks, pgTAP suite, different-request concurrency races, and HTTP conflict
and read-only-restoration tests against disposable local Supabase. Local or CI
evidence does not prove the product claim.

The verified PR #19 baseline uses protocol `spike1-slice-contract-0.3`, Shape
prompt `spike1-shape-0.3`, and Edge Function `spike1-0.4.0`. Procedure cards
must preserve the loop revision and exact proposal identity contracts at those
versions; older v0.2 request envelopes are not compatible.

## Future promotion seam

The evidence-informed destination is one greenfield Supabase project with the
future ECB semantic-memory core and SSMM runtime structurally beside one
another. `thoughts` answers what knowledge is relevant; `ssmm_*` authority
answers what is happening now and what transition is legal.

This is a non-governing promotion direction, not a Spike 1 prerequisite.
Semantic memory must never be used to infer current loop state, and runtime
events become thoughts only after Metabolize yields human-confirmed durable
meaning. See the
[future ECB semantic-memory amendment](docs/spike-1/future-ecb-semantic-memory-amendment.md).

## Reality gate

A review-complete field test still requires:

1. A dedicated remote Supabase project—never the live ECB project.
2. A configured Shape provider and secrets.
3. Remote migration, grant, and function verification.
4. iOS Shortcut/Action Button installation.
5. A real human-only execution interval.
6. Move-cockpit restoration after time away.
7. One bounded adjustment or interruption path under field conditions.
8. A distinct completion claim or material invalidation under field conditions.
9. Separate verification, Metabolize, conditioned residue, and fresh Sense in
   the field.
10. Falsifier assessment and review packet.

The reserved remote project is not linked or used by this repository change. A
test without leaving and returning during Move does not test custody of the
execution gap. A test without Metabolize and residue does not test whether the
result lands.

Prepared procedure cards:

- [Remote build runbook](docs/spike-1/remote-build-runbook.md)
- [iOS Shortcut build card](docs/spike-1/ios-shortcut-build-card.md)

The remote Shape-handoff test is designed to create one loop in an otherwise
empty isolated project, persist a non-authoritative Shape proposal, prove exact
request replay, and stop before acceptance or installation:

```sh
node --env-file=/path/to/remote-test.env tests/remote-shape-handoff.mjs
```

These materials are handoff aids, not deployment authority. Remote linking,
dry-run inspection, migration, provider/model selection, client authentication,
Shortcut installation, and field use remain governed review seams.

Rollback readiness is source-controlled in the
[remote build runbook](docs/spike-1/remote-build-runbook.md) and mapped for
review in the
[rollback-readiness receipt](docs/spike-1/rollback-readiness-receipt.md).
Its remote execute mode is inert without explicit target, commit, baseline,
rollback-ID, and evidence-directory confirmations. A green rollback rehearsal
does not ratify custom shared-secret authentication or `verify_jwt=false`.
