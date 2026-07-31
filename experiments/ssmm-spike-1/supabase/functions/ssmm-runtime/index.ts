import { constantTimeSecretMatch } from "./auth.ts";
import { config } from "./config.ts";
import {
  type ConflictCategory,
  conflictCategories,
  FUNCTION_VERSION,
  type Handle,
  parseRequest,
  PROMPT_VERSION,
  PROTOCOL_VERSION,
  type RuntimeConflictResponse,
  type RuntimeRequest,
  type RuntimeResponse,
} from "./contracts.ts";
import { fingerprintRuntimeRequest } from "./request-fingerprint.ts";
import {
  getCurrentLoop,
  getLatestLoop,
  getLoop,
  lookupRuntimeRequest,
  type PersistedResult,
  persistTransition,
  RepositoryError,
  type RevisionedLoopState,
} from "./repository.ts";
import { generateShape } from "./shape-generator.ts";
import {
  surfaceForState,
  transition,
} from "./state-machine.ts";

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

const initialState = (
  latest: RevisionedLoopState | null,
): RevisionedLoopState => ({
  loop_id: null,
  loop_status: "active",
  authoritative_phase: "sense",
  authoritative_revision: 0,
  current_step: "sense_entry",
  working_state: { unpersisted: true },
  purpose_handle: handle("purpose"),
  orientation_handle: handle("orientation"),
  sense_state: {
    grounded_inputs: [],
    field_representation: {},
    uncertainties: [],
    material_constraints: [],
    purpose_orientation_context: {},
    sense_completion_basis: null,
    inherited_residue: latest?.metabolize_state?.residue ?? null,
  },
  shape_proposals: [],
  proposed_shape: null,
  installed_shape: null,
  move_custody: null,
  active_adjustment: null,
  metabolize_state: null,
  no_active_reason: latest
    ? `last_loop_${latest.loop_status}:${
      latest.metabolize_state?.move_disposition ?? "unknown"
    }`
    : "never_started",
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
  loopId: string | null,
): Promise<RevisionedLoopState> {
  if (loopId) {
    const state = await getLoop(repositoryConfig, loopId);
    if (!state) throw new ClientError("loop_not_found", 404);
    if (["closed", "disposed"].includes(state.loop_status)) {
      throw new ClientError("terminal_loop", 409);
    }
    return state;
  }
  if (action !== "open_current_surface") {
    throw new ClientError("loop_id_required", 400);
  }
  const current = await getCurrentLoop(repositoryConfig);
  if (current) return current;
  return initialState(await getLatestLoop(repositoryConfig));
}

const clientErrors = new Set([
  "invalid_request",
  "invalid_json",
  "invalid_action",
  "invalid_client_event_id",
  "invalid_loop_id",
  "invalid_input",
  "obsolete_install_flag",
  "invalid_client",
  "invalid_client_source",
  "invalid_client_version",
  "expected_loop_revision_required",
  "invalid_expected_loop_revision",
  "accepted_proposal_id_required",
  "accepted_proposal_version_required",
  "unexpected_proposal_identity",
  "grounded_input_required",
  "sense_completion_basis_required",
  "shape_generation_required",
  "no_shape_proposal",
  "shape_correction_required",
  "accepted_shape_required",
  "installation_action_required",
  "installation_confirmation_required",
  "installation_actions_required",
  "move_custody_incomplete",
  "move_progress_required",
  "invalid_move_position",
  "nested_adjustment_already_active",
  "bounded_adjustment_contract_required",
  "interruption_reason_required",
  "changed_conditions_required",
  "changed_conditions_report_required",
  "invalid_change_classification",
  "completion_claim_required",
  "completion_evidence_required",
  "metabolize_state_required",
  "verification_result_required",
  "conditioned_residue_required",
  "recovered_phase_required",
  "recovery_decision_required",
  "action_not_available",
]);

const runtimeOutputFromEvent = (persisted: PersistedResult) => {
  const payload = persisted.events.at(-1)?.payload.runtime_output;
  if (!payload || typeof payload !== "object") return null;
  return payload as {
    interaction?: RuntimeResponse["interaction"];
    available_actions?: RuntimeResponse["available_actions"];
    correction_action?: RuntimeResponse["correction_action"];
  };
};

function persistedResponse(
  input: RuntimeRequest,
  persisted: PersistedResult,
  fallback?: {
    interaction: RuntimeResponse["interaction"];
    available_actions: RuntimeResponse["available_actions"];
    correction_action: RuntimeResponse["correction_action"];
  },
): RuntimeResponse {
  const replayOutput = runtimeOutputFromEvent(persisted);
  const interaction = replayOutput?.interaction ?? fallback?.interaction;
  const availableActions = replayOutput?.available_actions ??
    fallback?.available_actions;
  const correctionAction = replayOutput?.correction_action !== undefined
    ? replayOutput.correction_action
    : fallback?.correction_action;
  if (!interaction || !availableActions || correctionAction === undefined) {
    throw new Error("persisted_runtime_output_incomplete");
  }
  const receiptEvent = persisted.events.at(-1);
  if (!receiptEvent) throw new Error("persistence_returned_no_events");
  const state = persisted.loop;
  return {
    loop_id: state.loop_id!,
    loop_revision: state.authoritative_revision,
    loop_status: state.loop_status,
    authoritative_phase: state.authoritative_phase,
    interaction,
    state_summary: {
      current_step: state.current_step,
      move_position: state.move_custody?.move_position ?? null,
      proposed_shape: state.proposed_shape,
      installed_shape: state.installed_shape,
      active_adjustment: state.active_adjustment,
      metabolize_state: state.metabolize_state,
      inherited_residue: state.sense_state.inherited_residue,
      purpose_label: state.purpose_handle.label,
      orientation_label: state.orientation_handle.label,
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
}

function readOnlyResponse(
  input: RuntimeRequest,
  state: RevisionedLoopState,
): RuntimeResponse {
  const surface = surfaceForState(state);
  return {
    loop_id: state.loop_id!,
    loop_revision: state.authoritative_revision,
    loop_status: state.loop_status,
    authoritative_phase: state.authoritative_phase,
    interaction: surface.interaction,
    state_summary: {
      current_step: state.current_step,
      move_position: state.move_custody?.move_position ?? null,
      proposed_shape: state.proposed_shape,
      installed_shape: state.installed_shape,
      active_adjustment: state.active_adjustment,
      metabolize_state: state.metabolize_state,
      inherited_residue: state.sense_state.inherited_residue,
      purpose_label: state.purpose_handle.label,
      orientation_label: state.orientation_handle.label,
    },
    available_actions: surface.available_actions,
    correction_action: surface.correction_action,
    receipt: {
      event_id: null,
      client_event_id: input.client_event_id,
      persisted: false,
      idempotent_replay: false,
    },
    versions: {
      protocol: PROTOCOL_VERSION,
      prompt: PROMPT_VERSION,
      function: FUNCTION_VERSION,
    },
  };
}

const parseConflict = (
  error: RepositoryError,
): RuntimeConflictResponse | null => {
  let message = "";
  let details: Record<string, unknown> = {};
  try {
    const body = JSON.parse(error.detail) as Record<string, unknown>;
    message = String(body.message ?? "");
    if (typeof body.details === "string" && body.details) {
      details = JSON.parse(body.details) as Record<string, unknown>;
    }
  } catch {
    message = error.detail;
  }
  const category = conflictCategories.find((item) => message.includes(item));
  if (!category) return null;
  const response: RuntimeConflictResponse = {
    error: "conflict",
    category: category as ConflictCategory,
    current_loop_revision: Number.isSafeInteger(details.current_loop_revision)
      ? Number(details.current_loop_revision)
      : null,
  };
  if (category === "stale_proposal") {
    response.current_proposal_id = typeof details.current_proposal_id === "string"
      ? details.current_proposal_id
      : null;
    response.current_proposal_version = Number.isSafeInteger(
        details.current_proposal_version,
      )
      ? Number(details.current_proposal_version)
      : null;
  }
  return response;
};

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
    const fingerprint = await fingerprintRuntimeRequest(input, PROTOCOL_VERSION);

    const prior = await lookupRuntimeRequest(
      repositoryConfig,
      input.client_event_id,
      fingerprint,
    );
    if (prior) return json(persistedResponse(input, prior));

    const current = await resolveState(input.action, input.loop_id);
    if (input.action === "open_current_surface" && current.loop_id !== null) {
      return json(readOnlyResponse(input, current));
    }

    let generatedShape = null;
    if (
      input.action === "request_shape_proposal" ||
      input.action === "correct_shape_proposal"
    ) {
      generatedShape = await generateShape(
        config.shape,
        current,
        input.action === "correct_shape_proposal"
          ? String(input.input.correction ?? "")
          : undefined,
      );
    }

    const result = transition(input, current, generatedShape);
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
      input,
      input.client.source,
      PROTOCOL_VERSION,
      PROMPT_VERSION,
      fingerprint,
      result,
    );
    return json(persistedResponse(input, persisted, runtimeOutput));
  } catch (error) {
    if (error instanceof ClientError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof Error && clientErrors.has(error.message)) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof RepositoryError) {
      const conflict = parseConflict(error);
      if (conflict) return json(conflict, 409);
      if (error.status === 404) {
        return json({ error: "persistence_not_found" }, 404);
      }
      if (error.detail.includes("authoritative_transition_already_recorded")) {
        return json({ error: "authoritative_transition_already_recorded" }, 409);
      }
    }
    console.error("ssmm_runtime_failure", error);
    return json({
      error: "internal_error",
      function_version: FUNCTION_VERSION,
    }, 500);
  }
});
