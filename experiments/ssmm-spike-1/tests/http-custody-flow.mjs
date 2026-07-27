import { randomUUID } from "node:crypto";

const baseUrl = process.env.SSMM_RUNTIME_URL ??
  "http://127.0.0.1:55421/functions/v1/ssmm-runtime";
const secret = process.env.SSMM_RUNTIME_SHARED_SECRET;

if (!secret) {
  throw new Error("SSMM_RUNTIME_SHARED_SECRET is required");
}

let loopId = null;
const transcript = [];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const invoke = async (action, input = {}, explicitLoopId = loopId) => {
  const clientEventId = `http-${action}-${randomUUID()}`;
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ssmm-runtime-secret": secret,
    },
    body: JSON.stringify({
      action,
      client_event_id: clientEventId,
      loop_id: explicitLoopId,
      input,
      client: {
        source: "direct_test",
        shortcut_version: "http-custody-flow-v0.2",
      },
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `${action} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  loopId = body.loop_id;
  transcript.push({
    action,
    loop_id: body.loop_id,
    phase: body.authoritative_phase,
    step: body.state_summary.current_step,
    move_position: body.state_summary.move_position,
    interaction_kind: body.interaction.kind,
    event_id: body.receipt.event_id,
  });
  return body;
};

const opened = await invoke("open_current_surface", {}, null);
assert(opened.authoritative_phase === "sense", "expected Sense entry");

await invoke("submit_sense_input", {
  grounded_input:
    "The field note is due now; the document is available and there are twenty uninterrupted minutes.",
  present_conditions: "At the desk with the repository open",
  salient_demand: "Produce a real paragraph and leave the client",
  field_representation: {
    target: "one saved field-note paragraph",
    available_time_minutes: 20,
  },
  material_constraints: ["must survive client disconnection"],
  uncertainties: ["whether the cockpit restores enough context"],
  purpose_orientation_context: {
    orientation: "field evidence before generalization",
  },
});

const proposed = await invoke("request_shape_proposal", {
  sense_completion_basis:
    "The target, available conditions, uncertainty, and observable exit are grounded enough for a corrigible Shape attempt.",
});
assert(proposed.authoritative_phase === "shape", "proposal must enter Shape");
assert(
  proposed.state_summary.proposed_shape?.proposal_status === "proposed",
  "generated proposal became authoritative",
);
assert(
  proposed.state_summary.installed_shape === null,
  "proposal was installed before acceptance",
);

const corrected = await invoke("correct_shape_proposal", {
  correction: "Make the evidence explicitly mention the saved file",
});
assert(
  corrected.state_summary.proposed_shape?.proposal_content?.completion_evidence
    ?.includes("the saved field-note paragraph"),
  "proposal correction was not persisted",
);
assert(
  corrected.state_summary.proposed_shape?.proposal_content?.purpose_handle
    ?.id !== "provider-invented-purpose",
  "provider invented the authoritative Purpose handle",
);

const accepted = await invoke("accept_shape_proposal", {
  declared_starting_conditions: "Field note open at the writing cursor",
});
assert(accepted.authoritative_phase === "shape", "acceptance advanced to Move");
assert(
  accepted.state_summary.installed_shape?.installation_status === "pending",
  "acceptance did not start explicit installation",
);

await invoke("record_installation_action", {
  description: "Opened the Spike 1 field note at the writing cursor",
  evidence: "Document visible and editable",
});

const installed = await invoke("confirm_shape_installed", {
  conditions_satisfied: true,
});
assert(
  installed.authoritative_phase === "move",
  "installation did not enter Move",
);
assert(
  installed.state_summary.installed_shape?.installation_status === "installed",
  "authoritative Shape was not installed",
);

const moveLoopId = loopId;

// This is the execution-gap seam: a new request with only persisted authority.
const restored = await invoke("open_current_surface", {}, moveLoopId);
assert(restored.authoritative_phase === "move", "return did not restore Move");
assert(restored.interaction.kind === "cockpit", "return did not open cockpit");
assert(
  restored.interaction.prompt.includes(
    "One complete paragraph exists in the saved Spike 1 field note",
  ),
  "cockpit lost the installed exit condition",
);
assert(
  restored.interaction.prompt.includes(
    "A real written result is needed to test custody across the gap",
  ),
  "cockpit lost the installed rationale",
);

const helped = await invoke("request_move_help", {
  reported_change: "The desk became unavailable",
  adjustment_boundary:
    "Location may change; target, reason, orientation, and exit condition remain fixed",
  adjustment_shape: "Move to the kitchen and reopen the same field note",
});
assert(
  helped.authoritative_phase === "move",
  "bounded help displaced parent Move",
);
assert(
  helped.state_summary.active_adjustment?.parent_loop_id === moveLoopId,
  "nested assistance lost its parent reference",
);

const resumed = await invoke("record_move_progress", {
  progress: { note: "The field note is open in the kitchen" },
  move_position: "active",
  nested_result: "The location adjustment restored execution",
  effect_on_parent: "The same parent Move is active under the installed Shape",
});
assert(
  resumed.authoritative_phase === "move",
  "nested result changed parent phase",
);
assert(
  resumed.state_summary.active_adjustment?.nested_phase === "closed",
  "nested assistance did not Metabolize",
);

const claimed = await invoke("claim_completion", {
  claim_statement: "I wrote and saved the paragraph",
  claimed_result: "One complete paragraph exists in the saved field note",
});
assert(
  claimed.state_summary.metabolize_state?.verification_result === null,
  "completion claim was silently treated as verification",
);

await invoke("submit_completion_evidence", {
  evidence: {
    kind: "saved_file_observation",
    value: "Spike 1 field note contains one paragraph",
  },
});

const assessed = await invoke("submit_metabolize_input", {
  verification_result: "partially_verified",
  verification_assessment: {
    method:
      "compared supplied saved-file observation with installed exit condition",
    limitation: "the runtime did not independently inspect the file",
  },
  credited_result: "A saved paragraph is reported and located",
  consequences: [
    "the execution gap was traversed without changing the parent Move",
  ],
  lessons: ["cockpit restoration retained the decisive context"],
  closure_basis:
    "claim plus located evidence, with external verification limitation",
});
assert(
  assessed.state_summary.metabolize_state?.verification_result ===
    "partially_verified",
  "verification was not stored separately",
);

const residue = {
  what_landed: "A saved paragraph and a custody-path transcript",
  what_changed: "Move-cockpit restoration now has local HTTP evidence",
  what_remains_unresolved: "real iOS and human-time field evidence",
  directional_weight: "test the same seam through the Action Button",
};
await invoke("confirm_residue", { residue });
const closed = await invoke("close_loop");
assert(closed.loop_status === "closed", "completed loop did not close");

const freshSense = await invoke("open_current_surface", {}, null);
assert(freshSense.loop_id !== moveLoopId, "fresh Sense reused the closed loop");
assert(
  freshSense.authoritative_phase === "sense",
  "fresh loop did not open Sense",
);
assert(
  freshSense.state_summary.inherited_residue?.what_landed ===
      residue.what_landed &&
    freshSense.state_summary.inherited_residue?.what_changed ===
      residue.what_changed &&
    freshSense.state_summary.inherited_residue?.what_remains_unresolved ===
      residue.what_remains_unresolved &&
    freshSense.state_summary.inherited_residue?.directional_weight ===
      residue.directional_weight,
  "fresh Sense did not inherit conditioned residue",
);
assert(
  freshSense.interaction.prompt.includes("not as a preselected Move"),
  "fresh Sense did not preserve the residue boundary",
);

process.stdout.write(JSON.stringify(
  {
    passed: true,
    old_loop_id: moveLoopId,
    new_loop_id: freshSense.loop_id,
    transitions: transcript,
    assertions: {
      proposal_non_authoritative: true,
      acceptance_not_installation: true,
      move_restored_after_new_request: true,
      bounded_adjustment_preserved_parent: true,
      claim_distinct_from_verification: true,
      residue_inherited_without_selected_move: true,
    },
  },
  null,
  2,
));
process.stdout.write("\n");
