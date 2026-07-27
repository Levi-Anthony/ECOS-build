import type { Handle } from "./contracts.ts";
import type { SessionState, Transition } from "./state-machine.ts";

export type RepositoryConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

type SessionRow = {
  id: string;
  status: string;
  current_step: string;
  working_state: Record<string, unknown>;
  purpose_handle: Handle;
  orientation_handle: Handle;
  proposed_loop: SessionState["proposed_loop"];
  active_loop: SessionState["active_loop"];
  return_trigger: SessionState["return_trigger"];
};

export type PersistedResult = {
  idempotent_replay: boolean;
  session: SessionRow;
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

export function toState(row: SessionRow): SessionState {
  return {
    status: row.status,
    current_step: row.current_step,
    working_state: row.working_state,
    purpose_handle: row.purpose_handle,
    orientation_handle: row.orientation_handle,
    proposed_loop: row.proposed_loop,
    active_loop: row.active_loop,
    return_trigger: row.return_trigger,
  };
}

export async function getSession(
  config: RepositoryConfig,
  sessionId: string,
): Promise<SessionRow | null> {
  const rows = await request(
    config,
    `sessions?id=eq.${encodeURIComponent(sessionId)}&select=*&limit=1`,
  ) as SessionRow[];
  return rows[0] ?? null;
}

export async function getActiveSession(
  config: RepositoryConfig,
): Promise<SessionRow | null> {
  const statuses = "(active,waiting_for_move,moving,interrupted,blocked)";
  const rows = await request(
    config,
    `sessions?status=in.${statuses}&select=*&order=updated_at.desc&limit=1`,
  ) as SessionRow[];
  return rows[0] ?? null;
}

export async function persistTransition(
  config: RepositoryConfig,
  sessionId: string | null,
  clientEventId: string,
  source: string,
  protocolVersion: string,
  promptVersion: string,
  transition: Transition,
): Promise<PersistedResult> {
  return await request(config, "rpc/apply_runtime_event", {
    method: "POST",
    body: JSON.stringify({
      p_session_id: sessionId,
      p_client_event_id: clientEventId,
      p_events: transition.events,
      p_protocol_version: protocolVersion,
      p_prompt_version: promptVersion,
      p_invocation_source: source,
      p_next_status: transition.next.status,
      p_next_step: transition.next.current_step,
      p_working_state: transition.next.working_state,
      p_purpose_handle: transition.next.purpose_handle,
      p_orientation_handle: transition.next.orientation_handle,
      p_proposed_loop: transition.next.proposed_loop,
      p_active_loop: transition.next.active_loop,
      p_return_trigger: transition.next.return_trigger,
      p_close_session: transition.close_session ?? false,
    }),
  }) as PersistedResult;
}
