import { constantTimeSecretMatch } from "./auth.ts";
import { config } from "./config.ts";
import {
  FUNCTION_VERSION,
  type Handle,
  parseRequest,
  PROMPT_VERSION,
  PROTOCOL_VERSION,
  type RuntimeResponse,
} from "./contracts.ts";
import {
  getActiveSession,
  getSession,
  persistTransition,
  RepositoryError,
  toState,
} from "./repository.ts";
import { generateShape } from "./shape-generator.ts";
import { type SessionState, transition } from "./state-machine.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const handle = (kind: "purpose" | "orientation"): Handle => ({
  id: kind === "purpose" ? config.purposeId : config.orientationId,
  label: kind === "purpose" ? config.purposeLabel : config.orientationLabel,
  source: "deployment_environment",
  resolution: "minimal",
  expandable: true,
});

const initialState = (): SessionState => ({
  status: "active",
  current_step: "start",
  working_state: {},
  purpose_handle: handle("purpose"),
  orientation_handle: handle("orientation"),
  proposed_loop: null,
  active_loop: null,
  return_trigger: null,
});

const repositoryConfig = {
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.serviceRoleKey,
};

class ClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function resolveState(
  action: string,
  sessionId: string | null,
): Promise<{ id: string | null; state: SessionState }> {
  if (sessionId) {
    const row = await getSession(repositoryConfig, sessionId);
    if (!row) throw new ClientError("session_not_found", 404);
    if (["completed", "released", "abandoned"].includes(row.status)) {
      throw new ClientError("terminal_session", 409);
    }
    return { id: row.id, state: toState(row) };
  }
  if (action !== "start_or_resume") {
    throw new ClientError("session_id_required", 400);
  }
  const active = await getActiveSession(repositoryConfig);
  return active
    ? { id: active.id, state: toState(active) }
    : { id: null, state: initialState() };
}

const clientErrors = new Set([
  "invalid_request",
  "invalid_json",
  "invalid_action",
  "invalid_client_event_id",
  "invalid_session_id",
  "invalid_input",
  "obsolete_install_flag",
  "invalid_client",
  "invalid_client_source",
  "invalid_client_version",
  "answer_required",
  "correction_required",
  "claim_required",
  "shape_correction_required",
  "no_proposed_shape",
  "invalid_move_result",
  "action_not_available",
  "resume_state_incomplete",
]);

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (
    !await constantTimeSecretMatch(
      request.headers.get("x-ssmm-runtime-secret"),
      config.runtimeSecret,
    )
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ClientError("invalid_json", 400);
    }
    const input = parseRequest(body);
    const current = await resolveState(input.action, input.session_id);
    let generatedShape = null;
    if (input.action === "propose_shape") {
      generatedShape = await generateShape(
        config.shape,
        current.state,
        String(input.input.answer ?? ""),
      );
    } else if (input.action === "correct_shape") {
      generatedShape = await generateShape(
        config.shape,
        current.state,
        String(current.state.working_state.strongest_legitimate_claim ?? ""),
        String(input.input.answer ?? ""),
      );
    }

    const result = transition(input, current.state, generatedShape);
    const runtimeOutput = {
      interaction: result.interaction,
      available_actions: result.available_actions,
      correction_action: result.correction_action,
    };
    result.next.working_state = {
      ...result.next.working_state,
      runtime_output: runtimeOutput,
    };
    const finalEvent = result.events.at(-1);
    if (!finalEvent) throw new Error("transition_returned_no_events");
    finalEvent.payload = {
      ...finalEvent.payload,
      runtime_output: runtimeOutput,
    };
    const persisted = await persistTransition(
      repositoryConfig,
      current.id,
      input.client_event_id,
      input.client.source,
      PROTOCOL_VERSION,
      PROMPT_VERSION,
      result,
    );
    const receiptEvent = persisted.events.at(-1);
    if (!receiptEvent) throw new Error("persistence_returned_no_events");
    const replayOutput = receiptEvent.payload.runtime_output as {
      interaction?: RuntimeResponse["interaction"];
      available_actions?: RuntimeResponse["available_actions"];
      correction_action?: RuntimeResponse["correction_action"];
    } | undefined;
    const interaction = persisted.idempotent_replay && replayOutput?.interaction
      ? replayOutput.interaction
      : result.interaction;
    const availableActions =
      persisted.idempotent_replay && replayOutput?.available_actions
        ? replayOutput.available_actions
        : result.available_actions;
    const correctionAction = persisted.idempotent_replay &&
        replayOutput?.correction_action !== undefined
      ? replayOutput.correction_action
      : result.correction_action;

    const response: RuntimeResponse = {
      session_id: persisted.session.id,
      session_status: persisted.session.status,
      interaction,
      state_summary: {
        current_step: persisted.session.current_step,
        active_loop: persisted.session.active_loop,
        proposed_loop: persisted.session.proposed_loop,
        purpose_label: persisted.session.purpose_handle.label,
        orientation_label: persisted.session.orientation_handle.label,
      },
      available_actions: availableActions,
      correction_action: correctionAction,
      receipt: {
        event_id: receiptEvent.id,
        client_event_id: input.client_event_id,
        persisted: true,
        idempotent_replay: persisted.idempotent_replay,
      },
      versions: {
        protocol: PROTOCOL_VERSION,
        prompt: PROMPT_VERSION,
        function: FUNCTION_VERSION,
      },
    };
    return json(response);
  } catch (error) {
    if (error instanceof ClientError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof Error && clientErrors.has(error.message)) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof RepositoryError && error.status === 404) {
      return json({ error: "persistence_not_found" }, 404);
    }
    console.error("ssmm_runtime_failure", error);
    return json({
      error: "internal_error",
      function_version: FUNCTION_VERSION,
    }, 500);
  }
});
