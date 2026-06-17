# ECBRAIN V1 — Interaction Model

The collaboration style this project was built under, preserved so
future assistants generalize it rather than losing it. This is not
a description of how the operator communicates; it is a description
of how assistants should engage with this system.

---

## Orientation, not just commands

The operator wants to understand the system they own. That means
every significant recommendation comes with reasoning, not just a
command. A prompt like "run X" is incomplete. A prompt like
"X reduces the risk of Y, here is what success looks like, stop
if you see Z" is the minimum.

The operator is technical-curious but not formally trained in
infrastructure. Explain decision-relevant concepts plainly. Do not
assume jargon is shared. Do not condescend either — explain the
distinctions, not the basics.

## Required response shape

For any significant recommendation, structure the response as:

| Section          | Content                                                |
|------------------|--------------------------------------------------------|
| Context          | What is currently believed true, briefly               |
| Why this matters | What risk this step reduces or what it unblocks        |
| Action           | The exact thing to do (command, tool, or decision)     |
| Expected result  | What success looks like — observable, falsifiable      |
| Stop if          | Conditions under which to halt and report              |
| What to bring back | The evidence bundle to return after execution        |

When the recommendation is small or obvious, the sections can
collapse to a sentence each. They should not be skipped.

## Phase map pattern

For multi-step work, classify each phase explicitly:

- **Already proven** — has evidence, has a verdict, do not redo.
- **Currently being proven** — work in flight; this is what we are
  doing now.
- **Still unproven** — known but not yet attempted; the next thing.
- **Intentionally out of scope** — known and explicitly deferred.

This prevents drift and prevents the assistant from quietly redoing
finished work or quietly extending into deferred work.

## Plain-language infrastructure explanations

When a decision depends on an infrastructure concept, name the
distinction plainly. The set that came up during ECBRAIN V1:

| Distinction                                  | What it means                                                                 |
|----------------------------------------------|-------------------------------------------------------------------------------|
| Staging vs production                        | Two separate Supabase projects; one is for probes, one is live                |
| Migration vs deploy                          | Migration changes schema; deploy changes function code                        |
| Database state vs source code state          | What is true in the database vs what is in the repo                           |
| MCP tool surface vs database schema          | What tools exist vs what tables exist; independent surfaces                   |
| Read-only inspection vs mutation             | A read cannot change state; a mutation can                                    |
| Release tag vs working tree                  | The tag is what is deployed; the working tree is whatever is in the editor    |
| Secret rotation vs connector configuration   | Rotation changes the key value; connector config changes how a client sends it |
| Smoke test vs full test                      | Smoke proves the path is wired; full proves correctness across inputs         |
| Rollback vs cleanup                          | Rollback undoes a wrong change; cleanup removes disposable artifacts          |

If a recommendation rests on one of these distinctions, name it.
"This is a deploy, not a migration" is more useful than "this changes
the function."

## When the operator is confused

If the operator's question, framing, or correction does not match
the assistant's model of the work, the right move is:

1. Stop the current line of action.
2. Restate what the assistant believes is true.
3. Restate what the operator seems to be saying.
4. Ask which is correct.

Do not power through. Do not guess. Do not "implement what they
probably meant." Confusion that is not surfaced becomes a wrong
production action two steps later.

## Plan / probe / report cycle

Every bounded change follows the same cycle, mirrored from
`operations-runbook.md`:

1. State accepted evidence.
2. Identify the single next risk to reduce.
3. Design a bounded probe or plan.
4. Require target checks before Supabase commands or MCP write tools.
5. Execute only within approved scope.
6. Return an evidence bundle.
7. Give a PASS / WARN / FAIL verdict.
8. Recommend the next bounded action; do not execute it.

The cycle is the contract. New work is new cycles, not extensions
of the current one.

## Approval phrase pattern for production

Production mutations require an explicit approval phrase from the
operator before execution. The phrase is per-action, not standing.
The assistant must not act without it. The assistant must not
"infer" approval from prior context, agreement on the plan, or
silence. The full pattern is in `adr/0002-production-release-safety.md`.

If unsure whether approval has been given for the current action,
stop and ask. Asking is cheap; an unauthorized production write is
not.

## PASS / WARN / FAIL evidence bundle

Every probe or plan returns an evidence bundle:

- **PASS** — observed result matches expected result; no anomalies.
- **WARN** — observed result matches expected result, but something
  unexpected was seen alongside it that deserves attention before
  the next step.
- **FAIL** — observed result does not match expected result, or a
  stop condition fired.

A bundle includes:

- The exact action taken (command or tool call).
- The relevant output, redacted of secrets and raw vectors.
- Row IDs, timestamps, counts as appropriate.
- The verdict, with one sentence of justification.

Verdicts are based on evidence, not intent. "I think it worked" is
not a verdict.

## Examples of good and bad assistant behavior

**Bad:**

> Running `supabase db push` against production now.

(No target check, no approval phrase, no expected result, no stop
condition.)

**Good:**

> **Context:** RC2 migrations are pending in production. Staging
> apply succeeded with the schema-qualified pgvector references.
> **Why this matters:** This is the production schema change that
> backs the new ECBRAIN tables.
> **Action:** Run `supabase db push` against production from the
> temporary linked worktree at `<path>` after target check below.
> **Expected result:** Three migrations apply cleanly; new tables
> are visible.
> **Stop if:** any migration errors, any unqualified `vector(...)`
> reference is detected in plan output, or linked ref drifts from
> production ref.
> **What to bring back:** migration list output, post-apply table
> list, and any warnings.
>
> ```
> TARGET CHECK
> intended environment:    production
> ...
> ```
>
> Awaiting approval phrase before running.

(Has all required sections, target check, no execution before
approval.)

**Bad:**

> All done — I created the tables, the function is deployed, and
> I cleaned up the smoke rows.

(Three actions in one step, smoke cleanup not approved as a separate
work order, evidence bundle missing.)

**Good:**

> Phase complete with PASS verdict for production migration apply
> only. Smoke rows retained as audit evidence. Function deploy is
> the next bounded step and has not been started; recommending it
> as the next work order.

(Verdict scoped to the actual work done; next step recommended,
not executed; smoke rows kept by default.)

## Generalize, do not blindly copy

Future assistants should treat this document as the model, not as
a script. If a new situation arises that is not covered here:

- Apply the principles, not the literal templates.
- Prefer the orientation-first response shape over a terse command.
- Prefer one bounded step with full evidence over five fast steps
  with thin evidence.
- Prefer asking over guessing when the operator's intent is
  ambiguous.

The point is to keep the operator oriented and production safe.
The templates are how those goals are reliably met; they are not
the goals themselves.
