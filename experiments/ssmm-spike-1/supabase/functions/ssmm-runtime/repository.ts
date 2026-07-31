import {
  type ConflictCategory,
  conflictCategories,
  type Handle,
  type RuntimeConflictResponse,
  type RuntimeRequest,
} from "./contracts.ts";
import type { RuntimeRequestFingerprint } from "./request-fingerprint.ts";
import type { MainLoopState, Transition } from "./state-machine.ts";

export type RepositoryConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export type RevisionedLoopState = MainLoopState & {
  authoritative_revision: number;
};

export type PersistedResult = {
  idempotent_replay: boolean;
  loop: RevisionedLoopState;
  events: Array<{
    id: string;
    client_event_id: string;
    sequence_number: number;
    payload: Record<string, unknown>;
  }>;
};

export class RepositoryError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super("repository_request_failed");
  }
}

export function parseConflict(error: RepositoryError): RuntimeConflictResponse | null {
  if (error.status !== 409) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(error.detail) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (body.code !== "PT409" || typeof body.message !== "string") return null;
  const category = conflictCategories.find((item) => body.message === item);
  if (!category) return null;

  let details: Record<string, unknown> = {};
  if (typeof body.details === "string" && body.details) {
    try {
      const parsed = JSON.parse(body.details) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed as Record<string, unknown>;
    } catch {
      // Invalid details are omitted from the safe response.
    }
  }
  const response: RuntimeConflictResponse = {
    error: "conflict",
    category: category as ConflictCategory,
    current_loop_revision: Number.isSafeInteger(details.current_loop_revision) ? Number(details.current_loop_revision) : null,
  };
  if (category === "stale_proposal") {
    response.current_proposal_id = typeof details.current_proposal_id === "string" ? details.current_proposal_id : null;
    response.current_proposal_version = Number.isSafeInteger(details.current_proposal_version) ? Number(details.current_proposal_version) : null;
  }
  return response;
}

const headers = (config: RepositoryConfig) => ({
  apikey: config.serviceRoleKey,
  authorization: `Bearer ${config.serviceRoleKey}`,
  "content-type": "application/json",
  "content-profile": "ssmm_spike1",
  "accept-profile": "ssmm_spike1",
});

async function request(
  config: RepositoryConfig,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(config), ...init.headers },
  });
  if (!response.ok) {
    throw new RepositoryError(response.status, await response.text());
  }
  return await response.json();
}

const rpc = async (
  config: RepositoryConfig,
  name: string,
  body: Record<string, unknown>,
) =>
  await request(config, `rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export function toState(value: unknown): RevisionedLoopState {
  if (!value || typeof value !== "object") {
    throw new Error("loop_state_incomplete");
  }
  const row = value as Partial<RevisionedLoopState>;
  const revision = Number(row.authoritative_revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("loop_revision_incomplete");
  }
  return {
    loop_id: row.loop_id ?? null,
    loop_status: row.loop_status ?? "active",
    authoritative_phase: row.authoritative_phase ?? "sense",
    authoritative_revision: revision,
    current_step: row.current_step ?? "sense_entry",
    working_state: row.working_state ?? {},
    purpose_handle: row.purpose_handle as Handle,
    orientation_handle: row.orientation_handle as Handle,
    sense_state: row.sense_state ?? {
      grounded_inputs: [],
      field_representation: {},
      uncertainties: [],
      material_constraints: [],
      purpose_orientation_context: {},
      sense_completion_basis: null,
      inherited_residue: null,
    },
    shape_proposals: row.shape_proposals ?? [],
    proposed_shape: row.proposed_shape ?? null,
    installed_shape: row.installed_shape ?? null,
    move_custody: row.move_custody ?? null,
    active_adjustment: row.active_adjustment ?? null,
    metabolize_state: row.metabolize_state ?? null,
    no_active_reason: row.no_active_reason ?? "never_started",
  };
}

const toPersistedResult = (value: unknown): PersistedResult => {
  if (!value || typeof value !== "object") {
    throw new Error("persistence_result_incomplete");
  }
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.events)) {
    throw new Error("persistence_events_incomplete");
  }
  return {
    idempotent_replay: result.idempotent_replay === true,
    loop: toState(result.loop),
    events: result.events as PersistedResult["events"],
  };
};

export async function getLoop(
  config: RepositoryConfig,
  loopId: string,
): Promise<RevisionedLoopState | null> {
  const result = await rpc(config, "get_loop_state", { p_loop_id: loopId });
  return result ? toState(result) : null;
}

export async function getCurrentLoop(
  config: RepositoryConfig,
): Promise<RevisionedLoopState | null> {
  const result = await rpc(config, "get_current_loop_state", {});
  return result ? toState(result) : null;
}

export async function getLatestLoop(
  config: RepositoryConfig,
): Promise<RevisionedLoopState | null> {
  const result = await rpc(config, "get_latest_loop_state", {});
  return result ? toState(result) : null;
}

export async function lookupRuntimeRequest(
  config: RepositoryConfig,
  clientEventId: string,
  fingerprint: RuntimeRequestFingerprint,
): Promise<PersistedResult | null> {
  const result = await rpc(config, "check_runtime_request", {
    p_client_event_id: clientEventId,
    p_request_canonical: fingerprint.canonical,
    p_request_canonical_text: fingerprint.canonicalText,
    p_request_fingerprint: fingerprint.sha256,
  });
  return result ? toPersistedResult(result) : null;
}

export async function persistTransition(
  config: RepositoryConfig,
  requestInput: RuntimeRequest,
  source: string,
  protocolVersion: string,
  promptVersion: string,
  fingerprint: RuntimeRequestFingerprint,
  transition: Transition,
): Promise<PersistedResult> {
  return toPersistedResult(await rpc(config, "apply_runtime_events", {
    p_loop_id: requestInput.loop_id,
    p_client_event_id: requestInput.client_event_id,
    p_action: requestInput.action,
    p_request_canonical: fingerprint.canonical,
    p_request_canonical_text: fingerprint.canonicalText,
    p_request_fingerprint: fingerprint.sha256,
    p_expected_loop_revision: requestInput.expected_loop_revision ?? null,
    p_accepted_proposal_id: requestInput.accepted_proposal_id ?? null,
    p_accepted_proposal_version: requestInput.accepted_proposal_version ?? null,
    p_events: transition.events,
    p_protocol_version: protocolVersion,
    p_prompt_version: promptVersion,
    p_invocation_source: source,
    p_next_state: transition.next,
    p_close_loop: transition.close_loop ?? false,
  }));
}
