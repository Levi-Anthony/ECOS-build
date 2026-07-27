# SSMM Spike 1

Status: revised executable contract implemented locally

This directory implements Slice Contract v0.2 without changing the live ECB
substrate or ratifying a generalized loop ontology.

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
  continuity. Slice Contract v0.2 governs this spike pending field evidence.

## Runtime model

The persistence layer separates:

- the authoritative `main_loop`;
- corrigible `sense_state`;
- versioned, non-authoritative `shape_proposals`;
- the accepted and installed `installed_shape`;
- durable `move_custody`;
- one explicit `adjustment_subloop` mechanism inside Move;
- `metabolize_state`;
- append-only authoritative events.

Acceptance and installation are distinct. `shape_installed` and
`parent_entered_move` occur only after installation requirements are satisfied
or explicitly waived. Completion claims and verification assessments are also
distinct records.

## Local verification

```sh
deno test supabase/functions/ssmm-runtime --allow-env
deno check supabase/functions/ssmm-runtime/index.ts
supabase db reset --local --no-seed
supabase test db
node tests/concurrent-idempotency.mjs
node --env-file=/path/to/local-test.env tests/http-custody-flow.mjs
supabase db lint --level warning
```

Current evidence:

- 24/24 Deno tests pass.
- 27/27 pgTAP assertions pass.
- concurrent identical requests produce one write and one replay;
- a local HTTP path preserves a non-authoritative proposal through correction
  and installation, restores the same parent Move in a later request, runs
  bounded assistance without changing the parent phase, keeps completion
  separate from verification, and gives a fresh Sense the prior residue
  without selecting its Move;
- database lint reports no findings in `ssmm_spike1` (the bundled pgTAP
  extension emits its own compatibility findings).

This proves local implementation behavior. It does not prove the product claim.

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

A test without leaving and returning during Move does not test custody of the
execution gap. A test without Metabolize and residue does not test whether the
result lands.
