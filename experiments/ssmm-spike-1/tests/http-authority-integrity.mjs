import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const status = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", env: { ...process.env, DO_NOT_TRACK: "1" } });
const local = Object.fromEntries(status.split("\n").map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map((match) => [match[1], match[2]]));
if (!local.API_URL || !local.SERVICE_ROLE_KEY) throw new Error("Local Supabase status did not provide required test values");
const runtimeUrl = process.env.SSMM_RUNTIME_URL ?? `${local.API_URL}/functions/v1/ssmm-runtime`;
const runtimeSecret = process.env.SSMM_RUNTIME_SHARED_SECRET;
if (!runtimeSecret) throw new Error("SSMM_RUNTIME_SHARED_SECRET is required");
const dbHeaders = { apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, "content-type": "application/json", "content-profile": "ssmm_spike1", "accept-profile": "ssmm_spike1" };
const protocol = "spike1-slice-contract-0.3";
let checks = 0;
const assert = (condition, message) => { checks += 1; if (!condition) throw new Error(message); };
const normalize = (value) => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
};
const shapeContent = (target) => ({ move_target: target, decision: "Do the bounded Move", orientation: "Prefer contact over abstraction", immediate_why: "The live obligation is here", reason_chain_handles: ["project:test"], exit_condition: "One bounded result exists", degrees_of_freedom: ["wording"], quick_check_adjustments: ["location"], help_required_conditions: ["target changes"], invalidation_conditions: ["target disappears"], anticipated_obstacles: ["fatigue"], completion_evidence: ["saved result"], installation_requirements: ["open workspace"], first_physical_action: "Open the workspace", interruption_handling: "Return through the cockpit", cockpit_cues: ["show exit"], uncertainty: "Energy may change", purpose_handle: { id: "purpose", label: "Purpose" } });
const proposal = (id, version, status, target) => ({ id, proposal_version: version, proposal_content: shapeContent(target), machine_interpretation: {}, proposal_status: status, created_at: `2026-07-31T00:00:0${version}Z` });
const initialState = () => ({ loop_status: "active", authoritative_phase: "sense", current_step: "sense_entry", working_state: {}, purpose_handle: { id: "purpose", label: "Purpose" }, orientation_handle: { id: "orientation", label: "Orientation" }, no_active_reason: "never_started", sense_state: { grounded_inputs: [], field_representation: {}, uncertainties: [], material_constraints: [], purpose_orientation_context: {}, sense_completion_basis: null, inherited_residue: null }, shape_proposals: [], proposed_shape: null, installed_shape: null, move_custody: null, active_adjustment: null, metabolize_state: null });

const directApply = async ({ loopId, eventId, action, expectedRevision = null, proposalId = null, proposalVersion = null, input = {}, events, nextState }) => {
  const canonical = normalize({ protocol_version: protocol, loop_id: loopId, action, input, expected_loop_revision: expectedRevision, accepted_proposal_id: proposalId, accepted_proposal_version: proposalVersion, client: { source: "direct_test", shortcut_version: "http-seed-v0.3" } });
  const canonicalText = JSON.stringify(canonical);
  const response = await fetch(`${local.API_URL}/rest/v1/rpc/apply_runtime_events`, { method: "POST", headers: dbHeaders, body: JSON.stringify({ p_loop_id: loopId, p_client_event_id: eventId, p_action: action, p_request_canonical: canonical, p_request_canonical_text: canonicalText, p_request_fingerprint: createHash("sha256").update(canonicalText).digest("hex"), p_expected_loop_revision: expectedRevision, p_accepted_proposal_id: proposalId, p_accepted_proposal_version: proposalVersion, p_events: events, p_protocol_version: protocol, p_prompt_version: "spike1-shape-0.3", p_invocation_source: "direct_test", p_next_state: nextState, p_close_loop: false }) });
  const body = await response.json();
  if (!response.ok) throw new Error(`seed ${action} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const invokeRuntime = async (body) => {
  const response = await fetch(runtimeUrl, { method: "POST", headers: { "content-type": "application/json", "x-ssmm-runtime-secret": runtimeSecret }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const runtimeRequest = ({ action, eventId, loopId, expectedRevision, proposalId, proposalVersion, input = {} }) => ({ action, client_event_id: eventId, loop_id: loopId, expected_loop_revision: expectedRevision, ...(proposalId ? { accepted_proposal_id: proposalId, accepted_proposal_version: proposalVersion } : {}), input, client: { source: "direct_test", shortcut_version: "http-authority-v0.3" } });
const getLoop = async (loopId) => {
  const response = await fetch(`${local.API_URL}/rest/v1/rpc/get_loop_state`, { method: "POST", headers: dbHeaders, body: JSON.stringify({ p_loop_id: loopId }) });
  if (!response.ok) throw new Error(`get loop failed: ${response.status}`);
  return await response.json();
};
const count = async (path) => {
  const response = await fetch(`${local.API_URL}/rest/v1/${path}`, { headers: dbHeaders });
  if (!response.ok) throw new Error(`count query failed: ${response.status}`);
  return (await response.json()).length;
};

const opened = await directApply({ loopId: null, eventId: `http-seed-open-${randomUUID()}`, action: "open_current_surface", expectedRevision: 0, events: [{ event_type: "loop_created", actor: "system", perspective: "lr_system_evidence", payload: {} }, { event_type: "sense_started", actor: "system", perspective: "lr_system_evidence", payload: {} }], nextState: initialState() });
const loopId = opened.loop.loop_id;
const proposalA = proposal(randomUUID(), 1, "proposed", "Proposal A");
const proposedA = await directApply({ loopId, eventId: `http-seed-a-${randomUUID()}`, action: "request_shape_proposal", expectedRevision: 1, input: { sense_completion_basis: "enough" }, events: [{ event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} }], nextState: { ...opened.loop, authoritative_phase: "shape", current_step: "shape_review", shape_proposals: [proposalA], proposed_shape: proposalA } });
const proposalB = proposal(randomUUID(), 2, "proposed", "Proposal B");
await directApply({ loopId, eventId: `http-seed-b-${randomUUID()}`, action: "correct_shape_proposal", expectedRevision: 2, input: { correction: "Use proposal B" }, events: [{ event_type: "shape_proposal_corrected", actor: "levi", perspective: "ul_levi_report", payload: {} }, { event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} }], nextState: { ...proposedA.loop, shape_proposals: [{ ...proposalA, proposal_status: "superseded" }, proposalB], proposed_shape: proposalB } });

const staleEventId = `http-stale-accept-${randomUUID()}`;
const eventsBefore = await count(`events?loop_id=eq.${loopId}&select=id`);
const stale = await invokeRuntime(runtimeRequest({ action: "accept_shape_proposal", eventId: staleEventId, loopId, expectedRevision: 3, proposalId: proposalA.id, proposalVersion: 1, input: { declared_starting_conditions: "At the desk" } }));
assert(stale.status === 409, "stale proposal did not return HTTP 409");
assert(stale.body.error === "conflict" && stale.body.category === "stale_proposal", "stale proposal response did not use the stable conflict schema");
assert(stale.body.current_loop_revision === 3, "stale proposal response omitted the current revision");
assert(stale.body.current_proposal_id === proposalB.id && stale.body.current_proposal_version === 2, "stale proposal response omitted current proposal identity");
const afterStale = await getLoop(loopId);
assert(afterStale.authoritative_revision === 3 && afterStale.proposed_shape.id === proposalB.id, "stale proposal mutated projection or revision");
assert(await count(`events?loop_id=eq.${loopId}&select=id`) === eventsBefore, "stale proposal produced an event");
assert(await count(`runtime_requests?client_event_id=eq.${staleEventId}&select=client_event_id`) === 0, "stale proposal produced a ledger entry");

const rejectId = `http-reject-${randomUUID()}`;
const rejectRequest = runtimeRequest({ action: "reject_shape_proposal", eventId: rejectId, loopId, expectedRevision: 3, input: { reason: "Test rejection" } });
const rejected = await invokeRuntime(rejectRequest);
assert(rejected.status === 200 && rejected.body.loop_revision === 4, "successful mutation did not return incremented revision");
const replay = await invokeRuntime(rejectRequest);
assert(replay.status === 200 && replay.body.receipt.idempotent_replay === true, "identical semantic request did not replay");
assert(replay.body.loop_revision === 4, "identical replay did not return original revision");
const changedAction = await invokeRuntime({ ...rejectRequest, action: "submit_sense_input" });
assert(changedAction.status === 409 && changedAction.body.category === "idempotency_fingerprint_conflict", "different action did not conflict");
const changedPayload = await invokeRuntime({ ...rejectRequest, input: { reason: "Different reason" } });
assert(changedPayload.status === 409 && changedPayload.body.category === "idempotency_fingerprint_conflict", "different payload did not conflict");
const changedRevision = await invokeRuntime({ ...rejectRequest, expected_loop_revision: 4 });
assert(changedRevision.status === 409 && changedRevision.body.category === "idempotency_fingerprint_conflict", "different expected revision did not conflict");

const restored = await invokeRuntime(runtimeRequest({ action: "open_current_surface", eventId: `http-restore-${randomUUID()}`, loopId, expectedRevision: null }));
assert(restored.status === 200 && restored.body.loop_revision === 4, "read-only restoration did not return current revision");
assert(restored.body.receipt.persisted === false && restored.body.receipt.event_id === null, "read-only restoration persisted an event");
assert((await getLoop(loopId)).authoritative_revision === 4, "read-only restoration incremented revision");

console.log(`PASS HTTP authority integrity: ${checks}/${checks} adversarial assertions`);
