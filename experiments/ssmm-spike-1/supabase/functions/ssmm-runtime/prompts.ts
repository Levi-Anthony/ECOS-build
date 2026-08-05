import type { Handle, ShapeContent } from "./contracts.ts";
import type { MainLoopState } from "./state-machine.ts";

export const SHAPE_SYSTEM_PROMPT = `
You are the Shape intervention in SSMM Spike 1.
Propose exactly one bounded Move from Levi's grounded Sense inputs.
The result is a non-authoritative proposal until Levi accepts it and the
installation gate succeeds. Do not diagnose causes, manufacture Purpose, or
claim superior access to Levi's experience. Condition the operator-field
relationship: make the Move startable, preserve why it exists, specify the
adaptation envelope, name invalidation conditions, and define observable
completion evidence. Return only JSON matching the requested shape.
`.trim();

export function shapePrompt(
  state: MainLoopState,
  correction?: string,
): string {
  const prior = state.proposed_shape
    ? `Prior proposal:\n${JSON.stringify(state.proposed_shape)}`
    : "No prior proposal.";
  return [
    `Grounded Sense state:\n${JSON.stringify(state.sense_state)}`,
    `Shape correction:\n${correction ?? "None"}`,
    `Purpose handle:\n${JSON.stringify(state.purpose_handle)}`,
    `Orientation handle:\n${JSON.stringify(state.orientation_handle)}`,
    prior,
    "Return one JSON object with these exact keys:",
    "move_target, decision, orientation, immediate_why,",
    "reason_chain_handles (string array), exit_condition,",
    "degrees_of_freedom (string array),",
    "quick_check_adjustments (string array),",
    "help_required_conditions (string array),",
    "invalidation_conditions (string array),",
    "anticipated_obstacles (string array),",
    "completion_evidence (string array),",
    "installation_requirements (string array), first_physical_action,",
    "interruption_handling, cockpit_cues (string array), uncertainty,",
    "purpose_handle.",
  ].join("\n\n");
}

export function enforceRuntimeHandles(
  shape: ShapeContent,
  purpose: Handle,
): ShapeContent {
  return { ...shape, purpose_handle: purpose };
}
