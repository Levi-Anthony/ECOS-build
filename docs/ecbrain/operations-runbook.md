# ECBRAIN V1 — Operations Runbook

Safe operating guide for ECBRAIN V1 in production. The goal here is
to make production work boring: every step has a target proof, an
explicit approval, and a known stop condition.

---

## The plan / probe / report loop

Every bounded change to ECBRAIN follows the same loop:

1. **State accepted evidence** — what is currently believed true,
   sourced from this folder or a recent verification.
2. **Identify the single next risk** — pick exactly one risk to
   reduce. If two risks compete, sequence them.
3. **Design a bounded probe or plan** — what command, in what
   environment, with what expected output, and what would make us
   stop.
4. **Require target checks** — before any Supabase command or MCP
   write tool, a TARGET CHECK block is filled in and approved.
5. **Execute only within approved scope** — do not extend the work
   inside the same step. New scope means new step.
6. **Return an evidence bundle** — actual command output (redacted as
   needed), row IDs, timestamps, observed counts.
7. **Give a PASS / WARN / FAIL verdict** — based on the evidence,
   not on intent.
8. **Recommend the next bounded action** — but do not execute it.
   The next step is its own step, with its own approval.

This is the "plan / probe / report" cycle. It is not bureaucracy; it
is how a human keeps oversight of a system whose state can change
with one command.

## TARGET CHECK template

Use this block before any Supabase command, MCP write tool, or
deploy. Every field must be filled in. No blanks, no placeholders.

```
TARGET CHECK
intended environment:    production | staging | local | none
intended project name:   <e.g. open-brain>
intended project ref:    <e.g. lqbrzoicorehwidkdhoi>
current linked project ref: <output of supabase status / link>
targeting method:        --project-ref | linked | env var | other
production ref:          lqbrzoicorehwidkdhoi
staging ref:             gfqumzumfdeeojuwwvbu
command/tool about to run: <exact command or tool name>
classification:          read-only | mutation | deploy | migration apply
why it is safe:          <one sentence>
can affect production:   yes | no
```

If any line is missing, stop and fill it in before running.

If `intended project ref` does not match `current linked project ref`,
stop and reconcile before running. A mismatch is the most common
cause of accidental production writes.

## Production mutation rules

A mutation is anything that could change production state: migration
apply, function deploy, MCP write tool, secret rotation, role change.

Production mutations require, in order:

1. A target check showing production scope.
2. An explicit approval phrase from the operator.
3. The smallest possible scope that achieves the goal.
4. A pre-mutation read so we know what we are about to change.
5. A post-mutation read so we know what changed.
6. An evidence bundle in the report.

The approval phrase is documented in `adr/0002-production-release-safety.md`.
Approval is for one bounded action. It is not a standing approval.

## Read-only inspection vs mutation

Read-only inspection is anything that *cannot* change production
state: `select`, `\d`, `supabase db pull`, `supabase migration list`,
function `inspect`, MCP read tools.

Mutation is anything that can. The two should never be in the same
step. If a read tells us what to do next, that next thing is a new
step with its own approval.

When in doubt, classify as mutation.

## Migration vs deploy

These are two different operations:

| Operation        | Changes                                  | Surface              |
|------------------|------------------------------------------|----------------------|
| Migration apply  | Database schema (tables, RPCs, indexes)  | Database             |
| Deploy           | Function code (Edge Function bundle)     | Tool runtime         |

A migration changes the database state. A deploy changes the runtime
behavior of the function. They are independent. A function deploy
can break against a database that has not been migrated, and vice
versa. Always sequence: migrate first if the new function code
depends on new schema; deploy first if the new schema depends on
function-side embedding logic.

## Release tag vs working tree

The release tag is the commit that was actually deployed. The working
tree is whatever happens to be in the editor right now.

- Tag `ecbrain-v1-rc2` points at commit `79b824e2e01aeddebc115354895727e7d0c26c3f`.
  That is the commit currently running in production.
- The working tree may be ahead, behind, or diverged. Do not assume
  the working tree reflects production.

Before any production action that depends on "what is running," verify
against the tag, not against the working tree.

## Supabase CLI v2.75.0 limitation and temporary linked worktree pattern

The Supabase CLI version installed at the time of cutover (v2.75.0)
does not cleanly support running migration apply against a project
that is not the currently linked project. To apply migrations to
production while preserving safety, we used a temporary linked
worktree pattern:

1. Create a fresh git worktree from the release tag.
2. In that worktree, link to the production project.
3. Run the production migration apply from inside the worktree.
4. Unlink the worktree.
5. Remove the worktree.

This isolates production link state from the primary checkout, so the
primary checkout never carries a live link to production. It is a
workaround for the CLI limitation, not a recommended permanent
pattern. If a future CLI release supports `--project-ref` cleanly for
apply, this pattern can retire.

## Migration apply inspection gate

Before running a production migration apply:

1. Run a migration list against production and confirm pending
   migrations are exactly the migrations expected.
2. Inspect each pending migration file in the repo. Read it.
3. Confirm no DROP, no UPDATE without WHERE, no destructive
   operations against existing data unless explicitly intended.
4. Confirm pgvector references are schema-qualified
   (`extensions.vector(...)`, `extensions.vector_cosine_ops`).
5. Run a dry-run if available. Read the output.

Only after all five gates pass, with the operator's approval phrase,
run the apply.

## Smoke test policy

A smoke test is a small, intentional production write that exercises
a code path end-to-end and produces a row that can be inspected.

- Each smoke run gets a `test_run_id` (e.g. `phase_5_1c_prod_smoke_20260508`).
- Smoke rows are retained as audit evidence.
- Smoke rows are not silently cleaned up. Cleanup, if desired, is its
  own bounded work order with its own approval.
- Smoke tests do not use the `?key=` query-string auth path; they use
  the header path so the auth shape itself is exercised.

A smoke test is not a full test. It proves the path is wired. It does
not prove correctness across every input.

## Rollback vs cleanup

These are different actions for different situations:

| Action   | Used when                                      | Effect                          |
|----------|------------------------------------------------|---------------------------------|
| Rollback | A change was wrong and must be undone          | Restores prior state            |
| Cleanup  | A change was right but left disposable artifacts | Removes those artifacts only  |

Rollback for a migration usually means a forward migration that
reverses the change, not a literal `down` step — Supabase migration
files are forward-only. Plan the reverse migration *before* the
forward one if the change is non-trivial.

Cleanup is for things like smoke rows, test artifacts, or leftover
worktree directories. Cleanup never modifies the schema.

## Stop conditions

Stop and report — do not continue — if any of the following is true:

- A target check field cannot be filled in confidently.
- The current linked project does not match the intended project.
- A migration file contains an unqualified pgvector reference or any
  destructive operation that was not in the work order.
- A pre-mutation read returns unexpected state.
- Any tool or command requires pasting a secret into chat.
- The CLI returns an error and the cause is not understood.
- The operator has not given an approval phrase for this specific
  bounded action.

When stopping, write a short report: what was attempted, what was
observed, what would unblock progress.

## No secrets / no raw vectors rule

Never include any of the following in chat, logs, commit messages,
or documentation:

- The actual `MCP_ACCESS_KEY` value (current or rotated).
- A live `?key=...` URL with a real key.
- Raw embedding vectors.
- Service-role JWTs or database connection strings.

Secrets are referenced by name (`MCP_ACCESS_KEY`), not value.
Connector URLs are documented up to the path
(`/functions/v1/ecb-mcp`), not including any query-string secret.
