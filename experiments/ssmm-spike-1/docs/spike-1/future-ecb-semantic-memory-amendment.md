# Future Plan Amendment — SSMM Relationship to ECB Semantic Memory

Status: evidence-informed architectural direction  
Authority: non-governing until tested and ratified  
Applies to: promotion from SSMM Spike 1 into the future greenfield ECB/OB1
installation  
Does not alter: Slice Contract v0.2, current remote-runtime proof, Shortcut
proof, or field-test boundary

## Working statement

ECB thoughts are the semantic-memory substrate. SSMM is a stateful control
extension beside it. SSMM events explain why current state is trustworthy.
Metabolize determines what has become settled enough to enter memory.

The likely destination is one greenfield Supabase project containing two
structurally separate systems:

```text
ONE GREENFIELD SUPABASE PROJECT
├── ECB semantic-memory core
│   ├── thoughts
│   ├── match_thoughts
│   ├── semantic-memory write operations
│   └── future ECB/Open Brain MCP
└── SSMM runtime extension
    ├── ssmm_* authoritative runtime structures
    ├── guarded transactional transition functions
    └── ssmm-runtime HTTP function
```

Co-location may share infrastructure, migration discipline, security posture,
model gateway, identifiers, and provenance. It must not collapse semantic
memory and runtime authority into one table or one authority model.

## Different primary questions

The future successor to the BRAIN/OB1 `thoughts` substrate preserves standalone
semantic records, embeddings, durable lessons and decisions, people, context,
preferences, commitments, and knowledge. Its primary question is:

> What stored knowledge is relevant now?

Dedicated SSMM structures preserve authoritative phase, ordered transitions,
Shape proposals, installed Shape, Move custody, completion claims and evidence,
verification, residue, interruption, resumption, invalidation, closure,
idempotency, and concurrency state. Their primary question is:

> What is the exact authoritative position of this loop, why is that position
> valid, and what transition may legally occur next?

SSMM must not be implemented inside `thoughts`. Semantic retrieval must never
be used to infer the authoritative current SSMM state.

## Authority boundary

The model may ask, interpret, propose, explain, assist, assess evidence, and
propose Metabolize outputs. It may not independently advance authoritative loop
state.

Model output proposes. Human action authorizes where required. The transactional
controller and database establish authoritative state.

No model response, client boolean, Shortcut-supplied phase claim, or retrieved
thought may directly change the loop phase.

## Spike 1 boundary

Spike 1 does not require:

- the future thoughts table;
- the final ECB installation;
- canonical OB1 installation before runtime proof;
- generalized recursive-loop orchestration;
- or a full Integral schema.

The current runtime proof may proceed first. A dedicated remote Spike 1 project
may become the shared greenfield ECB/SSMM project only through a later explicit
promotion decision. That possibility does not make the experimental runtime
canonical now.

The exact future table names, columns, enums, and RPC decomposition remain
candidate implementation evidence rather than hard locks.

## Slice 1 commitments that must survive promotion

- strict `Sense → Shape → Move → Metabolize` ordering;
- one authoritative current phase;
- guarded transactional transitions;
- optimistic concurrency or an equivalent stale-write guard;
- idempotent client requests;
- proposal, acceptance, and installation as distinct authority states;
- human authority over Shape acceptance and installation;
- human reports separated from machine interpretations;
- Move custody across a real execution gap;
- completion evidence compared with the installed exit condition;
- Metabolize residue conditioning, but not selecting, the next Sense;
- and an append-only explanation of why current state is authoritative.

## Nested Move assistance

Slice 1 does not need a generalized recursive-loop engine.

A bounded adjustment may be represented as an ordered event sequence inside
the parent Move if it preserves the target and exit condition, cannot silently
replace the installed Shape, and explicitly returns custody to the parent.

The current Spike 1 `adjustment_subloops` table is valid implementation evidence
for testing this seam. It is not a promoted schema requirement. A dedicated
subloop table or generalized parent-child engine becomes justified only if
field evidence demonstrates a need for independent querying, lifecycle
management, or deeper recursion.

## Transactional consistency

The load-bearing backend boundary is a guarded transaction that:

1. rejects duplicate client events;
2. locks the loop or checks its expected version;
3. verifies the expected authoritative phase;
4. validates the requested transition;
5. appends the event;
6. updates the authoritative projection;
7. advances the state version;
8. returns persisted state.

Whether this becomes one generic transition function, several consequential
transition functions, or a hybrid remains open. The internal database boundary
does not establish a premature MCP vocabulary.

## Runtime and MCP boundaries

The iPhone Action Button calls a narrow `ssmm-runtime` HTTP endpoint. The
existing or future ECB/Open Brain MCP remains outside the first Slice 1 write
path.

After field behavior stabilizes, the first earned MCP extension should likely
be read-only, exposing the current phase, installed Shape, Move position,
immediate reason, exit condition, and latest Metabolize residue. Write verbs
remain deferred until ontology, authority, and field behavior stabilize.

## Memory circulation after Metabolize

SSMM runtime records do not automatically become thoughts.

Do not project raw prompts, button presses, retries, transient state, active
Move custody, temporary friction, unratified interpretations, or unverified
completion claims.

After Metabolize, selected human-confirmed durable meaning may be proposed for
semantic memory:

- durable decisions;
- confirmed lessons;
- changed commitments;
- learned constraints;
- repeated failure patterns;
- important results;
- retrieval-worthy unresolved questions;
- and human-confirmed activation findings.

Every projection should retain provenance to the originating loop and installed
Shape.

The circulation direction is:

```text
runtime event
→ Metabolize
→ human-confirmed durable meaning
→ thoughts projection
```

It is never:

```text
runtime event
→ thoughts
→ inferred authoritative state
```

## Future integrated proof

Later integration should prove:

1. SSMM maintains authority independently of semantic memory.
2. A complete loop survives the human execution gap.
3. Metabolize produces at least one settled lesson or result.
4. That settled output is deliberately projected into the future thoughts
   substrate with provenance.
5. Later semantic retrieval finds the lesson.
6. Retrieving the lesson does not substitute for reading current SSMM state
   from the authoritative runtime.

This direction remains subordinate to Spike 1 field evidence until explicitly
promoted and ratified.
