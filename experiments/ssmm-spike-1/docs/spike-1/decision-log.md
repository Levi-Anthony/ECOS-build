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
- Decision: use one current session projection and one append-only event stream
- Evidence: supports return, correction, idempotency, and review without fixing a
  final domain ontology
- Reversible: yes, through event replay and later migration
- Falsifier: the event stream cannot reconstruct or explain active state

## D-003 — One transactional write RPC

- Class: reversible implementation
- Decision: lock the session, append the event, and update the projection in one
  database transaction
- Implementation basis: intended to prevent accepted events and projections
  from silently diverging
- Evidence status: locally verified after a clean database reset by 15 pgTAP
  assertions and a two-request concurrency race. Remote verification remains
  pending on the dedicated project.
- Reversible: yes
- Falsifier: retry or concurrent writes create duplicate or misordered events
