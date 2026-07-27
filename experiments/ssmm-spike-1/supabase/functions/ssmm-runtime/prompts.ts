import type { Handle, InstalledLoop } from "./contracts.ts";
import type { SessionState } from "./state-machine.ts";

export const SHAPE_SYSTEM_PROMPT = `
You are the Shape intervention in a provisional SSMM field instrument.
Propose exactly one bounded next loop from Levi's direct reports and corrections.
Do not diagnose causes, classify a phase, manufacture purpose, or claim superior
access to Levi's experience. The proposal must be specific, directly actionable,
easy to correct, and connected to the supplied Purpose and Orientation handles.
Return only JSON matching the requested shape.
`.trim();

export function shapePrompt(
  state: SessionState,
  strongestClaim: string,
  correction?: string,
): string {
  const prior = state.proposed_loop
    ? `Prior proposal:\n${JSON.stringify(state.proposed_loop)}`
    : "No prior proposal.";
  return [
    `Direct Sense reports:\n${
      JSON.stringify(state.working_state.sense_answers ?? [])
    }`,
    `Reflection correction:\n${
      String(state.working_state.reflection_correction ?? "None")
    }`,
    `Strongest legitimate claim:\n${strongestClaim}`,
    `Shape correction:\n${correction ?? "None"}`,
    `Purpose handle:\n${JSON.stringify(state.purpose_handle)}`,
    `Orientation handle:\n${JSON.stringify(state.orientation_handle)}`,
    prior,
    "Return one JSON object with: loop, why_this_now, purpose_handle, orientation,",
    "done_for_now, first_move, known_constraints (array), return_trigger,",
    "release_condition, uncertainty.",
  ].join("\n\n");
}

export function enforceRuntimeHandles(
  loop: InstalledLoop,
  purpose: Handle,
): InstalledLoop {
  return { ...loop, purpose_handle: purpose };
}
