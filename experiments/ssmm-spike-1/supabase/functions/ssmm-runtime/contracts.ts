export const PROTOCOL_VERSION = "spike1-slice-contract-0.2";
export const PROMPT_VERSION = "spike1-shape-0.3";
export const FUNCTION_VERSION = "spike1-0.3.0";

export const actions = [
  "open_current_surface",
  "submit_sense_input",
  "request_shape_proposal",
  "correct_shape_proposal",
  "reject_shape_proposal",
  "accept_shape_proposal",
  "record_installation_action",
  "confirm_shape_installed",
  "record_move_progress",
  "request_move_help",
  "record_move_interruption",
  "resume_move",
  "report_changed_conditions",
  "classify_change",
  "claim_completion",
  "submit_completion_evidence",
  "release_move",
  "abandon_move",
  "submit_metabolize_input",
  "confirm_residue",
  "close_loop",
  "recover_authoritative_state",
] as const;

export type Action = (typeof actions)[number];
export type AuthoritativePhase =
  | "sense"
  | "shape"
  | "move"
  | "metabolize"
  | "unknown";
export type LoopStatus = "active" | "closed" | "disposed" | "unknown";
export type MovePosition =
  | "not_started"
  | "starting"
  | "active"
  | "paused"
  | "interrupted"
  | "blocked"
  | "awaiting_external_condition"
  | "completion_claimed";

export type Handle = {
  id: string;
  label: string;
  source: string;
  resolution: "minimal";
  expandable: boolean;
  ratified_by?: string;
};

export type ShapeContent = {
  move_target: string;
  decision: string;
  orientation: string;
  immediate_why: string;
  reason_chain_handles: string[];
  exit_condition: string;
  degrees_of_freedom: string[];
  quick_check_adjustments: string[];
  help_required_conditions: string[];
  invalidation_conditions: string[];
  anticipated_obstacles: string[];
  completion_evidence: string[];
  installation_requirements: string[];
  first_physical_action: string;
  interruption_handling: string;
  cockpit_cues: string[];
  uncertainty: string;
  purpose_handle: Handle;
};

export type ShapeProposal = {
  id: string;
  proposal_version: number;
  proposal_content: ShapeContent;
  machine_interpretation: Record<string, unknown>;
  proposal_status: "proposed" | "rejected" | "accepted" | "superseded";
  created_at: string;
};

export type InstalledShape = ShapeContent & {
  accepted_proposal_id: string;
  accepted_by: "levi";
  accepted_at: string;
  installation_actions: Array<{
    description: string;
    evidence: string | null;
    completed_at: string;
  }>;
  installation_status: "pending" | "in_progress" | "installed";
  installed_at: string | null;
  declared_starting_conditions: string;
  small_move_exception: boolean;
  installation_waiver: string | null;
  transition_event_identifier: string | null;
  shape_version: number;
};

export type SenseState = {
  grounded_inputs: Array<Record<string, unknown>>;
  field_representation: Record<string, unknown>;
  uncertainties: string[];
  material_constraints: string[];
  purpose_orientation_context: Record<string, unknown>;
  sense_completion_basis: string | null;
  inherited_residue: Record<string, unknown> | null;
};

export type CompletionClaim = {
  claimant: "levi";
  claimed_at: string;
  statement: string;
  claimed_result: string;
  evidence_supplied: Array<Record<string, unknown>>;
  qualification: string | null;
};

export type MoveCustody = {
  move_position: MovePosition;
  latest_progress: Record<string, unknown> | null;
  latest_interruption: Record<string, unknown> | null;
  active_friction: Record<string, unknown> | null;
  pause_reason: string | null;
  last_resumed_at: string | null;
  completion_claim: CompletionClaim | null;
  evidence_supplied: Array<Record<string, unknown>>;
  current_disposition: string | null;
  pending_changed_conditions: Record<string, unknown> | null;
};

export type AdjustmentSubloop = {
  id: string;
  parent_loop_id: string | null;
  parent_phase: "move";
  parent_shape_version: number;
  reported_change: string;
  adjustment_classification: "bounded_adaptation";
  adjustment_boundary: string;
  nested_phase: "sense" | "shape" | "move" | "metabolize" | "closed";
  adjustment_shape: string;
  result: string | null;
  effect_on_parent: string | null;
  started_at: string;
  closed_at: string | null;
};

export const verificationResults = [
  "verified",
  "partially_verified",
  "not_verified",
  "cannot_verify",
  "exit_condition_disputed",
  "additional_evidence_required",
] as const;
export type VerificationResult = (typeof verificationResults)[number];

export type MetabolizeState = {
  move_disposition: string;
  exit_condition_snapshot: string;
  completion_claim_snapshot: CompletionClaim | null;
  verification_result: VerificationResult | null;
  verification_assessment: Record<string, unknown> | null;
  credited_result: string | null;
  consequences: string[];
  residue: Record<string, unknown> | null;
  released_material: string[];
  lessons: string[];
  closure_basis: string | null;
  residue_confirmed: boolean;
};

export type RuntimeRequest = {
  action: Action;
  client_event_id: string;
  loop_id: string | null;
  input: Record<string, unknown>;
  client: {
    source: "ios_action_button" | "direct_test";
    shortcut_version: string;
  };
};

export type Interaction = {
  kind:
    | "question"
    | "reflection"
    | "shape"
    | "choice"
    | "receipt"
    | "cockpit"
    | "recovery";
  prompt: string;
  input_mode: "dictation_or_text" | "choice" | "none";
  choices: string[];
};

export type RuntimeResponse = {
  loop_id: string;
  loop_status: LoopStatus;
  authoritative_phase: AuthoritativePhase;
  interaction: Interaction;
  state_summary: {
    current_step: string;
    move_position: MovePosition | null;
    proposed_shape: ShapeProposal | null;
    installed_shape: InstalledShape | null;
    active_adjustment: AdjustmentSubloop | null;
    metabolize_state: MetabolizeState | null;
    inherited_residue: Record<string, unknown> | null;
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
  if (request.loop_id !== null && typeof request.loop_id !== "string") {
    throw new Error("invalid_loop_id");
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

const requireString = (shape: Record<string, unknown>, field: string) => {
  if (typeof shape[field] !== "string" || !String(shape[field]).trim()) {
    throw new Error(`invalid_shape_${field}`);
  }
};

const requireStringArray = (shape: Record<string, unknown>, field: string) => {
  if (
    !Array.isArray(shape[field]) ||
    !(shape[field] as unknown[]).every((item) => typeof item === "string")
  ) {
    throw new Error(`invalid_shape_${field}`);
  }
};

export function parseShapeContent(value: unknown): ShapeContent {
  if (!value || typeof value !== "object") throw new Error("invalid_shape");
  const shape = value as Record<string, unknown>;
  [
    "move_target",
    "decision",
    "orientation",
    "immediate_why",
    "exit_condition",
    "first_physical_action",
    "interruption_handling",
    "uncertainty",
  ].forEach((field) => requireString(shape, field));
  [
    "reason_chain_handles",
    "degrees_of_freedom",
    "quick_check_adjustments",
    "help_required_conditions",
    "invalidation_conditions",
    "anticipated_obstacles",
    "completion_evidence",
    "installation_requirements",
    "cockpit_cues",
  ].forEach((field) => requireStringArray(shape, field));
  const purpose = shape.purpose_handle as Record<string, unknown> | undefined;
  if (
    !purpose || typeof purpose.id !== "string" ||
    typeof purpose.label !== "string"
  ) {
    throw new Error("invalid_shape_purpose_handle");
  }
  return value as ShapeContent;
}
