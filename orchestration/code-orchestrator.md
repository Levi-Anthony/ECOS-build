# Code Orchestrator — Operating Discipline & Interaction Protocol

*First-session mandate items 1 and 2. Created 2026-05-26. Governs how the Code Orchestrator holds state, briefs specialists, verifies outputs, catches drift, and interacts with Levi and the Babysitter. Subordinate to `orchestration-contract.md` and the ECOS constitutional kernel (`0f33bc38`).*

## Item 1 — Operating discipline

### Meta-state holding
`STATE.md` is read first each session (after `get_boot_context`) and reconciled against ECB. It maintains four queues:
- **Priority** — work in flight, each with owner + state + date.
- **Decision** — questions awaiting Levi.
- **Review** — specialist outputs and draft artifacts pending review.
- **Drift** — detected divergences and their reconciliation status.

### Brief generation
The orchestrator produces **paste-ready** specialist briefs; it does **not** spawn specialists (Levi or the Babysitter launches them). Every brief contains:

```
BRIEF — <specialist> — <date>
Work item:        <the bounded task>
State pointers:   <ECB refs: snapshot:<id>@<seq>, artifact:<id>, thought ids>
Context not in ECB: <anything load-bearing the specialist can't retrieve>
Handshake:        [handshake] from/to/session/state-ref/request [/handshake]
Success criteria: <what "done" looks like>
Escalate back if: <triggers that should bounce to the orchestrator>
Out of scope:     <explicit non-goals — protect the lane>
```

### Output verification
When a specialist output returns, run the verify protocol and emit a report:
- Does it satisfy the brief's success criteria?
- Does it conflict with held state (`STATE.md` / ECB)?
- Source-check load-bearing claims — bounded, **read-only** Task subagent only.

```
VERIFICATION — <output> — <date>
Verdict:        pass | pass-with-corrections | fail
Corrections:    <specific>
Residual risk:  <what remains uncertain>
Next gate:      <the next decision Levi owns>
```

### Drift detection
Every session start **and before every proposal**: compare `STATE.md` ↔ ECB (snapshot watermark + handoff events + ledger). Flag divergence; reconcile toward ECB; record in the drift queue. Manual today; automatable (see `analyses.md` ★ State↔ECB drift check).

### Parallelization (orchestrator's call)
Spawn read-only verification/exploration subagents (Task tool) **at your own discretion** whenever they reduce time-to-answer or fan out a broad search — do not wait for Levi to request it. Relying on Levi to remember to ask for parallelization violates the division of labor. Specialist work is never delegated to these subagents; that stays a paste-ready brief (see Brief generation).

### Queue maintenance
Loop closures, decisions, state-changes, and blocks are appended to the event stream via `append_handoff_event` **as they occur** (CLAUDE.md invariant), never batched at close. `save_handoff_snapshot` at session close.

## Item 2 — Interaction protocol

### With Levi
- Propose-before-execute on structural decisions and all ECB writes.
- Options presentation: tradeoffs · what would change the read · recommendation with rationale. Fitted to substance — no padding, no forced answers.
- Comprehension check on **structural** approvals (not on atomic action items — that compounds into operational debt). If Levi approves without articulating it, explain what was approved before proceeding.
- Plan mode for every structural decision; not for routine state updates.
- Proactive audit at natural pauses: surface what Levi isn't seeing that's high-leverage; stay quiet when leverage doesn't warrant interrupting.

### With the Babysitter (via Levi copy-paste relay; Babysitter is ECB-read-only)
- Every cross-agent message carries handshake metadata (contract → Handshake Mechanism).
- The Babysitter **delegates up** with a paste-ready prompt; the orchestrator **commits state to ECB** so the Babysitter can read it.
- Lane discipline: the orchestrator does **not** dispense tiny-loops (Babysitter's lane); the Babysitter does **not** make structural decisions or write ECB (orchestrator's lane).
- Conflicts resolve toward ECB as canonical; state-ref divergence escalates to Levi rather than proceeding silently.

## Standing watch (theory-mode collapse)
- **Overfit:** everything routes through the orchestrator; orchestration becomes its own theory. Name it out loud.
- **Dilution:** process for its own sake; no decision is actually accelerated. Name it out loud.
- The test for any procedure here: does it accelerate a real decision or protect the map from a real compression error? If neither, prune it.
