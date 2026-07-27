import type {
  Action,
  Handle,
  InstalledLoop,
  Interaction,
  RuntimeRequest,
} from "./contracts.ts";

export type SessionState = {
  status: string;
  current_step: string;
  working_state: Record<string, unknown>;
  purpose_handle: Handle;
  orientation_handle: Handle;
  proposed_loop: InstalledLoop | null;
  active_loop: InstalledLoop | null;
  return_trigger: Record<string, unknown> | null;
};

export type Transition = {
  events: Array<{
    event_type: string;
    actor: "levi" | "runtime" | "system";
    perspective: string;
    payload: Record<string, unknown>;
  }>;
  next: SessionState;
  interaction: Interaction;
  available_actions: Action[];
  correction_action: Action | null;
  close_session?: boolean;
};

const answer = (request: RuntimeRequest) =>
  String(request.input.answer ?? "").trim();

const requireStep = (state: SessionState, allowed: string[]) => {
  if (!allowed.includes(state.current_step)) {
    throw new Error("action_not_available");
  }
};

export function transition(
  request: RuntimeRequest,
  state: SessionState,
  generatedShape: InstalledLoop | null = null,
): Transition {
  switch (request.action) {
    case "start_or_resume": {
      if (state.active_loop) {
        return {
          events: [{
            event_type: "session_resumed",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: {},
          }],
          next: { ...state, status: "active", current_step: "return" },
          interaction: {
            kind: "choice",
            prompt:
              `The active loop is: ${state.active_loop.loop}\nWhat is true now?`,
            input_mode: "choice",
            choices: [
              "Still moving",
              "Interrupted but still valid",
              "Blocked",
              "Conditions changed",
              "Completed",
              "Release this loop",
              "Start a fresh sensing pass",
            ],
          },
          available_actions: ["record_return", "close_session"],
          correction_action: "record_return",
        };
      }
      if (state.current_step !== "start") {
        const output = state.working_state.runtime_output as {
          interaction?: Interaction;
          available_actions?: Action[];
          correction_action?: Action | null;
        } | undefined;
        if (!output?.interaction || !output.available_actions) {
          throw new Error("resume_state_incomplete");
        }
        return {
          events: [{
            event_type: "session_resumed",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: { resumed_step: state.current_step },
          }],
          next: state,
          interaction: output.interaction,
          available_actions: output.available_actions,
          correction_action: output.correction_action ?? null,
        };
      }
      return {
        events: [{
          event_type: "session_started",
          actor: "system",
          perspective: "lr_system_evidence",
          payload: {},
        }],
        next: { ...state, status: "active", current_step: "sense_arrival" },
        interaction: {
          kind: "question",
          prompt:
            "What is concretely true in your body, surroundings, time, and immediate obligations?",
          input_mode: "dictation_or_text",
          choices: [],
        },
        available_actions: ["submit_answer", "close_session"],
        correction_action: "submit_answer",
      };
    }
    case "submit_answer": {
      requireStep(state, ["sense_arrival"]);
      if (!answer(request)) throw new Error("answer_required");
      const answers = [
        ...((state.working_state.sense_answers as string[] | undefined) ?? []),
        answer(request),
      ];
      const reflection = [
        "What appears true:",
        answers.join(" "),
        "What remains uncertain:",
        "I only know what you reported, and I may be weighting it incorrectly.",
      ].join("\n");
      return {
        events: [
          {
            event_type: "sense_answered",
            actor: "levi",
            perspective: "ul_levi_report",
            payload: { answer: answer(request) },
          },
          {
            event_type: "field_reflected",
            actor: "runtime",
            perspective: "proposal",
            payload: { reflection },
          },
        ],
        next: {
          ...state,
          current_step: "field_reflection",
          working_state: {
            ...state.working_state,
            sense_answers: answers,
            reflection,
          },
        },
        interaction: {
          kind: "reflection",
          prompt:
            `${reflection}\n\nWhat is wrong, missing, overstated, or not mine to decide?`,
          input_mode: "dictation_or_text",
          choices: ["Accurate enough"],
        },
        available_actions: [
          "correct_reflection",
          "propose_shape",
          "close_session",
        ],
        correction_action: "correct_reflection",
      };
    }
    case "correct_reflection": {
      requireStep(state, ["field_reflection"]);
      if (!answer(request)) throw new Error("correction_required");
      return {
        events: [{
          event_type: "field_corrected",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: { correction: answer(request) },
        }],
        next: {
          ...state,
          current_step: "shape",
          working_state: {
            ...state.working_state,
            reflection_correction: answer(request),
          },
        },
        interaction: {
          kind: "question",
          prompt:
            "Given that correction, what has the strongest legitimate claim on attention now?",
          input_mode: "dictation_or_text",
          choices: [],
        },
        available_actions: ["propose_shape", "close_session"],
        correction_action: "correct_reflection",
      };
    }
    case "propose_shape": {
      requireStep(state, ["field_reflection", "shape"]);
      if (!answer(request)) throw new Error("claim_required");
      if (!generatedShape) throw new Error("shape_generation_required");
      return {
        events: [
          {
            event_type: "sense_answered",
            actor: "levi",
            perspective: "ul_levi_report",
            payload: {
              answer: answer(request),
              question: "strongest_legitimate_claim",
            },
          },
          {
            event_type: "shape_proposed",
            actor: "runtime",
            perspective: "proposal",
            payload: { loop: generatedShape },
          },
        ],
        next: {
          ...state,
          current_step: "shape_review",
          working_state: {
            ...state.working_state,
            strongest_legitimate_claim: answer(request),
          },
          proposed_loop: generatedShape,
        },
        interaction: {
          kind: "shape",
          prompt: renderShape(generatedShape),
          input_mode: "choice",
          choices: [
            "Install",
            "Revise",
            "Not now",
            "This is wrong",
            "I need a different scale",
            "I need help acting, not more analysis",
          ],
        },
        available_actions: ["accept_shape", "correct_shape", "close_session"],
        correction_action: "correct_shape",
      };
    }
    case "accept_shape": {
      requireStep(state, ["shape_review"]);
      const loop = state.proposed_loop;
      if (!loop) {
        throw new Error("no_proposed_shape");
      }
      return {
        events: [{
          event_type: "loop_installed",
          actor: "levi",
          perspective: "decision",
          payload: { loop },
        }],
        next: {
          ...state,
          status: "waiting_for_move",
          current_step: "move",
          proposed_loop: null,
          active_loop: loop,
          return_trigger: { description: loop.return_trigger },
        },
        interaction: {
          kind: "question",
          prompt:
            `First move: ${loop.first_move}\nBegin it now, revise it, defer it consciously, or refuse it.`,
          input_mode: "choice",
          choices: ["Started", "Revised", "Deferred", "Refused", "Unable"],
        },
        available_actions: ["record_move", "close_session"],
        correction_action: "record_move",
      };
    }
    case "correct_shape": {
      requireStep(state, ["shape_review"]);
      if (!answer(request)) throw new Error("shape_correction_required");
      if (!state.proposed_loop) throw new Error("no_proposed_shape");
      if (!generatedShape) throw new Error("shape_generation_required");
      return {
        events: [
          {
            event_type: "shape_corrected",
            actor: "levi",
            perspective: "ul_levi_report",
            payload: { correction: answer(request) },
          },
          {
            event_type: "shape_proposed",
            actor: "runtime",
            perspective: "proposal",
            payload: { loop: generatedShape, revises: state.proposed_loop },
          },
        ],
        next: {
          ...state,
          status: "active",
          current_step: "shape_review",
          proposed_loop: generatedShape,
        },
        interaction: {
          kind: "shape",
          prompt: renderShape(generatedShape),
          input_mode: "choice",
          choices: ["Install", "Revise", "Not now", "This is wrong"],
        },
        available_actions: ["accept_shape", "correct_shape", "close_session"],
        correction_action: "correct_shape",
      };
    }
    case "record_move": {
      requireStep(state, ["move"]);
      const result = String(request.input.result ?? "");
      if (
        !["started", "revised", "deferred", "refused", "unable"].includes(
          result,
        )
      ) {
        throw new Error("invalid_move_result");
      }
      return {
        events: [{
          event_type: result === "started" ? "move_started" : "move_refused",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: { result, reason: request.input.reason ?? null },
        }],
        next: {
          ...state,
          status: result === "started" ? "moving" : "interrupted",
          current_step: "return",
        },
        interaction: {
          kind: "receipt",
          prompt:
            "The move result and active loop are persisted. Return through the same button when conditions change or the return trigger fires.",
          input_mode: "none",
          choices: [],
        },
        available_actions: ["record_return", "record_outcome", "close_session"],
        correction_action: "record_return",
      };
    }
    case "record_return":
      requireStep(state, ["return"]);
      return {
        events: [{
          event_type: "condition_changed",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: request.input,
        }],
        next: { ...state, status: "active", current_step: "return_assessment" },
        interaction: {
          kind: "question",
          prompt:
            "What actually changed, and does the installed loop remain valid?",
          input_mode: "dictation_or_text",
          choices: ["Continue", "Modify", "Replace", "Complete", "Release"],
        },
        available_actions: ["record_outcome", "close_session"],
        correction_action: "record_outcome",
      };
    case "record_outcome":
      requireStep(state, ["return", "return_assessment"]);
      return {
        events: [{
          event_type: "metabolize_recorded",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: request.input,
        }],
        next: {
          ...state,
          status: request.input.disposition === "completed"
            ? "completed"
            : "active",
          current_step: "metabolize",
          working_state: {
            ...state.working_state,
            latest_consequence: request.input,
          },
        },
        interaction: {
          kind: "receipt",
          prompt:
            "The consequence is carried forward. The next invocation will read this condition before proposing another loop.",
          input_mode: "none",
          choices: [],
        },
        available_actions: ["start_or_resume", "close_session"],
        correction_action: "record_outcome",
      };
    case "close_session":
      return {
        events: [{
          event_type: "session_closed",
          actor: "levi",
          perspective: "decision",
          payload: request.input,
        }],
        next: { ...state, status: "abandoned", current_step: "closed" },
        interaction: {
          kind: "receipt",
          prompt:
            "Session closed. Its latest condition remains available for review.",
          input_mode: "none",
          choices: [],
        },
        available_actions: ["start_or_resume"],
        correction_action: null,
        close_session: true,
      };
  }
}

function renderShape(loop: InstalledLoop): string {
  return [
    `Loop: ${loop.loop}`,
    `Why this now: ${loop.why_this_now}`,
    `Purpose: ${loop.purpose_handle.label}`,
    `Orientation: ${loop.orientation}`,
    `Done for now: ${loop.done_for_now}`,
    `First move: ${loop.first_move}`,
    `Known constraints: ${loop.known_constraints.join("; ") || "None named"}`,
    `Return trigger: ${loop.return_trigger}`,
    `Release condition: ${loop.release_condition}`,
    `Uncertainty: ${loop.uncertainty}`,
    "",
    "Install this as the active loop?",
  ].join("\n");
}
