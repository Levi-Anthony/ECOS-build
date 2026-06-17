# ADR 0003 — Plan / Probe / Report Collaboration Model

**Status:** Accepted

---

## Context

ECBRAIN V1 was built by an operator who is technical-curious but
not formally trained in infrastructure, working with assistants who
have command-shell capability against live systems. Two patterns
appeared early and recurred:

- **Velocity-only assistance.** "Run X" without context, without
  expected result, without a stop condition. Velocity-only work
  produces fast progress when everything is right, and silent
  damage when anything is wrong. The operator cannot intervene
  because they do not see the model the assistant is operating
  from.
- **Confidence drift.** An assistant that quietly extends scope —
  "while I was in there I also did Y" — accumulates surface area
  the operator never approved. Each extension is small; the
  cumulative effect is a system the operator no longer fully
  understands.

The operator made it explicit during the build: they want
orientation, not only commands. They want to understand the
distinctions a recommendation rests on. They want to know what
would make a step succeed and what would make it stop. They want
verdicts, not vibes.

## Decision

Future assistants working on ECBRAIN — and on adjacent ECOS systems
that share the same risk profile — use the **orientation-first
plan / probe / report model**.

### Required response shape

For any significant recommendation:

| Section            | Content                                                |
|--------------------|--------------------------------------------------------|
| Context            | What is currently believed true, briefly               |
| Why this matters   | What risk this step reduces or what it unblocks        |
| Action             | The exact thing to do                                  |
| Expected result    | What success looks like — observable, falsifiable      |
| Stop if            | Conditions under which to halt and report              |
| What to bring back | The evidence bundle to return after execution          |

For trivial recommendations the sections may collapse to a
sentence each. They are not skipped.

### When to ask for clarification vs when to make bounded best-effort progress

- **Ask for clarification** when: the operator's intent is
  ambiguous in a way that affects what would be modified, what
  scope is being approved, or which environment is in play. Ask
  when the answer would change the plan, not just the wording.
- **Make bounded best-effort progress** when: the answer is
  reversible and contained — a documentation choice, a phrasing,
  a non-destructive read. State the assumption you are making and
  invite correction in the next step.

Default to asking when production is downstream of the answer.
Default to bounded progress when the work is local and reversible.

### How to preserve production safety while keeping the operator oriented

These are not in tension. Production safety comes from the gates
in `adr/0002-production-release-safety.md`. Operator orientation
comes from the response shape above. The combination is:

1. **Plan** the bounded action with full context up front.
2. **Probe** only after a TARGET CHECK and an explicit approval
   phrase, executed in the smallest scope that achieves the goal.
3. **Report** an evidence bundle with a PASS / WARN / FAIL verdict
   based on observed output, not intent.

The operator stays oriented because every step shows its model
before execution. Production stays safe because every step is
gated, scoped, and reported.

## Rationale

- **Orientation-first is the operator's stated preference.** The
  decision is not derived; it is explicit. Future assistants
  should not relitigate it.
- **The response shape is generalizable.** It is not a script for
  ECBRAIN; it is a shape for any non-trivial work where the
  operator carries oversight. The same shape applies to ECOS
  architecture work, BRAIN protocol changes, and any future
  Supabase project under this operator.
- **PASS / WARN / FAIL keeps verdicts honest.** An assistant that
  says "I think it worked" without observable evidence has not
  finished the step. WARN is a real verdict — it is the right
  call when the action succeeded but something unexpected was
  visible alongside it.
- **Plan / probe / report mirrors the operations runbook.** The
  collaboration model and the safety model use the same loop. This
  is intentional: an operator should not have to learn two
  different cycles to work with the system.

## Consequences

- Responses are longer. The trade is intentional. The operator
  reads recommendations carefully; longer responses with structure
  are read faster than shorter responses without it.
- Assistants must resist scope drift. Doing "one more thing while
  I'm here" is a violation of the model. New scope is a new step.
- Future assistants must read this ADR and `interaction-model.md`
  before working on ECBRAIN. Generalizing the model from a single
  prior session is unreliable; the documented model is the
  contract.
- This ADR is not a literal script. The principles take precedence
  over the templates. When a new situation does not fit the
  templates, apply the principles: keep the operator oriented,
  scope the action bounded, report on observed evidence, recommend
  but do not execute the next step.

## Example mini-template

For small, day-to-day recommendations:

> **Context:** <one line of accepted state>
> **Why this matters:** <one line on the risk reduced or unblock>
> **Action:** <exact command, tool, or decision>
> **Expected result:** <observable success criterion>
> **Stop if:** <one or two halt conditions>
> **What to bring back:** <evidence to include in the report>

For larger work, expand each section as needed and add a TARGET
CHECK block before any Supabase command, MCP write tool, or deploy.
