import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const status = execFileSync("supabase", ["status", "-o", "env"], {
  encoding: "utf8",
  env: { ...process.env, DO_NOT_TRACK: "1" },
});

const local = Object.fromEntries(
  status
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

if (!local.API_URL || !local.SERVICE_ROLE_KEY) {
  throw new Error("Local Supabase status did not provide required test values");
}

const clientEventId = `race-${randomUUID()}`;
const headers = {
  apikey: local.SERVICE_ROLE_KEY,
  authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
  "content-profile": "ssmm_spike1",
  "accept-profile": "ssmm_spike1",
};
const body = JSON.stringify({
  p_session_id: null,
  p_client_event_id: clientEventId,
  p_events: [{
    event_type: "session_started",
    actor: "system",
    perspective: "lr_system_evidence",
    payload: { test: "concurrent_retry" },
  }],
  p_protocol_version: "spike1-0.2",
  p_prompt_version: "spike1-0.2",
  p_invocation_source: "direct_test",
  p_next_status: "active",
  p_next_step: "sense_arrival",
  p_working_state: {},
  p_purpose_handle: { id: "purpose", label: "Purpose" },
  p_orientation_handle: { id: "orientation", label: "Orientation" },
  p_proposed_loop: null,
  p_active_loop: null,
  p_return_trigger: null,
  p_close_session: false,
});

const url = `${local.API_URL}/rest/v1/rpc/apply_runtime_event`;
const responses = await Promise.all([
  fetch(url, { method: "POST", headers, body }),
  fetch(url, { method: "POST", headers, body }),
]);
const payloads = await Promise.all(
  responses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
  })),
);

if (payloads.some((result) => result.status !== 200)) {
  throw new Error(`Concurrent requests did not both succeed: ${
    JSON.stringify(payloads.map((result) => result.status))
  }`);
}

const replayFlags = payloads
  .map((result) => result.body.idempotent_replay)
  .sort();
if (JSON.stringify(replayFlags) !== JSON.stringify([false, true])) {
  throw new Error(`Expected one write and one replay, got ${JSON.stringify(replayFlags)}`);
}

const sessionIds = new Set(payloads.map((result) => result.body.session.id));
if (sessionIds.size !== 1) {
  throw new Error("Concurrent retries resolved to different sessions");
}

const eventResponse = await fetch(
  `${local.API_URL}/rest/v1/events?client_event_id=eq.${clientEventId}&select=id`,
  { headers },
);
const events = await eventResponse.json();
if (eventResponse.status !== 200 || events.length !== 1) {
  throw new Error(`Expected one persisted event, got ${events.length}`);
}

console.log("PASS concurrent retry: 2x HTTP 200, one write, one replay, one event");

