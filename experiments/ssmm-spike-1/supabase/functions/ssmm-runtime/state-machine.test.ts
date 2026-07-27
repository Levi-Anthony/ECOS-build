import {
  type Handle,
  type InstalledLoop,
  parseRequest,
  type RuntimeRequest,
} from "./contracts.ts";
import { type SessionState, transition } from "./state-machine.ts";

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
};

const assertThrows = (
  fn: () => unknown,
  errorType: typeof Error,
  message: string,
) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof errorType && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`Expected ${errorType.name} containing ${message}`);
};

const handle: Handle = {
  id: "provisional",
  label: "Provisional",
  source: "test",
  resolution: "minimal",
  expandable: true,
};

const base: SessionState = {
  status: "active",
  current_step: "start",
  working_state: {},
  purpose_handle: handle,
  orientation_handle: handle,
  proposed_loop: null,
  active_loop: null,
  return_trigger: null,
};

const request = (
  action: RuntimeRequest["action"],
  input: Record<string, unknown> = {},
): RuntimeRequest => ({
  action,
  client_event_id: crypto.randomUUID(),
  session_id: null,
  input,
  client: { source: "direct_test", shortcut_version: "test" },
});

const loop: InstalledLoop = {
  loop: "Write the first paragraph",
  why_this_now: "It is the live obligation",
  purpose_handle: handle,
  orientation: "Prefer contact over abstraction",
  done_for_now: "One paragraph exists",
  first_move: "Open the draft",
  known_constraints: ["20 minutes"],
  return_trigger: "After the paragraph or 20 minutes",
  release_condition: "The obligation is invalidated",
  uncertainty: "Energy may be lower than reported",
};

Deno.test("start asks one bounded Sense question", () => {
  const result = transition(request("start_or_resume"), base);
  assertEquals(result.next.current_step, "sense_arrival");
  assertEquals(result.interaction.kind, "question");
  assertEquals(result.available_actions.includes("submit_answer"), true);
});

Deno.test("Sense answer and runtime reflection are separate authority events", () => {
  const result = transition(
    request("submit_answer", { answer: "I am tired and the draft is due." }),
    { ...base, current_step: "sense_arrival" },
  );
  assertEquals(result.events.map((event) => event.event_type), [
    "sense_answered",
    "field_reflected",
  ]);
  assertEquals(result.events[0].actor, "levi");
  assertEquals(result.events[0].perspective, "ul_levi_report");
  assertEquals(result.events[1].actor, "runtime");
  assertEquals(result.events[1].perspective, "proposal");
  assertEquals(result.correction_action, "correct_reflection");
});

Deno.test("reflection correction routes to runtime Shape proposal", () => {
  const result = transition(
    request("correct_reflection", { answer: "The deadline is not real." }),
    { ...base, current_step: "field_reflection" },
  );
  assertEquals(result.available_actions.includes("propose_shape"), true);
  assertEquals(result.available_actions.includes("accept_shape"), false);
});

Deno.test("runtime-generated Shape becomes a proposal, not an active loop", () => {
  const result = transition(
    request("propose_shape", { answer: "The draft has the strongest claim." }),
    { ...base, current_step: "shape" },
    loop,
  );
  assertEquals(result.events.map((event) => event.event_type), [
    "sense_answered",
    "shape_proposed",
  ]);
  assertEquals(result.next.proposed_loop?.loop, loop.loop);
  assertEquals(result.next.active_loop, null);
});

Deno.test("accept_shape installs only the persisted proposal", () => {
  const result = transition(
    request("accept_shape", { install: false, loop: { loop: "attacker" } }),
    { ...base, current_step: "shape_review", proposed_loop: loop },
  );
  assertEquals(result.events[0].event_type, "loop_installed");
  assertEquals(result.next.active_loop?.loop, loop.loop);
  assertEquals(result.next.current_step, "move");
});

Deno.test("accept_shape cannot install a client-supplied loop without proposal", () => {
  assertThrows(
    () =>
      transition(request("accept_shape", { loop }), {
        ...base,
        current_step: "shape_review",
      }),
    Error,
    "no_proposed_shape",
  );
});

Deno.test("correct_shape never installs even with a crossed install boolean", () => {
  const revised = { ...loop, loop: "Write one sentence" };
  const result = transition(
    request("correct_shape", { answer: "Smaller.", install: true }),
    { ...base, current_step: "shape_review", proposed_loop: loop },
    revised,
  );
  assertEquals(result.next.active_loop, null);
  assertEquals(result.next.proposed_loop?.loop, revised.loop);
  assertEquals(result.events.at(-1)?.event_type, "shape_proposed");
});

Deno.test("wire contract rejects obsolete install boolean", () => {
  assertThrows(
    () => parseRequest(request("accept_shape", { install: true })),
    Error,
    "obsolete_install_flag",
  );
});

Deno.test("return reads an installed loop instead of restarting Sense", () => {
  const result = transition(request("start_or_resume"), {
    ...base,
    active_loop: loop,
  });
  assertEquals(result.events[0].event_type, "session_resumed");
  assertEquals(result.interaction.prompt.includes(loop.loop), true);
  assertEquals(result.next.current_step, "return");
});

Deno.test("midstream resume repeats persisted interaction instead of restarting", () => {
  const interaction = {
    kind: "reflection" as const,
    prompt: "What is wrong?",
    input_mode: "dictation_or_text" as const,
    choices: ["Accurate enough"],
  };
  const result = transition(request("start_or_resume"), {
    ...base,
    current_step: "field_reflection",
    working_state: {
      runtime_output: {
        interaction,
        available_actions: ["correct_reflection", "propose_shape"],
        correction_action: "correct_reflection",
      },
    },
  });
  assertEquals(result.events[0].event_type, "session_resumed");
  assertEquals(result.interaction, interaction);
  assertEquals(result.next.current_step, "field_reflection");
});

Deno.test("action cannot skip directly from Sense to installation", () => {
  assertThrows(
    () =>
      transition(request("accept_shape"), {
        ...base,
        current_step: "sense_arrival",
        proposed_loop: loop,
      }),
    Error,
    "action_not_available",
  );
});

Deno.test("empty Sense answer is rejected", () => {
  assertThrows(
    () =>
      transition(request("submit_answer", { answer: " " }), {
        ...base,
        current_step: "sense_arrival",
      }),
    Error,
    "answer_required",
  );
});
