export const PROTOCOL_VERSION = "spike1-0.2";
export const PROMPT_VERSION = "spike1-0.2";
export const FUNCTION_VERSION = "spike1-0.2.0";

export const actions = [
  "start_or_resume",
  "submit_answer",
  "correct_reflection",
  "propose_shape",
  "accept_shape",
  "correct_shape",
  "record_move",
  "record_return",
  "record_outcome",
  "close_session",
] as const;

export type Action = (typeof actions)[number];

export type Handle = {
  id: string;
  label: string;
  source: string;
  resolution: "minimal";
  expandable: boolean;
  ratified_by?: string;
};

export type InstalledLoop = {
  loop: string;
  why_this_now: string;
  purpose_handle: Handle;
  orientation: string;
  done_for_now: string;
  first_move: string;
  known_constraints: string[];
  return_trigger: string;
  release_condition: string;
  uncertainty: string;
};

export type RuntimeRequest = {
  action: Action;
  client_event_id: string;
  session_id: string | null;
  input: Record<string, unknown>;
  client: {
    source: "ios_action_button" | "direct_test";
    shortcut_version: string;
  };
};

export type Interaction = {
  kind: "question" | "reflection" | "shape" | "choice" | "receipt";
  prompt: string;
  input_mode: "dictation_or_text" | "choice" | "none";
  choices: string[];
};

export type RuntimeResponse = {
  session_id: string;
  session_status: string;
  interaction: Interaction;
  state_summary: {
    current_step: string;
    active_loop: InstalledLoop | null;
    proposed_loop: InstalledLoop | null;
    purpose_label: string;
    orientation_label: string;
  };
  available_actions: Action[];
  correction_action: Action | null;
  receipt: {
    event_id: string;
    client_event_id: string;
    persisted: true;
    idempotent_replay: boolean;
  };
  versions: {
    protocol: string;
    prompt: string;
    function: string;
  };
};

export function parseRequest(value: unknown): RuntimeRequest {
  if (!value || typeof value !== "object") throw new Error("invalid_request");
  const request = value as Record<string, unknown>;
  if (!actions.includes(request.action as Action)) {
    throw new Error("invalid_action");
  }
  if (
    typeof request.client_event_id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(request.client_event_id)
  ) {
    throw new Error("invalid_client_event_id");
  }
  if (request.session_id !== null && typeof request.session_id !== "string") {
    throw new Error("invalid_session_id");
  }
  if (!request.input || typeof request.input !== "object") {
    throw new Error("invalid_input");
  }
  if (Object.hasOwn(request.input, "install")) {
    throw new Error("obsolete_install_flag");
  }
  if (!request.client || typeof request.client !== "object") {
    throw new Error("invalid_client");
  }
  const client = request.client as Record<string, unknown>;
  if (!["ios_action_button", "direct_test"].includes(String(client.source))) {
    throw new Error("invalid_client_source");
  }
  if (typeof client.shortcut_version !== "string") {
    throw new Error("invalid_client_version");
  }
  return value as RuntimeRequest;
}

export function parseInstalledLoop(value: unknown): InstalledLoop {
  if (!value || typeof value !== "object") throw new Error("invalid_shape");
  const loop = value as Record<string, unknown>;
  const requiredStrings = [
    "loop",
    "why_this_now",
    "orientation",
    "done_for_now",
    "first_move",
    "return_trigger",
    "release_condition",
    "uncertainty",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof loop[field] !== "string" || !loop[field].trim()) {
      throw new Error(`invalid_shape_${field}`);
    }
  }
  if (!Array.isArray(loop.known_constraints)) {
    throw new Error("invalid_shape_known_constraints");
  }
  const purpose = loop.purpose_handle as Record<string, unknown> | undefined;
  if (
    !purpose || typeof purpose.id !== "string" ||
    typeof purpose.label !== "string"
  ) {
    throw new Error("invalid_shape_purpose_handle");
  }
  return value as InstalledLoop;
}
