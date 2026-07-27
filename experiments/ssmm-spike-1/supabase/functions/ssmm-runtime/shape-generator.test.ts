import type { Handle, InstalledLoop } from "./contracts.ts";
import { generateShape } from "./shape-generator.ts";
import type { SessionState } from "./state-machine.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("Shape generator validates output and restores runtime Purpose authority", async () => {
  const purpose: Handle = {
    id: "runtime-purpose",
    label: "Runtime Purpose",
    source: "test",
    resolution: "minimal",
    expandable: true,
  };
  const state: SessionState = {
    status: "active",
    current_step: "shape",
    working_state: { sense_answers: ["The draft is due."] },
    purpose_handle: purpose,
    orientation_handle: purpose,
    proposed_loop: null,
    active_loop: null,
    return_trigger: null,
  };
  const providerLoop: InstalledLoop = {
    loop: "Open the draft",
    why_this_now: "It has the strongest legitimate claim",
    purpose_handle: { ...purpose, id: "provider-invented" },
    orientation: "Prefer contact over abstraction",
    done_for_now: "The draft is open",
    first_move: "Tap the draft file",
    known_constraints: ["Low energy"],
    return_trigger: "After opening the file",
    release_condition: "The obligation is invalidated",
    uncertainty: "Whether writing is possible immediately",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(providerLoop) } }],
        }),
        { status: 200 },
      ),
    );
  try {
    const generated = await generateShape(
      { endpoint: "https://shape.invalid", apiKey: "test", model: "test" },
      state,
      "The draft",
    );
    assert(generated.loop === providerLoop.loop, "valid loop was not returned");
    assert(
      generated.purpose_handle.id === purpose.id,
      "provider was allowed to manufacture Purpose authority",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
