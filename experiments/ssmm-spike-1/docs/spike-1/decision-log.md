# Decision Log

## D-001 — Isolated execution surface

- Class: hard-lock compliance
- Decision: build Spike 1 under `experiments/ssmm-spike-1`
- Evidence: the controlling suite requires a new Supabase project and forbids
  migration of the existing architecture
- Reversible: yes
- Consequence: no Spike 1 migration or function is added to live ECB
- Review trigger: dedicated project is linked

## D-002 — Projection plus append-only events

- Class: provisional product implementation
- Decision: use separate authoritative loop/phase projections plus one
  append-only event stream
- Evidence: supports return, correction, idempotency, and review without fixing a
  final domain ontology
- Reversible: yes, through event replay and later migration
- Falsifier: separate authority states collapse into one loose object or the
  event stream cannot explain active state

## D-003 — One transactional write RPC

- Class: reversible implementation
- Decision: lock the loop, append the event, and update the projections in one
  database transaction
- Implementation basis: intended to prevent accepted events and projections
  from silently diverging
- Evidence status: locally verified after a clean database reset by 27 pgTAP
  assertions and a two-request concurrency race. Remote verification remains
  pending on the dedicated project.
- Reversible: yes
- Falsifier: retry or concurrent writes create duplicate or misordered events

## D-004 — The execution gap belongs to Move

- Class: revised executable contract
- Decision: keep the authoritative parent loop in Move throughout human-only
  execution; Action Button re-entry opens the Move cockpit
- Evidence: Levi's Slice Contract v0.2 clarification
- Consequence: time passage, interruption, and progress change Move position,
  not SSMM phase
- Falsifier: re-entry starts a generic interaction or loses the installed Shape

## D-005 — Separate persisted records for distinct authority states

- Class: invariant installation
- Decision: persist main loop, Sense state, proposals, installed Shape, Move
  custody, adjustment subloops, and Metabolize state separately
- Evidence: a single loose JSON projection collapsed proposal, acceptance,
  installation, execution, and result
- Consequence: authoritative seams can carry independent constraints and audit
- Reversible: schema remains confined to the isolated spike

## D-006 — One explicit nested-assistance mechanism

- Class: Slice 1 boundary
- Decision: bounded adaptation runs through one parent-linked adjustment
  subloop while the parent remains in Move
- Non-claim: this is not a generalized recursive orchestration engine
- Promotion status: the current `adjustment_subloops` table is reversible
  implementation evidence, not a hard-locked destination schema. An ordered
  event sequence may prove sufficient; field evidence must earn any generalized
  parent-child engine.
- Falsifier: the adjustment silently changes target, reason, orientation, or
  exit condition

## D-007 — Future ECB/SSMM co-location without authority collapse

- Class: evidence-informed future-plan amendment
- Standing: non-governing until tested and ratified
- Direction: the future semantic-memory core and SSMM runtime likely inhabit
  one greenfield Supabase project while remaining structurally separate
- Boundary: `thoughts` preserves semantically retrievable settled meaning;
  `ssmm_*` structures preserve authoritative current position and legal
  transition
- Memory circulation: runtime event → Metabolize → human-confirmed durable
  meaning → thoughts projection
- Prohibition: semantic retrieval, model output, client booleans, and
  Shortcut-supplied phase claims cannot advance or reconstruct authoritative
  runtime state
- Non-prerequisite: canonical OB1 installation must not delay remote runtime,
  direct HTTP, Shortcut, or execution-gap field proof
- Open evidence: promotion target, exact schema, adjustment representation,
  transition-function decomposition, and any MCP write vocabulary
