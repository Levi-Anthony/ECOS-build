import type { Handle } from "./contracts.ts";
import type { MainLoopState, Transition } from "./state-machine.ts";

export type RepositoryConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

export type PersistedResult = {
  idempotent_replay: boolean;
  loop: MainLoopState;
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

export function toState(value: unknown): MainLoopState {
  if (!value || typeof value !== "object") {
    throw new Error("loop_state_incomplete");
  }
  const row = value as Partial<MainLoopState>;
  return {
    loop_id: row.loop_id ?? null,
    loop_status: row.loop_status ?? "active",
    authoritative_phase: row.authoritative_phase ?? "sense",
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

export async function getLoop(
  config: RepositoryConfig,
  loopId: string,
): Promise<MainLoopState | null> {
  const result = await rpc(config, "get_loop_state", { p_loop_id: loopId });
  return result ? toState(result) : null;
}

export async function getCurrentLoop(
  config: RepositoryConfig,
): Promise<MainLoopState | null> {
  const result = await rpc(config, "get_current_loop_state", {});
  return result ? toState(result) : null;
}

export async function getLatestLoop(
  config: RepositoryConfig,
): Promise<MainLoopState | null> {
  const result = await rpc(config, "get_latest_loop_state", {});
  return result ? toState(result) : null;
}

export async function persistTransition(
  config: RepositoryConfig,
  loopId: string | null,
  clientEventId: string,
  source: string,
  protocolVersion: string,
  promptVersion: string,
  transition: Transition,
): Promise<PersistedResult> {
  return await rpc(config, "apply_runtime_events", {
    p_loop_id: loopId,
    p_client_event_id: clientEventId,
    p_events: transition.events,
    p_protocol_version: protocolVersion,
    p_prompt_version: promptVersion,
    p_invocation_source: source,
    p_next_state: transition.next,
    p_close_loop: transition.close_loop ?? false,
  }) as PersistedResult;
}
