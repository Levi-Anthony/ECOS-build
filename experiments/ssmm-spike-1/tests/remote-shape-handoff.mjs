import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const PROTOCOL_VERSION = "spike1-slice-contract-0.3";
const PROMPT_VERSION = "spike1-shape-0.3";
const FUNCTION_VERSION = "spike1-0.4.0";
const CLIENT_VERSION = "remote-shape-handoff-v0.2";

const runtimeUrl = process.env.SSMM_RUNTIME_URL;
const runtimeSecret = process.env.SSMM_RUNTIME_SHARED_SECRET;

if (!runtimeUrl || !runtimeSecret) {
  throw new Error(
    "SSMM_RUNTIME_URL and SSMM_RUNTIME_SHARED_SECRET are required for this separately gated direct remote test",
  );
}

let loopId = null;
let loopRevision = 0;

const assertVersions = (body) => {
  assert.deepEqual(body.versions, {
    protocol: PROTOCOL_VERSION,
    prompt: PROMPT_VERSION,
    function: FUNCTION_VERSION,
  });
};

const sanitizedFailure = (action, status, body) =>
  JSON.stringify({
    action,
    status,
    error: body?.error ?? "unknown_error",
    category: body?.category ?? null,
    current_loop_revision: body?.current_loop_revision ?? null,
    current_proposal_id: body?.current_proposal_id ?? null,
    current_proposal_version: body?.current_proposal_version ?? null,
  });

const invoke = async (
  action,
  input = {},
  {
    explicitLoopId = loopId,
    expectedLoopRevision = loopRevision,
    clientEventId = `remote-${action}-${randomUUID()}`,
    acceptedProposalId,
    acceptedProposalVersion,
    updateState = true,
  } = {},
) => {
  const request = {
    action,
    client_event_id: clientEventId,
    loop_id: explicitLoopId,
    expected_loop_revision: expectedLoopRevision,
    input,
    client: {
      source: "direct_test",
      shortcut_version: CLIENT_VERSION,
    },
  };

  if (acceptedProposalId !== undefined) {
    request.accepted_proposal_id = acceptedProposalId;
  }
  if (acceptedProposalVersion !== undefined) {
    request.accepted_proposal_version = acceptedProposalVersion;
  }

  const response = await fetch(runtimeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ssmm-runtime-secret": runtimeSecret,
    },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(sanitizedFailure(action, response.status, body));
  }

  assertVersions(body);
  assert.equal(typeof body.loop_id, "string");
  assert.equal(Number.isSafeInteger(body.loop_revision), true);
  assert.equal(body.loop_revision >= 0, true);

  if (updateState) {
    loopId = body.loop_id;
    loopRevision = body.loop_revision;
  }
  return body;
};

const opened = await invoke("open_current_surface", {}, {
  explicitLoopId: null,
  expectedLoopRevision: 0,
});
assert.equal(
  opened.receipt.persisted,
  true,
  "the test requires a reviewed, otherwise-empty isolated project; an existing loop is a stop condition",
);
assert.equal(opened.receipt.idempotent_replay, false);
assert.equal(opened.authoritative_phase, "sense");

await invoke("submit_sense_input", {
  grounded_input:
    "A real Spike 1 field note needs one saved paragraph. The document is available and twenty uninterrupted minutes are available.",
  present_conditions: "At the desk with the field note available",
  salient_demand:
    "Produce one real paragraph, save it, and leave the client during execution",
  field_representation: {
    target: "one saved Spike 1 field-note paragraph",
    available_time_minutes: 20,
  },
  material_constraints: [
    "the Move must survive client disconnection",
    "the proposal must remain corrigible before installation",
  ],
  uncertainties: [
    "whether remote Shape output is specific and startable enough",
  ],
  purpose_orientation_context: {
    orientation: "field evidence before generalization",
  },
});

const proposalInput = {
  sense_completion_basis:
    "The target, conditions, uncertainty, and observable exit are grounded enough for one corrigible Shape proposal.",
};
const proposalEventId = `remote-request-shape-${randomUUID()}`;
const proposalExpectedRevision = loopRevision;
const proposalLoopId = loopId;

const proposed = await invoke("request_shape_proposal", proposalInput, {
  explicitLoopId: proposalLoopId,
  expectedLoopRevision: proposalExpectedRevision,
  clientEventId: proposalEventId,
});

assert.equal(proposed.authoritative_phase, "shape");
assert.equal(proposed.state_summary.installed_shape, null);
assert.equal(
  proposed.state_summary.proposed_shape?.proposal_status,
  "proposed",
);
assert.equal(typeof proposed.state_summary.proposed_shape?.id, "string");
assert.equal(
  Number.isSafeInteger(
    proposed.state_summary.proposed_shape?.proposal_version,
  ),
  true,
);
assert.equal(proposed.receipt.persisted, true);
assert.equal(proposed.receipt.idempotent_replay, false);

const replayed = await invoke("request_shape_proposal", proposalInput, {
  explicitLoopId: proposalLoopId,
  expectedLoopRevision: proposalExpectedRevision,
  clientEventId: proposalEventId,
  updateState: false,
});

assert.equal(replayed.receipt.idempotent_replay, true);
assert.equal(replayed.receipt.persisted, true);
assert.equal(replayed.receipt.event_id, proposed.receipt.event_id);
assert.equal(replayed.loop_id, proposed.loop_id);
assert.equal(replayed.loop_revision, proposed.loop_revision);
assert.equal(
  replayed.state_summary.proposed_shape?.id,
  proposed.state_summary.proposed_shape.id,
);
assert.equal(
  replayed.state_summary.proposed_shape?.proposal_version,
  proposed.state_summary.proposed_shape.proposal_version,
);
assert.equal(replayed.state_summary.installed_shape, null);

process.stdout.write(`${
  JSON.stringify(
    {
      passed: true,
      handoff: "stop_in_shape_for_levi_review",
      loop_id: proposed.loop_id,
      loop_revision: proposed.loop_revision,
      authoritative_phase: proposed.authoritative_phase,
      proposal_id: proposed.state_summary.proposed_shape.id,
      proposal_version: proposed.state_summary.proposed_shape.proposal_version,
      receipt_event_id: proposed.receipt.event_id,
      exact_request_replay_proved: replayed.receipt.idempotent_replay,
      versions: proposed.versions,
    },
    null,
    2,
  )
}\n`);
