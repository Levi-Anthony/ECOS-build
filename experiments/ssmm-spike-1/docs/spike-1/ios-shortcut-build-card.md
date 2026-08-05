# Spike 1 iOS Shortcut Build Card

Status: transport and interaction design card only; authentication review and
Shortcut construction remain closed gates

This card reconciles the iOS adapter to protocol `spike1-slice-contract-0.3`,
Shape prompt `spike1-shape-0.3`, and function `spike1-0.4.0`. It does not
authorize building, installing, sharing, or binding a Shortcut.

## Gate 0 — client authentication is unresolved

The verified runtime currently accepts a static `x-ssmm-runtime-secret` header
for direct tests. A private runtime secret must **not** be placed in a Shortcut
field, header, variable, Dictionary, exported shortcut, or other iPhone-visible
storage. The final Shortcut authentication architecture is a separate Levi
decision and may require a reviewed runtime change before this card is
buildable.

The approved design must provide all of these security properties:

- no service-role key, provider key, or long-lived shared runtime secret on the
  phone;
- a bounded, revocable client capability with explicit client/device scope;
- expiry and rotation behavior, plus replay protection appropriate to the chosen
  credential;
- server-side authorization and denial paths that do not trust Shortcut input;
- sanitized, distinguishable authentication error codes without secret values;
- no credential values in Git, Shortcut exports, screenshots, logs, or Site
  Packets.

Do not add an authorization header placeholder that invites a human to paste a
secret. Stop until Levi reviews a concrete authentication proposal and issues a
new capability receipt for the selected design and any required implementation.

## Part A — future `SSMM Request` transport boundary

This section specifies the request semantics to preserve after the
authentication gate opens.

### Input Dictionary

Accept:

- `action`;
- `loop_id` or null;
- `expected_loop_revision` when required below;
- `accepted_proposal_id` and `accepted_proposal_version` only for the three
  proposal-bound actions below;
- `input` Dictionary;
- optional retained `client_event_id` for a deliberate exact replay.

### Request envelope

Create one `client_event_id` for one intended action. Keep that ID and the exact
serialized request together until the response is known. A retry is an exact
replay only when the ID and every semantic field are unchanged.

```json
{
  "action": "<runtime action>",
  "client_event_id": "ios-<unique action identifier>",
  "loop_id": "<authoritative loop UUID or null>",
  "expected_loop_revision": 0,
  "input": {},
  "client": {
    "source": "ios_action_button",
    "shortcut_version": "spike1-0.2"
  }
}
```

Revision rules:

1. To create the first loop in a reviewed empty isolated project, call
   `open_current_surface` with `loop_id: null` and `expected_loop_revision: 0`.
2. A read-only `open_current_surface` for an existing loop may omit the expected
   revision. Retain the returned `loop_id` and `loop_revision`.
3. Every later mutation must send the most recently returned `loop_revision` as
   top-level `expected_loop_revision`.
4. After each successful response, replace the retained revision with its
   returned `loop_revision` before constructing a new mutation.
5. A `409 stale_loop_revision` is a stop-and-refresh result, never permission to
   silently resubmit the intended mutation against a new revision.

Proposal-identity rules:

- `accept_shape_proposal`, `record_installation_action`, and
  `confirm_shape_installed` must include top-level `accepted_proposal_id` and
  positive-integer `accepted_proposal_version` from the authoritative response.
- Those fields are forbidden for every other action.
- Before acceptance, read the identity from `state_summary.proposed_shape.id`
  and `.proposal_version`. After acceptance, use the identity returned in the
  installed-Shape state: `state_summary.installed_shape.accepted_proposal_id`
  and `.shape_version`. Send those as `accepted_proposal_id` and
  `accepted_proposal_version`; do not infer or increment either value locally.
- A `409 stale_proposal` is a stop-and-refresh result. Do not substitute a newer
  proposal automatically.

### Future request action

When authentication has been separately approved, use **Get Contents of URL**
with the reviewed isolated-project URL, method `POST`, JSON request body, and
only the headers produced by the reviewed authentication adapter. The current
static direct-test header is not a Shortcut design.

Return the response Dictionary without copying credentials into output or logs.
Show only sanitized `error`, `category`, current revision, and current proposal
identity when present. In particular:

- `401`: stop; authentication is absent or invalid;
- `409 stale_loop_revision`: reopen the authoritative surface and ask Levi what
  to do;
- `409 stale_proposal`: show the current proposal identity and ask Levi;
- `409 idempotency_fingerprint_conflict`: stop; the retained ID no longer
  matches the request body;
- any other non-success response: stop and preserve a redacted receipt.

## Part B — future `SSMM` human surface

Each invocation performs at most one authoritative mutation and then exits.

### Open

1. Call `open_current_surface` under the revision rules above.
2. Verify response versions are exactly protocol `spike1-slice-contract-0.3`,
   prompt `spike1-shape-0.3`, and function `spike1-0.4.0`.
3. Retain `loop_id`, `loop_revision`, authoritative phase, proposed or installed
   proposal identity, `available_actions`, prompt, and receipt.
4. Show the runtime prompt. Never infer phase or available actions locally.

### Friendly action menu

Show a choice only when its runtime action appears in `available_actions`.

| Friendly label           | Runtime action                | Required input                                                |
| ------------------------ | ----------------------------- | ------------------------------------------------------------- |
| Ground what is happening | `submit_sense_input`          | `grounded_input`, `present_conditions`, `salient_demand`      |
| Ask for a Shape          | `request_shape_proposal`      | `sense_completion_basis`                                      |
| Correct this Shape       | `correct_shape_proposal`      | `correction`                                                  |
| Reject this Shape        | `reject_shape_proposal`       | optional `reason`                                             |
| Accept proposal          | `accept_shape_proposal`       | proposal identity; `declared_starting_conditions`             |
| Record installation      | `record_installation_action`  | proposal identity; `description`, optional `evidence`         |
| Confirm installed        | `confirm_shape_installed`     | proposal identity; `conditions_satisfied` or `waiver`         |
| Record progress          | `record_move_progress`        | `progress.note`, `move_position`                              |
| Get bounded help         | `request_move_help`           | `reported_change`, `adjustment_boundary`, `adjustment_shape`  |
| Record interruption      | `record_move_interruption`    | `reason`, optional `position`                                 |
| Resume Move              | `resume_move`                 | none                                                          |
| Conditions changed       | `report_changed_conditions`   | `changed_conditions`                                          |
| Classify change          | `classify_change`             | `classification`, plus bounded fields when applicable         |
| Claim completion         | `claim_completion`            | `claim_statement`, `claimed_result`, optional `qualification` |
| Add evidence             | `submit_completion_evidence`  | `evidence.kind`, `evidence.value`                             |
| Release Move             | `release_move`                | `reason`                                                      |
| Abandon Move             | `abandon_move`                | `reason`                                                      |
| Metabolize               | `submit_metabolize_input`     | verification and consequence fields                           |
| Confirm residue          | `confirm_residue`             | non-empty `residue` Dictionary                                |
| Close loop               | `close_loop`                  | none                                                          |
| Recover authority        | `recover_authoritative_state` | recovery decision and basis                                   |
| Leave and execute        | local exit only               | no runtime request                                            |

After the selected action, show the authoritative phase, current step, prompt,
new `loop_revision`, receipt event ID, and replay flag, then exit. A later
Action Button press must restore state from the runtime, not from stale Shortcut
variables.

## Part C — review seams

The build order is deliberately gated:

1. Levi reviews the local Site Packet before any linked or remote operation.
2. Remote authority proof completes in the isolated project.
3. Levi selects a reviewed Shortcut authentication architecture and authorizes
   any runtime or adapter work it requires.
4. Only then may a separate receipt authorize manual Shortcut construction.
5. Action Button binding requires a later review after transport, denial-path,
   replay, and incorrect-project tests pass.

This card does not authorize any of those later stages.
