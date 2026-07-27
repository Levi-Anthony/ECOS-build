# SSMM Spike 1 — Slice Contract v0.2

Status: revised executable contract

Authority: current problem-space definition plus Levi’s clarification of the
Move execution interval

Scope: one authoritative focal main loop, strict SSMM sequence, resumable Move
custody, and one explicit nested-assistance mechanism during Move

Non-ratification: this contract does not establish a generalized multi-loop
ontology, recursive orchestration engine, AQAL schema, or complete Purpose
architecture.

## 1. Product claim

The system guides Levi from Sense into an accepted and sufficiently installed
Shape; retains authoritative custody of the resulting Move during a real
period of human-only execution; restores the Move, Shape, reason, operating
envelope, and exit condition on demand; supports bounded adaptation without
reversing the parent loop; distinguishes completion claims from verification;
Metabolizes the result; and leaves conditioned residue for a new Sense.

Before the gap, the system helps install the Move. During the gap, it holds the
Move. After the gap, it helps the result land.

## 2. Execution gap

The execution gap is the lived interval of Move. Levi acts in the world while
the runtime preserves custody without continuous control. The parent remains
in Move. Time passing alone never advances phase.

The runtime preserves the installed Shape, rationale, reason chain, exit
condition, permitted adaptations, invalidation conditions, expected evidence,
progress, interruption history, and current disposition.

## 3. Authoritative routing

The Action Button opens the authoritative surface of one focal active main
loop:

- no loop → Sense;
- Sense → resume Sense;
- Shape → resume proposal review, correction, or installation;
- Move → Move cockpit;
- Metabolize → consequence integration and disposition;
- uncertain authority → recovery without silent loop creation.

This display boundary does not claim only one loop can ever exist.

## 4. Main-loop invariants

1. Machine-generated Shape is a proposal, not authority.
2. Correction does not advance phase.
3. Acceptance is not automatically installation.
4. Shape enters Move exactly once.
5. Parent Move never reverses directly to parent Shape.
6. Bounded Move assistance uses a parent-linked nested SSMM subloop.
7. Material invalidation terminates Move through Metabolize.
8. Metabolize never prescribes the next Move.
9. Time passage never advances phase.
10. Completion claim and verification are distinct.
11. Every authoritative transition is persisted.
12. Repeated requests cannot repeat an authoritative transition.

## 5. Sense

Sense gathers enough grounded information for a useful Shape attempt rather
than exhaustively describing reality. Its corrigible output includes present
conditions, salient demand or possibility, constraints, uncertainty, changed
conditions, Purpose or Orientation contact, and material Shape must respect.

Sense ends only when a persisted sufficiency basis says the runtime can attempt
a correctable Shape with an observable exit condition.

## 6. Shape and installation

A generated Shape begins as a versioned persisted proposal. Levi may reject,
correct, deepen, regenerate, resize, reorient, change its exit condition, or
stop the loop.

Authoritative Shape content preserves:

- Move target and decision;
- orientation, immediate why, and expandable reason chain;
- observable exit condition;
- degrees of freedom;
- quick-check, help-required, and invalidation boundaries;
- anticipated obstacles and interruption handling;
- expected completion evidence;
- installation requirements and actions;
- first physical action and cockpit cues.

Acceptance starts installation. Move begins only after installation conditions
are satisfied or explicitly waived, the installed Shape is persisted, and the
exact transition is recorded. A small-Move exception must be explicit.

## 7. Move custody and cockpit

Once installed, the parent remains in Move until completion, invalidation,
release, abandonment, or another explicit disposition enters Metabolize.

Move positions are runtime positions, not SSMM phases:

`not_started`, `starting`, `active`, `paused`, `interrupted`, `blocked`,
`awaiting_external_condition`, `completion_claimed`.

The cockpit restores the current Move, installed Shape, why, reason chain,
orientation, permitted variation, help and invalidation boundaries, exit
condition, evidence requirement, and latest known position.

## 8. Mid-flight change

Bounded adaptation applies only while target, exit condition, main reason, and
orientation remain valid and the change fits the permission envelope or a
small negotiated extension.

It uses one explicit nested mechanism:

`parent Move → nested Sense → nested Shape → nested Move → nested Metabolize →
parent Move restored`

The nested record retains parent loop, parent phase, parent Shape version,
reported change, adjustment boundary, result, and effect on the parent.

Material invalidation applies when target, exit, reason, orientation, viability,
or authorization materially changes. The old Move is not rewritten:

`Move → invalidation → Metabolize → disposed → later fresh Sense`

## 9. Completion and verification

The runtime separately records:

- Levi’s claim, timestamp, result, evidence, and qualification;
- the installed exit-condition version;
- the verification method, evidence considered, result, limitation, verifier,
  and discrepancy.

Verification results are `verified`, `partially_verified`, `not_verified`,
`cannot_verify`, `exit_condition_disputed`, or
`additional_evidence_required`.

Located human evidence remains valid even when external verification is
unavailable.

## 10. Metabolize and residue

Metabolize compares what occurred with the installed Shape, orientation, exit
condition, and evidence. It may credit results, characterize failure or
invalidation, preserve consequences, record learned constraints, release
material, and retain unresolved residue.

It must not create the next Shape or preselect the next Move.

Conditioned residue records what landed, changed, remains alive, failed, was
learned, was released, remains unresolved, and now carries directional weight.
A later new Sense reads the changed field.

## 11. No-active-loop and recovery

The runtime distinguishes never-started, cleanly closed, released, abandoned,
invalidated, expired, and authoritative-state-unknown histories.

Unknown authority exposes uncertainty and recent trustworthy records. Levi
must recover or dispose it. A new loop is never created silently.

Time alone does not expire a Move in Slice 1. On return, Levi resumes, requests
bounded help, reports material change, reports unrecorded completion, abandons,
or declares uncertainty.

## 12. Purpose seam

Slice 1 preserves an immediate why, governing orientation, optional parent
commitment or project handle, optional Purpose handle, and expandable reason
chain. This is a shallow upward seam, not a complete Purpose holoarchy.

## 13. Persisted objects

- `main_loops`
- `sense_states`
- `shape_proposals`
- `installed_shapes`
- `move_custody`
- `adjustment_subloops`
- `metabolize_states`
- append-only `events`

Proposal, acceptance, installation, execution, claim, verification, and residue
must never be collapsed into one ambiguous state object.

## 14. Exactly-once authoritative seams

At minimum, uniqueness is enforced for:

- `shape_installed`
- `parent_entered_move`
- `parent_entered_metabolize`
- `loop_closed`
- `loop_disposed`

Same-client retries replay the original result. Different client identifiers
cannot repeat the same authoritative seam transition.

## 15. Runtime actions

`open_current_surface`, `submit_sense_input`, `request_shape_proposal`,
`correct_shape_proposal`, `reject_shape_proposal`,
`accept_shape_proposal`, `record_installation_action`,
`confirm_shape_installed`, `record_move_progress`, `request_move_help`,
`record_move_interruption`, `resume_move`, `report_changed_conditions`,
`classify_change`, `claim_completion`, `submit_completion_evidence`,
`release_move`, `abandon_move`, `submit_metabolize_input`,
`confirm_residue`, `close_loop`, `recover_authoritative_state`.

## 16. Required field path

1. Enter with no loop.
2. Ground Sense sufficiently.
3. Persist a proposal.
4. Correct at least one element.
5. Accept.
6. Establish installation.
7. Enter Move exactly once.
8. Leave the interaction.
9. Execute in the world.
10. Re-enter during Move.
11. Restore cockpit custody.
12. Resume, report progress, adapt, or record interruption.
13. Continue human-only execution.
14. Claim completion or report material invalidation.
15. Supply evidence.
16. Enter Metabolize.
17. Compare result with installed Shape and exit condition.
18. Record verification separately.
19. Confirm conditioned residue.
20. Close or dispose.
21. Press the Action Button again.
22. Verify fresh Sense encounters residue without a preselected Move.

Without steps 8–12, custody of the execution gap has not been tested. Without
steps 14–20, the result has not landed.

## 17. Principal falsifiers

The slice is materially challenged if the Move is understandable but not
startable; installation is inferred; re-entry cannot restore custody; client
memory is required; bounded help replaces the parent; invalidation rewrites the
old Move; a claim becomes verification automatically; Metabolize preselects a
Move; the cockpit substitutes for execution; working-memory burden increases;
or an obsolete Move is preserved against present reality.

## 18. Review question

Did the runtime retain authoritative custody of an installed Move across a
genuine interval of human-only execution, then correctly receive and integrate
its result without corrupting the SSMM sequence?
