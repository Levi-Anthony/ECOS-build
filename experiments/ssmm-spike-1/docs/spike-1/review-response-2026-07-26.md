# Increment 1 Review Response

Status: superseded by Slice Contract v0.2 and re-verified locally

## v0.2 contract replacement

Levi clarified that the execution gap is the lived interval of Move. The
runtime now retains authoritative Move custody across that interval and routes
Action Button re-entry to a Move cockpit.

The earlier scaffold was replaced where it treated acceptance as installation,
used a generic return menu, stored a loose active-loop projection, collapsed
completion into outcome, and lacked conditioned residue.

The revised implementation adds:

- separate authoritative main-loop and phase records;
- a persisted non-authoritative proposal history;
- an installation gate distinct from acceptance;
- exactly-once `shape_installed`, `parent_entered_move`,
  `parent_entered_metabolize`, and terminal transitions;
- durable Move position, progress, interruption, friction, evidence, and claim;
- one bounded adjustment subloop that cannot reverse the parent to Shape;
- material invalidation through Metabolize;
- separate completion claim and verification;
- conditioned residue and recovery state.

## Findings resolved

- Shape is now a runtime-backed `request_shape_proposal` action. Provider output
  is validated, the runtime restores the governed Purpose handle, and the
  proposal remains non-authoritative.
- `sense_input_recorded` and `sense_field_updated` are separate events with
  separate actors and perspectives. One request persists both atomically.
- `accept_shape_proposal` starts installation but does not advance the parent
  phase. `confirm_shape_installed` performs the exactly-once transition after
  installation evidence or an explicit waiver. The obsolete `install` wire
  property is rejected.
- Loop retrieval, focal-active-loop lookup, and midstream resume are
  implemented.
- The RPC catches concurrent unique violations and returns the winning request
  as an idempotent replay.
- Non-closing writes preserve `closed_at`.
- Closed and disposed loops reject implicit reopening.
- The sequence-allocation row lock is documented beside the load-bearing query.
- Configuration is validated at module load.
- Shared-secret comparison uses equal-length SHA-256 digests and a constant-work
  byte comparison.
- Client errors are bounded; unknown, provider, database, and configuration
  details are not returned to the client.
- Access documentation now distinguishes enabled RLS from the actual grant rail;
  `service_role` bypasses RLS.

## Evidence

- Clean local database reset applied the migration successfully.
- 24 Deno tests passed.
- 27 pgTAP persistence/security assertions passed.
- Concurrent identical requests produced two HTTP 200 responses, one write, one
  replay, one loop, and one event.
- A local end-to-end HTTP flow crossed the client-request seam and verified:
  proposal non-authority; acceptance distinct from installation; restored Move
  cockpit and rationale; parent-linked bounded assistance; completion claim
  distinct from verification; and residue inherited by a new Sense without a
  preselected Move.
- Supabase database lint reported no findings in `ssmm_spike1`; the bundled
  pgTAP extension emits its own compatibility findings.
- Deno type-check, formatting, and `git diff --check` passed.

## Still pending reality

- Dedicated remote Supabase project and secret configuration
- Remote migration, grant, and function deployment verification
- Real Shape-provider behavior with the selected model
- Shortcut and Action Button installation
- A genuine interval of human-only execution and Move-cockpit restoration
- Bounded adaptation or interruption during a real Move
- Separate completion verification and conditioned residue in the field
- Controlled and real field tests
- Review packet and falsifier assessment

## Future promotion boundary

An evidence-informed, non-governing amendment now points toward one future
greenfield Supabase project containing both the rebuilt ECB semantic-memory
core and the SSMM runtime as structurally separate systems.

This does not add a Spike 1 gate. The current runtime can proceed before the
future thoughts substrate exists. Semantic memory must not infer authoritative
loop state, and runtime records become thought candidates only after
Metabolize produces human-confirmed durable meaning with loop/Shape provenance.

The current dedicated adjustment-subloop table remains reversible Slice 1
evidence, not a hard-locked promotion schema.

## Accountability

- Linear `ECO-70` tracks the Spike 1 reality-integration work under parent
  Human Rail outcome `ECO-61`.
- Local implementation lives on Git branch `codex/eco-70-ssmm-spike-1`.
- This review does not claim product success. It establishes local
  implementation evidence and leaves the remote, Shortcut, and field gates
  visibly open.
