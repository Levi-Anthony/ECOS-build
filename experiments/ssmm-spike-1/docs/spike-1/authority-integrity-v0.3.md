# SSMM Spike 1 Authority Integrity v0.3

Status: implementation contract for the first bounded remediation change set.

This amendment changes only three authority seams:

1. acceptance binds to the exact reviewed proposal;
2. every state mutation is revisioned and rejected when computed from stale state;
3. an idempotency identity replays only the same canonical semantic request.

It does not add the named Shape level, revise verification or terminal semantics,
redesign recovery, create the iOS Shortcut, or authorize remote deployment.

## Loop revision

`ssmm_spike1.main_loops.authoritative_revision` is a non-negative monotonic
integer. A newly persisted loop begins at revision `1`. Every successful state
mutation increments the revision exactly once in the same transaction as its
events and projections. Rejected requests and read-only restoration do not
increment it.

Every mutating runtime request supplies `expected_loop_revision`. The database
locks the focal loop row and compares the supplied value with the current value
before applying events or projections. A mismatch produces
`stale_loop_revision` and rolls back without mutation.

## Proposal-bound acceptance and installation

The following actions carry both `accepted_proposal_id` and
`accepted_proposal_version`:

- `accept_shape_proposal`
- `record_installation_action`
- `confirm_shape_installed`

For acceptance, the database verifies under the loop-row lock that the named
proposal is the current proposal with status `proposed` and the supplied version
matches its immutable version. For installation actions and confirmation, the
database verifies that the installed projection is bound to the same accepted
proposal and version and that the proposal remains `accepted`.

Proposal IDs, versions, content, machine interpretation, loop identity, and
creation timestamps are immutable after insertion. Status may change through
the runtime path.

## Canonical request fingerprint

The Edge Function constructs this canonical JSON document:

```json
{
  "accepted_proposal_id": "uuid-or-null",
  "accepted_proposal_version": 1,
  "action": "action-name",
  "client": {
    "shortcut_version": "client-version",
    "source": "direct_test-or-ios_action_button"
  },
  "expected_loop_revision": 4,
  "input": {},
  "loop_id": "uuid-or-null",
  "protocol_version": "spike1-slice-contract-0.3"
}
```

Canonicalization is deterministic:

1. recursively sort every object key lexicographically;
2. preserve array order;
3. preserve JSON scalar values;
4. serialize once with `JSON.stringify` and no additional whitespace;
5. compute lowercase hexadecimal SHA-256 over the UTF-8 serialization.

The database receives the canonical JSON, exact canonical text, and digest. It
verifies that the text parses to the same JSON and that the digest matches the
text before consulting or writing the request ledger.

`ssmm_spike1.runtime_requests` stores the event ID, semantic request document,
canonical text, digest, expected revision, proposal identity, resulting
revision, and original persistence response.

When a client event ID already exists:

- the same canonical document and digest return the original persistence
  response with `idempotent_replay: true`;
- any different action, payload, loop, expected revision, proposal identity,
  protocol, or client identity produces `idempotency_fingerprint_conflict`;
- neither case writes a new event, projection, request record, or revision.

## Conflict response

The Edge Function maps database conflicts to HTTP 409 without exposing raw
PostgreSQL or provider errors:

```json
{
  "error": "conflict",
  "category": "stale_loop_revision",
  "current_loop_revision": 5
}
```

`category` is one of:

- `stale_loop_revision`
- `stale_proposal`
- `idempotency_fingerprint_conflict`

A stale-proposal response may additionally include the current eligible
proposal ID and version.

## Read-only restoration

`open_current_surface` is read-only when a persisted focal loop exists. It may
omit `expected_loop_revision`, returns the current `loop_revision`, sets
`receipt.persisted` to `false`, supplies no event ID, and does not increment the
revision. Opening the first loop remains a persisted creation mutation and
returns revision `1`.

## Transaction order

For a new mutation, `apply_runtime_events` performs this sequence:

1. validate the canonical request and SHA-256 digest;
2. serialize use of the client event ID and check the semantic request ledger;
3. lock the focal loop row;
4. compare the current and expected loop revisions;
5. validate proposal identity for proposal-bound actions;
6. apply events and projections through the existing bounded persistence core;
7. increment the loop revision exactly once;
8. rebuild the returned state with the new revision;
9. persist the semantic request ledger and original response;
10. commit atomically.

Any conflict occurs before step 6 and leaves all authority-bearing tables
unchanged.
