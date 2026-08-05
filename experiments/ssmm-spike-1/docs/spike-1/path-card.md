# Spike 1 Path Card — Slice Contract v0.2

Status: frozen execution path for the current spike

## Core path

`Sense → Shape proposal → acceptance → installation → Move custody →
Metabolize → residue → closed/disposed → fresh Sense`

## Entry routing

- No authoritative active loop → Sense entry
- Sense → resume grounded input
- Shape → resume proposal review, correction, or installation
- Move → open the Move cockpit
- Metabolize → resume consequence integration and disposition
- Uncertain authority → recovery; never silently create another loop

## Installation gate

Move begins exactly once, only after:

1. Levi accepts a persisted proposal.
2. Required installation conditions are satisfied or explicitly waived.
3. The installed Shape is persisted.
4. `shape_installed` is persisted.
5. `parent_entered_move` is persisted.

Acceptance alone is not installation. A small-Move exception must be explicit.

## Move cockpit

The cockpit restores:

- current Move and position;
- installed Shape and decision;
- immediate why and expandable reason chain;
- operating orientation;
- degrees of freedom and quick-check boundary;
- help and invalidation boundaries;
- exit condition and expected evidence;
- latest progress, interruption, or bounded adjustment.

Position changes remain inside Move:

`not_started | starting | active | paused | interrupted | blocked |
awaiting_external_condition | completion_claimed`

Time passing does not advance the phase.

## Mid-flight fork

Bounded adaptation:

`parent Move remains authoritative → nested Sense/Shape/Move/Metabolize →
parent Move restored`

Material invalidation:

`Move → invalidation recorded → parent enters Metabolize → loop disposed →
later fresh Sense`

Parent Move never reverses directly to parent Shape.

## Completion boundary

The runtime separately preserves:

1. Levi’s completion claim.
2. The installed exit-condition version.
3. Evidence supplied.
4. Verification method and result.
5. Any discrepancy or limitation.

“Claimed complete” is not “verified complete.”

## Exit

Metabolize compares what occurred with the installed Shape, orientation, exit
condition, and evidence. It produces conditioned residue but does not select
the next Move.

The next Action Button invocation after closure opens a genuinely new Sense
that can encounter the residue.

## Falsifier

The slice fails if it cannot restore the same authoritative Move after a real
execution interval, if bounded help replaces the parent Shape, if invalidation
rewrites the old Move, if a completion claim becomes verification
automatically, or if residue does not change what a fresh Sense can encounter.
