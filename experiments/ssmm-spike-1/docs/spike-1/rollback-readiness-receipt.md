# Spike 1 Rollback-Readiness Reviewer Receipt

Status: local implementation evidence; not Stage 3 authorization

Baseline source: Stage 2B Site Packet dated 2026-08-04

Baseline identity: `stage2b-empty-20260804`

## Deficiency-to-evidence map

| Stage 2B deficiency | Implementation | Verification evidence |
|---|---|---|
| No executable database reversal | `supabase/rollback/rollback_ssmm_spike1.sql` removes the allowlisted schema footprint transactionally with `RESTRICT` | `tests/rollback-readiness.sh` runs it after every migration prefix and after the complete set |
| No exact baseline proof | `supabase/rollback/verify_stage2b_baseline.sql` plus the orchestrator's function, secret, table-stat, dump-hash, role-hash, and dry-run checks | Static parser tests and the operational rollback/reapply cycle |
| No function recovery/removal | `scripts/ssmm-stage3-rollback.sh` inventories functions, rejects unrelated slugs, and deletes only `ssmm-runtime` first | `tests/rollback-readiness.mjs` tests empty, expected, and unexpected inventories; Stage 2B establishes the prior function state as absent |
| No secret reversal | The orchestrator inventories names, rejects unrelated names, and unsets only the eight introduced SSMM names | Static parser tests prove allowlist and fail-closed behavior; no value is read or stored |
| No migration-history recovery | The orchestrator marks exactly the four SSMM versions reverted after successful SQL | Local operational test repairs the four versions, proves dry-run order, and reapplies them |
| No partial-deployment plan | Runbook Section 7.3 maps database-prefix, secrets, function, smoke-data, and history-repair failure states | Operational test exercises every database migration prefix and the unexplained-object stop |
| No ordered commands or stop conditions | Runbook Section 7 and guarded execute mode define target, commit, CLI, baseline, ordering, evidence, and failure stops | Shell syntax/static checks plus local execution |
| No rollback receipt | The orchestrator writes target check, command register, inventories, hashes, dry-run evidence, and final result in a protected directory | Evidence filenames and pass criteria are fixed in source and runbook Section 7.5 |

## Exact database footprint covered

- schema `ssmm_spike1`;
- tables `main_loops`, `sense_states`, `shape_proposals`,
  `installed_shapes`, `move_custody`, `adjustment_subloops`,
  `metabolize_states`, `events`, and `runtime_requests`;
- all indexes, constraints, nine forced-RLS policy surfaces, and the
  `shape_proposals_identity_immutable` trigger owned by those tables;
- getters, request-fingerprint/preflight routines, the internal unchecked/core
  writers, and both transitional/final `apply_runtime_events` signatures;
- no extension removal: the pre-existing platform `pgcrypto` remains intact.

Unknown relations, routines, policies, triggers, domain/enum/multirange/range
types, external dependencies, or non-SSMM remote inventory stop rollback for
review rather than widening the destructive scope.

## Function and secret baseline

Stage 2B found no deployed function and no user-configured secret. Therefore:

- exact function recovery is absence: delete `ssmm-runtime` if Stage 3 created
  it; never deploy a replacement during rollback;
- exact secret recovery is absence: unset only introduced SSMM names that are
  present; never retrieve values;
- any future non-empty prestate requires a new baseline, restore artifact,
  hashes, and human receipt.

## Review gates intentionally still open

This patch does not ratify or change:

- `verify_jwt=false`;
- custom shared-secret authentication;
- final Shortcut credential handling;
- Shape provider endpoint/model selection;
- secret values or provider configuration;
- remote migration, deployment, probes, or field use.

## Reviewer decision

The patch may support a recommendation of **Stage 3 ready for separate human
authorization** only when its local operational test and PR checks are green
and no new remote drift or governing receipt supersedes the Stage 2B baseline.
It never authorizes Stage 3 by itself.
