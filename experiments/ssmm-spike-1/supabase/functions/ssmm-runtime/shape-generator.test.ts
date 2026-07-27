import type { Handle, ShapeContent } from "./contracts.ts";
import { generateShape } from "./shape-generator.ts";
import type { MainLoopState } from "./state-machine.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const handle: Handle = {
  id: "runtime-purpose",
  label: "Runtime Purpose",
  source: "test",
  resolution: "minimal",
  expandable: true,
};

const state: MainLoopState = {
  loop_id: null,
  loop_status: "active",
  authoritative_phase: "sense",
  current_step: "sense_grounding",
  working_state: {},
  purpose_handle: handle,
  orientation_handle: handle,
  sense_state: {
    grounded_inputs: [{ grounded_input: "The draft is due" }],
    field_representation: { demand: "draft" },
    uncertainties: [],
    material_constraints: ["20 minutes"],
    purpose_orientation_context: {},
    sense_completion_basis: "Enough to attempt Shape",
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

const providerShape: ShapeContent = {
  move_target: "Write one paragraph",
  decision: "Write before rescoping",
  orientation: "Prefer contact over abstraction",
  immediate_why: "The draft is live",
  reason_chain_handles: ["project:draft"],
  exit_condition: "One paragraph exists",
  degrees_of_freedom: ["wording"],
  quick_check_adjustments: ["location"],
  help_required_conditions: ["assignment changes"],
  invalidation_conditions: ["draft canceled"],
  anticipated_obstacles: ["fatigue"],
  completion_evidence: ["saved paragraph"],
  installation_requirements: ["open draft"],
  first_physical_action: "Open the draft",
  interruption_handling: "Return through the cockpit",
  cockpit_cues: ["show exit condition"],
  uncertainty: "Energy is unknown",
  purpose_handle: { ...handle, id: "provider-invented" },
};

Deno.test("Shape provider output is validated and runtime Purpose wins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(providerShape) } }],
        }),
        { status: 200 },
      ),
    )) as typeof fetch;
  try {
    const result = await generateShape({
      endpoint: "https://provider.invalid",
      apiKey: "test",
      model: "test",
    }, state);
    assertEquals(result.move_target, providerShape.move_target);
    assertEquals(result.purpose_handle.id, handle.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Shape provider output missing an operating boundary is rejected", async () => {
  const originalFetch = globalThis.fetch;
  const invalid = { ...providerShape } as Record<string, unknown>;
  delete invalid.invalidation_conditions;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(invalid) } }],
        }),
        { status: 200 },
      ),
    )) as typeof fetch;
  try {
    let thrown = false;
    try {
      await generateShape({
        endpoint: "https://provider.invalid",
        apiKey: "test",
        model: "test",
      }, state);
    } catch (error) {
      thrown = error instanceof Error &&
        error.message.includes("invalid_shape_invalidation_conditions");
    }
    assertEquals(thrown, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
