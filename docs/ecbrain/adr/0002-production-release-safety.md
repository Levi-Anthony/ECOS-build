# ADR 0002 — Production Release Safety

**Status:** Accepted

---

## Context

ECBRAIN V1 was the first ECOS release that touched production
schema and a live MCP function in the same cutover. Two classes of
risk surfaced during the build:

- **Wrong-target risk.** The Supabase CLI v2.75.0 as installed did
  not cleanly support running migration apply against a project
  other than the currently linked one. A misconfigured link could
  cause a staging command to land in production. The probability
  of human error rises sharply when the same command line behaves
  differently depending on hidden link state.
- **Wrong-shape risk.** RC1 failed at production migration apply
  because pgvector references were unqualified. The same migration
  applied cleanly in some environments and failed in others
  depending on search path. Source-code review alone did not catch
  the failure mode; only an explicit "every pgvector reference is
  schema-qualified" gate did.

Other risks surfaced more diffusely:

- Approval drift — informal "yes go" treated as standing approval.
- Verification drift — commit messages presented as proof of state.
- Scope creep — multi-action steps that were hard to audit.

## Decision

Production release safety rests on six explicit gates, applied in
order:

1. **Source-controlled tags.** The commit running in production is
   identified by a release tag (e.g. `ecbrain-v1-rc2`). The tag is
   the answer to "what is running"; the working tree is not.
2. **Read-only preflight.** Before any mutation, run a read-only
   check of the target environment, the linked ref, the pending
   migration set, and the function deploy state. Any unexpected
   state stops the release.
3. **TARGET CHECK block.** Every Supabase command, MCP write tool,
   or deploy is preceded by a fully filled-in TARGET CHECK block.
   Any blank field stops the release. The intended ref must match
   the current linked ref.
4. **Explicit approval.** Production mutations require an explicit
   approval phrase from the operator, given for the specific
   bounded action. Approval is not standing. Silence is not
   approval. Agreement on the plan is not approval to execute.
5. **Migration plan inspection.** Each pending migration is
   inspected by hand before apply. The inspection includes:
   confirming pgvector references are schema-qualified
   (`extensions.vector(1536)`, `extensions.vector_cosine_ops`),
   confirming no DROP, no unguarded UPDATE, no destructive
   operation that was not in the work order.
6. **Smoke tests.** After deploy, each new code path is exercised
   by a smoke test that produces an inspectable row tagged with a
   `test_run_id`. Smoke tests use the production auth path
   (`x-brain-key` header), not the query-string fallback. Smoke
   rows are retained as audit evidence by default.

### TARGET CHECK requirement

The TARGET CHECK block, as templated in
`docs/ecbrain/operations-runbook.md`, is mandatory before any
Supabase command, MCP write tool, or deploy. Every field must be
filled in. A blank field is a stop condition.

### Approval phrase requirement

Production mutations require an explicit, scoped approval phrase
from the operator. The phrase:

- Names the bounded action being approved.
- Is given immediately before execution, not at planning time.
- Does not extend to subsequent actions, even closely related ones.

If the operator and assistant lose track of which approval covers
which action, the assistant stops and asks before continuing.

### Supabase CLI v2.75.0 exception pattern

Because the installed CLI did not cleanly support apply against a
non-linked project, a temporary linked worktree pattern is used
for production migration apply:

1. Create a fresh git worktree from the release tag.
2. Link the worktree to production.
3. Run apply from inside the worktree.
4. Unlink the worktree.
5. Remove the worktree.

This isolates production link state from the primary checkout.
The pattern is a workaround for a CLI limitation; if a future CLI
release supports project-ref selection cleanly for apply, this
ADR should be revisited and the pattern retired.

## Rationale

- **Tags over working trees.** A working tree can be ahead, behind,
  or diverged from production at any moment. Tags are immutable
  pointers to the commit that was actually deployed.
- **Read-only preflight is cheap.** The cost of a preflight is
  measured in seconds; the cost of a wrong-target apply is measured
  in production downtime and rollback work.
- **Target checks defeat hidden link state.** The most common cause
  of accidental production writes is a CLI command that defaulted
  to a different link than the operator believed. A target check
  forces that mismatch into the open before execution.
- **Explicit approval defeats drift.** "Yes go" given two messages
  ago is not approval for the action being run now. Per-action
  approval keeps the operator's oversight point synchronized with
  the assistant's execution point.
- **Manual migration inspection caught RC1.** RC1 was caught by the
  per-migration inspection step, specifically the
  schema-qualification check. The cost of the inspection is small;
  the cost of letting it slip is a partial schema state.
- **Smoke tests using production auth.** A smoke test that uses a
  different auth path than real traffic is a misleading test. The
  smoke must exercise what production actually does, including
  the auth shape.

## Consequences

- Release work is slower per step. The total clock time goes up
  because each gate is explicit. The wall-clock cost of a botched
  release is much higher; the trade favors the gates.
- Documentation overhead grows. Each release produces an audit
  report; each ADR captures a decision. This is intended.
- The temporary linked-worktree pattern is documented but is a
  smell — it exists because of a CLI limitation. When that
  limitation lifts, the pattern should retire and this ADR should
  be amended.
- The approval phrase pattern requires the operator to be present
  in the loop for every production mutation. This is a feature, not
  a bug: ECBRAIN does not run unattended releases.
- Smoke rows accumulate over time. They are retained intentionally;
  cleanup, if desired, is a separately approved work order.
