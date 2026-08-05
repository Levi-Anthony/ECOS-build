import {
  type Handle,
  parseRequest,
  type RuntimeRequest,
  type ShapeContent,
  type ShapeProposal,
} from "./contracts.ts";
import {
  type MainLoopState,
  surfaceForState,
  transition,
} from "./state-machine.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const assertThrows = (
  fn: () => unknown,
  message: string,
) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected error containing ${message}`);
};

const handle: Handle = {
  id: "provisional",
  label: "Provisional",
  source: "test",
  resolution: "minimal",
  expandable: true,
};

const base: MainLoopState = {
  loop_id: "00000000-0000-4000-8000-000000000001",
  loop_status: "active",
  authoritative_phase: "sense",
  current_step: "sense_entry",
  working_state: {},
  purpose_handle: handle,
  orientation_handle: handle,
  sense_state: {
    grounded_inputs: [],
    field_representation: {},
    uncertainties: [],
    material_constraints: [],
    purpose_orientation_context: {},
    sense_completion_basis: null,
    inherited_residue: null,
  },
  shape_proposals: [],
  proposed_shape: null,
  installed_shape: null,
  move_custody: null,
  active_adjustment: null,
  metabolize_state: null,
  no_active_reason: "never_started",
};

const request = (
  action: RuntimeRequest["action"],
  input: Record<string, unknown> = {},
): RuntimeRequest => ({
  action,
  client_event_id: `test-${crypto.randomUUID()}`,
  loop_id: base.loop_id,
  input,
  client: { source: "direct_test", shortcut_version: "test" },
});

const shape: ShapeContent = {
  move_target: "Write the first paragraph",
  decision: "Draft one paragraph before revisiting scope",
  orientation: "Prefer contact over abstraction",
  immediate_why: "The live obligation is the draft",
  reason_chain_handles: ["project:draft", "purpose:practice"],
  exit_condition: "One paragraph exists in the draft",
  degrees_of_freedom: ["wording", "sentence order"],
  quick_check_adjustments: ["change writing location"],
  help_required_conditions: ["the assignment changes"],
  invalidation_conditions: ["the draft is no longer required"],
  anticipated_obstacles: ["low energy"],
  completion_evidence: ["saved paragraph"],
  installation_requirements: ["open the draft"],
  first_physical_action: "Open the draft document",
  interruption_handling: "Return through the Move cockpit",
  cockpit_cues: ["show exit condition", "show immediate why"],
  uncertainty: "Energy may be lower than reported",
  purpose_handle: handle,
};

const proposal: ShapeProposal = {
  id: "00000000-0000-4000-8000-000000000002",
  proposal_version: 1,
  proposal_content: shape,
  machine_interpretation: {},
  proposal_status: "proposed",
  created_at: "2026-07-27T00:00:00Z",
};

const acceptedState = (): MainLoopState => {
  const result = transition(
    request("accept_shape_proposal", {
      declared_starting_conditions: "At the desk",
    }),
    {
      ...base,
      authoritative_phase: "shape",
      current_step: "shape_review",
      shape_proposals: [proposal],
      proposed_shape: proposal,
    },
  );
  return result.next;
};

const moveState = (): MainLoopState => {
  const recorded = transition(
    request("record_installation_action", {
      description: "Opened the draft",
      evidence: "Document visible",
    }),
    acceptedState(),
  );
  return transition(
    request("confirm_shape_installed", { conditions_satisfied: true }),
    recorded.next,
  ).next;
};

Deno.test("Action Button with no persisted loop opens Sense and creates the main loop", () => {
  const result = transition(request("open_current_surface"), {
    ...base,
    loop_id: null,
    working_state: { unpersisted: true },
  });
  assertEquals(result.events.map((event) => event.event_type), [
    "loop_created",
    "sense_started",
  ]);
  assertEquals(result.next.authoritative_phase, "sense");
});

Deno.test("Sense records grounded input without ending by prompt count", () => {
  const result = transition(
    request("submit_sense_input", {
      grounded_input: "The draft is due and I have twenty minutes.",
      material_constraints: ["twenty minutes"],
    }),
    base,
  );
  assertEquals(result.next.authoritative_phase, "sense");
  assertEquals(result.next.sense_state.grounded_inputs.length, 1);
  assertEquals(result.events.map((event) => event.event_type), [
    "sense_input_recorded",
    "sense_field_updated",
  ]);
  assertEquals(result.events[0].actor, "levi");
  assertEquals(result.events[1].actor, "runtime");
});

Deno.test("Shape requires grounded input and an explicit sufficiency basis", () => {
  assertThrows(
    () => transition(request("request_shape_proposal"), base, shape),
    "sense_completion_basis_required",
  );
});

Deno.test("generated Shape is persisted as a non-authoritative proposal", () => {
  const sensed = {
    ...base,
    sense_state: {
      ...base.sense_state,
      grounded_inputs: [{ grounded_input: "The draft is due" }],
    },
  };
  const result = transition(
    request("request_shape_proposal", {
      sense_completion_basis: "Target and constraints are grounded enough",
    }),
    sensed,
    shape,
  );
  assertEquals(result.next.authoritative_phase, "shape");
  assertEquals(result.next.proposed_shape?.proposal_status, "proposed");
  assertEquals(result.next.installed_shape, null);
});

Deno.test("proposal correction does not advance or install the parent loop", () => {
  const result = transition(
    request("correct_shape_proposal", { correction: "Make it smaller" }),
    {
      ...base,
      authoritative_phase: "shape",
      shape_proposals: [proposal],
      proposed_shape: proposal,
    },
    { ...shape, move_target: "Write one sentence" },
  );
  assertEquals(result.next.authoritative_phase, "shape");
  assertEquals(result.next.installed_shape, null);
  assertEquals(result.events[0].event_type, "shape_proposal_corrected");
});

Deno.test("regeneration supersedes the prior proposal before persisting another", () => {
  const result = transition(
    request("request_shape_proposal"),
    {
      ...base,
      authoritative_phase: "shape",
      shape_proposals: [proposal],
      proposed_shape: proposal,
    },
    { ...shape, move_target: "Write two sentences" },
  );
  assertEquals(result.next.shape_proposals[0].proposal_status, "superseded");
  assertEquals(result.next.proposed_shape?.proposal_status, "proposed");
});

Deno.test("acceptance starts installation but does not enter Move", () => {
  const result = transition(
    request("accept_shape_proposal", {
      declared_starting_conditions: "At the desk",
    }),
    {
      ...base,
      authoritative_phase: "shape",
      shape_proposals: [proposal],
      proposed_shape: proposal,
    },
  );
  assertEquals(result.next.authoritative_phase, "shape");
  assertEquals(result.next.installed_shape?.installation_status, "pending");
  assertEquals(result.events.map((event) => event.event_type), [
    "shape_proposal_accepted",
    "shape_installation_started",
  ]);
});

Deno.test("installation cannot be inferred from clarity or acceptance", () => {
  assertThrows(
    () =>
      transition(
        request("confirm_shape_installed", { conditions_satisfied: true }),
        acceptedState(),
      ),
    "installation_actions_required",
  );
});

Deno.test("Shape enters Move exactly through confirmed installation", () => {
  const recorded = transition(
    request("record_installation_action", {
      description: "Opened the draft",
      evidence: "Document visible",
    }),
    acceptedState(),
  );
  const result = transition(
    request("confirm_shape_installed", { conditions_satisfied: true }),
    recorded.next,
  );
  assertEquals(result.next.authoritative_phase, "move");
  assertEquals(result.next.move_custody?.move_position, "not_started");
  assertEquals(result.events.map((event) => event.event_type), [
    "shape_installed",
    "parent_entered_move",
  ]);
});

Deno.test("small Move exception remains explicit", () => {
  const accepted = transition(
    request("accept_shape_proposal", {
      small_move_exception: true,
      declared_starting_conditions: "Already at the threshold",
    }),
    {
      ...base,
      authoritative_phase: "shape",
      shape_proposals: [proposal],
      proposed_shape: proposal,
    },
  ).next;
  const result = transition(
    request("confirm_shape_installed", { conditions_satisfied: true }),
    accepted,
  );
  assertEquals(result.next.installed_shape?.small_move_exception, true);
  assertEquals(result.next.authoritative_phase, "move");
});

Deno.test("Action Button during Move opens the authoritative Move cockpit", () => {
  const state = moveState();
  const result = transition(request("open_current_surface"), state);
  assertEquals(result.next.authoritative_phase, "move");
  assertEquals(result.interaction.kind, "cockpit");
  assert(
    result.interaction.prompt.includes(shape.exit_condition),
    "exit missing",
  );
  assert(
    result.interaction.prompt.includes(shape.immediate_why),
    "reason missing",
  );
});

Deno.test("Move position changes do not change the parent phase", () => {
  const result = transition(
    request("record_move_progress", {
      progress: { note: "Two sentences exist" },
      move_position: "active",
    }),
    moveState(),
  );
  assertEquals(result.next.authoritative_phase, "move");
  assertEquals(result.next.move_custody?.move_position, "active");
});

Deno.test("bounded assistance uses a nested subloop while parent remains Move", () => {
  const result = transition(
    request("request_move_help", {
      reported_change: "The desk became unavailable",
      adjustment_boundary: "Location may change; target and exit stay fixed",
      adjustment_shape: "Move to the kitchen and reopen the same draft",
    }),
    moveState(),
  );
  assertEquals(result.next.authoritative_phase, "move");
  assertEquals(result.next.active_adjustment?.parent_phase, "move");
  assertEquals(result.events.map((event) => event.event_type), [
    "move_friction_reported",
    "nested_adjustment_started",
    "nested_adjustment_shaped",
  ]);
});

Deno.test("nested adjustment Metabolizes and restores the same parent Move", () => {
  const helped = transition(
    request("request_move_help", {
      reported_change: "The desk became unavailable",
      adjustment_boundary: "Location may change; target and exit stay fixed",
      adjustment_shape: "Move to the kitchen and reopen the same draft",
    }),
    moveState(),
  ).next;
  const result = transition(
    request("record_move_progress", {
      progress: { note: "Draft reopened in kitchen" },
      move_position: "active",
      nested_result: "The location change restored execution",
      effect_on_parent: "Parent Move is active under the same Shape",
    }),
    helped,
  );
  assertEquals(result.next.authoritative_phase, "move");
  assertEquals(result.next.active_adjustment?.nested_phase, "closed");
  assertEquals(result.events.slice(-3).map((event) => event.event_type), [
    "nested_adjustment_executed",
    "nested_adjustment_metabolized",
    "parent_move_restored",
  ]);
});

Deno.test("material invalidation goes forward to Metabolize, never back to Shape", () => {
  const reported = transition(
    request("report_changed_conditions", {
      changed: "The assignment was canceled",
    }),
    moveState(),
  ).next;
  const result = transition(
    request("classify_change", {
      classification: "material_invalidation",
      basis: "The target no longer exists",
    }),
    reported,
  );
  assertEquals(result.next.authoritative_phase, "metabolize");
  assertEquals(result.next.metabolize_state?.move_disposition, "invalidated");
  assertEquals(result.events.at(-1)?.event_type, "parent_entered_metabolize");
});

Deno.test("completion claim enters Metabolize without becoming verification", () => {
  const result = transition(
    request("claim_completion", {
      claim_statement: "I finished the paragraph",
      claimed_result: "One paragraph exists",
      evidence: [{ kind: "document", value: "draft" }],
    }),
    moveState(),
  );
  assertEquals(result.next.authoritative_phase, "metabolize");
  assertEquals(result.next.metabolize_state?.verification_result, null);
  assertEquals(result.events[0].event_type, "move_completion_claimed");
});

Deno.test("verification is a distinct persisted assessment", () => {
  const claimed = transition(
    request("claim_completion", {
      claim_statement: "I finished",
      claimed_result: "One paragraph exists",
    }),
    moveState(),
  ).next;
  const result = transition(
    request("submit_metabolize_input", {
      verification_result: "partially_verified",
      verification_assessment: {
        method: "compared supplied text with exit condition",
      },
      credited_result: "Paragraph exists; save state uncertain",
      consequences: [],
      lessons: ["Evidence requirement should name save state"],
      closure_basis: "Partial evidence",
    }),
    claimed,
  );
  assertEquals(
    result.next.metabolize_state?.verification_result,
    "partially_verified",
  );
  assertEquals(
    result.events.at(-1)?.event_type,
    "completion_partially_verified",
  );
});

Deno.test("conditioned residue closes the loop without selecting a next Move", () => {
  const claimed = transition(
    request("claim_completion", {
      claim_statement: "I finished",
      claimed_result: "One paragraph exists",
    }),
    moveState(),
  ).next;
  const metabolized = transition(
    request("submit_metabolize_input", {
      verification_result: "cannot_verify",
      credited_result: "A completion claim exists",
      closure_basis: "External verification unavailable",
    }),
    claimed,
  ).next;
  const residue = transition(
    request("confirm_residue", {
      residue: {
        what_landed: "A paragraph was reportedly written",
        what_remains_alive: "Verification is unavailable",
      },
    }),
    metabolized,
  ).next;
  const result = transition(request("close_loop"), residue);
  assertEquals(result.next.loop_status, "closed");
  assertEquals(result.events[0].event_type, "loop_closed");
  assertEquals(Object.hasOwn(result.next, "next_move"), false);
});

Deno.test("a fresh Sense encounters residue as field evidence, not a selected Move", () => {
  const residue = {
    what_landed: "A paragraph was written",
    what_remains_unresolved: "Its save state should be checked",
  };
  const state: MainLoopState = {
    ...base,
    loop_id: null,
    sense_state: {
      ...base.sense_state,
      inherited_residue: residue,
    },
    no_active_reason: "last_loop_closed:completed",
  };
  const result = transition(request("open_current_surface"), state);
  assertEquals(result.next.authoritative_phase, "sense");
  assertEquals(result.next.sense_state.inherited_residue, residue);
  assert(
    result.interaction.prompt.includes("changed field evidence"),
    "residue boundary missing",
  );
  assert(
    result.interaction.prompt.includes("not as a preselected Move"),
    "fresh Sense was not protected from Move selection",
  );
});

Deno.test("unknown authority opens recovery rather than a new loop", () => {
  const state = {
    ...moveState(),
    loop_status: "unknown" as const,
    authoritative_phase: "unknown" as const,
    current_step: "recovery",
  };
  const surface = surfaceForState(state);
  assertEquals(surface.interaction.kind, "recovery");
  assertEquals(surface.available_actions, ["recover_authoritative_state"]);
});

Deno.test("wire contract rejects obsolete installation boolean", () => {
  assertThrows(
    () =>
      parseRequest(request("accept_shape_proposal", {
        install: true,
      })),
    "obsolete_install_flag",
  );
});
