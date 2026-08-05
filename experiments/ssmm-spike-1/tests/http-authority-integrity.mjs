import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const status = execFileSync("supabase", ["status", "-o", "env"], {
  encoding: "utf8",
  env: { ...process.env, DO_NOT_TRACK: "1" },
});
const local = Object.fromEntries(status.split("\n").map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map((match) => [match[1], match[2]]));
if (!local.API_URL || !local.SERVICE_ROLE_KEY) throw new Error("Local Supabase status did not provide required test values");
const runtimeUrl = process.env.SSMM_RUNTIME_URL ?? `${local.API_URL}/functions/v1/ssmm-runtime`;
const runtimeSecret = process.env.SSMM_RUNTIME_SHARED_SECRET;
if (!runtimeSecret) throw new Error("SSMM_RUNTIME_SHARED_SECRET is required");

const dbHeaders = {
  apikey: local.SERVICE_ROLE_KEY,
  authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
  "content-profile": "ssmm_spike1",
  "accept-profile": "ssmm_spike1",
};
const protocol = "spike1-slice-contract-0.3";
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) throw new Error(message);
};
const normalize = (value) => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
};
const shapeContent = (target) => ({
  move_target: target,
  decision: "Do the bounded Move",
  orientation: "Prefer contact over abstraction",
  immediate_why: "The live obligation is here",
  reason_chain_handles: ["project:test"],
  exit_condition: "One bounded result exists",
  degrees_of_freedom: ["wording"],
  quick_check_adjustments: ["location"],
  help_required_conditions: ["target changes"],
  invalidation_conditions: ["target disappears"],
  anticipated_obstacles: ["fatigue"],
  completion_evidence: ["saved result"],
  installation_requirements: ["open workspace"],
  first_physical_action: "Open the workspace",
  interruption_handling: "Return through the cockpit",
  cockpit_cues: ["show exit"],
  uncertainty: "Energy may change",
  purpose_handle: { id: "purpose", label: "Purpose" },
});
const proposal = (id, version, proposalStatus, target) => ({
  id,
  proposal_version: version,
  proposal_content: shapeContent(target),
  machine_interpretation: {},
  proposal_status: proposalStatus,
  created_at: `2026-07-31T00:00:0${version}Z`,
});
const initialState = () => ({
  loop_status: "active",
  authoritative_phase: "sense",
  current_step: "sense_entry",
  working_state: {},
  purpose_handle: { id: "purpose", label: "Purpose" },
  orientation_handle: { id: "orientation", label: "Orientation" },
  no_active_reason: "never_started",
  sense_state: { grounded_inputs: [], field_representation: {}, uncertainties: [], material_constraints: [], purpose_orientation_context: {}, sense_completion_basis: null, inherited_residue: null },
  shape_proposals: [],
  proposed_shape: null,
  installed_shape: null,
  move_custody: null,
  active_adjustment: null,
  metabolize_state: null,
});

const directApply = async ({ loopId, eventId, action, expectedRevision = null, proposalId = null, proposalVersion = null, input = {}, events, nextState }) => {
  const canonical = normalize({
    protocol_version: protocol,
    loop_id: loopId,
    action,
    input,
    expected_loop_revision: expectedRevision,
    accepted_proposal_id: proposalId,
    accepted_proposal_version: proposalVersion,
    client: { source: "direct_test", shortcut_version: "http-seed-v0.3" },
  });
  const canonicalText = JSON.stringify(canonical);
  const response = await fetch(`${local.API_URL}/rest/v1/rpc/apply_runtime_events`, {
    method: "POST",
    headers: dbHeaders,
    body: JSON.stringify({
      p_loop_id: loopId,
      p_client_event_id: eventId,
      p_action: action,
      p_request_canonical: canonical,
      p_request_canonical_text: canonicalText,
      p_request_fingerprint: createHash("sha256").update(canonicalText).digest("hex"),
      p_expected_loop_revision: expectedRevision,
      p_accepted_proposal_id: proposalId,
      p_accepted_proposal_version: proposalVersion,
      p_events: events,
      p_protocol_version: protocol,
      p_prompt_version: "spike1-shape-0.3",
      p_invocation_source: "direct_test",
      p_next_state: nextState,
      p_close_loop: false,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`seed ${action} failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
};
const invokeRuntime = async (body) => {
  const response = await fetch(runtimeUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ssmm-runtime-secret": runtimeSecret },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const runtimeRequest = ({ action, eventId, loopId, expectedRevision, proposalId, proposalVersion, input = {} }) => ({
  action,
  client_event_id: eventId,
  loop_id: loopId,
  expected_loop_revision: expectedRevision,
  ...(proposalId ? { accepted_proposal_id: proposalId, accepted_proposal_version: proposalVersion } : {}),
  input,
  client: { source: "direct_test", shortcut_version: "http-authority-v0.3" },
});
const rows = async (path) => {
  const response = await fetch(`${local.API_URL}/rest/v1/${path}`, { headers: dbHeaders });
  if (!response.ok) throw new Error(`query failed: ${response.status} ${path}`);
  return await response.json();
};
const getLoop = async (loopId) => {
  const response = await fetch(`${local.API_URL}/rest/v1/rpc/get_loop_state`, {
    method: "POST",
    headers: dbHeaders,
    body: JSON.stringify({ p_loop_id: loopId }),
  });
  if (!response.ok) throw new Error(`get loop failed: ${response.status}`);
  return await response.json();
};
const snapshot = async (loopId) => ({
  loop: await getLoop(loopId),
  events: await rows(`events?loop_id=eq.${loopId}&select=client_event_id,event_type,payload&order=sequence_number.asc`),
  proposals: await rows(`shape_proposals?loop_id=eq.${loopId}&select=id,proposal_version,proposal_status&order=proposal_version.asc`),
  installed: await rows(`installed_shapes?loop_id=eq.${loopId}&select=accepted_proposal_id,shape_version,installation_status`),
});
const assertSnapshotEqual = (before, after, label) => {
  assert(JSON.stringify(after) === JSON.stringify(before), `${label} changed events, revision, or projections`);
};
const closeLoop = async (loopId) => {
  const response = await fetch(`${local.API_URL}/rest/v1/main_loops?id=eq.${loopId}`, {
    method: "PATCH",
    headers: { ...dbHeaders, prefer: "return=minimal" },
    body: JSON.stringify({ loop_status: "closed", closed_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`fixture close failed: ${response.status}`);
};

// F-010: meaning-bound idempotency through the actual Edge Function path.
const idempotencyOpen = await directApply({
  loopId: null,
  eventId: `http-idem-open-${randomUUID()}`,
  action: "open_current_surface",
  expectedRevision: 0,
  events: [
    { event_type: "loop_created", actor: "system", perspective: "lr_system_evidence", payload: {} },
    { event_type: "sense_started", actor: "system", perspective: "lr_system_evidence", payload: {} },
  ],
  nextState: initialState(),
});
const idempotencyLoopId = idempotencyOpen.loop.loop_id;
const semanticEventId = `http-semantic-${randomUUID()}`;
const semanticRequest = runtimeRequest({
  action: "submit_sense_input",
  eventId: semanticEventId,
  loopId: idempotencyLoopId,
  expectedRevision: 1,
  input: { grounded_input: "The bounded input" },
});
const semanticSuccess = await invokeRuntime(semanticRequest);
assert(semanticSuccess.status === 200 && semanticSuccess.body.loop_revision === 2, "semantic baseline request did not mutate exactly once");
const afterSemanticSuccess = await snapshot(idempotencyLoopId);

const semanticReplay = await invokeRuntime(semanticRequest);
assert(semanticReplay.status === 200 && semanticReplay.body.receipt.idempotent_replay === true, "same semantic request did not return replay receipt");
assert(semanticReplay.body.loop_revision === semanticSuccess.body.loop_revision, "semantic replay did not return the original revision");
assertSnapshotEqual(afterSemanticSuccess, await snapshot(idempotencyLoopId), "semantic replay");

const idempotencyConflicts = [
  ["different action", { ...semanticRequest, action: "recover_authoritative_state", input: { decision: "mark_unknown", reason: "Different semantic action fixture" } }],
  ["different payload", { ...semanticRequest, input: { grounded_input: "Different bounded input" } }],
  ["different expected revision", { ...semanticRequest, expected_loop_revision: 2 }],
];
for (const [label, request] of idempotencyConflicts) {
  const result = await invokeRuntime(request);
  assert(result.status === 409 && result.body.error === "conflict" && result.body.category === "idempotency_fingerprint_conflict", `${label} did not return stable HTTP 409 fingerprint conflict`);
  assertSnapshotEqual(afterSemanticSuccess, await snapshot(idempotencyLoopId), `${label} conflict`);
}
assert((await rows(`runtime_requests?client_event_id=eq.${semanticEventId}&select=client_event_id`)).length === 1, "idempotency conflicts changed the semantic ledger cardinality");
await closeLoop(idempotencyLoopId);

// F-001: stale proposal rejection and exact current-proposal acceptance.
const opened = await directApply({
  loopId: null,
  eventId: `http-seed-open-${randomUUID()}`,
  action: "open_current_surface",
  expectedRevision: 0,
  events: [
    { event_type: "loop_created", actor: "system", perspective: "lr_system_evidence", payload: {} },
    { event_type: "sense_started", actor: "system", perspective: "lr_system_evidence", payload: {} },
  ],
  nextState: initialState(),
});
const loopId = opened.loop.loop_id;
const proposalA = proposal(randomUUID(), 1, "proposed", "Proposal A");
const proposedA = await directApply({
  loopId,
  eventId: `http-seed-a-${randomUUID()}`,
  action: "request_shape_proposal",
  expectedRevision: 1,
  input: { sense_completion_basis: "enough" },
  events: [{ event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} }],
  nextState: { ...opened.loop, authoritative_phase: "shape", current_step: "shape_review", shape_proposals: [proposalA], proposed_shape: proposalA },
});
const proposalB = proposal(randomUUID(), 2, "proposed", "Proposal B");
await directApply({
  loopId,
  eventId: `http-seed-b-${randomUUID()}`,
  action: "correct_shape_proposal",
  expectedRevision: 2,
  input: { correction: "Use proposal B" },
  events: [
    { event_type: "shape_proposal_corrected", actor: "levi", perspective: "ul_levi_report", payload: {} },
    { event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} },
  ],
  nextState: { ...proposedA.loop, shape_proposals: [{ ...proposalA, proposal_status: "superseded" }, proposalB], proposed_shape: proposalB },
});

const beforeStale = await snapshot(loopId);
const staleEventId = `http-stale-accept-${randomUUID()}`;
const stale = await invokeRuntime(runtimeRequest({
  action: "accept_shape_proposal",
  eventId: staleEventId,
  loopId,
  expectedRevision: 3,
  proposalId: proposalA.id,
  proposalVersion: 1,
  input: { declared_starting_conditions: "At the desk" },
}));
assert(stale.status === 409, "stale proposal did not return HTTP 409");
assert(stale.body.error === "conflict" && stale.body.category === "stale_proposal", "stale proposal did not return the stable conflict category");
assert(stale.body.current_loop_revision === 3, "stale proposal response omitted current revision");
assert(stale.body.current_proposal_id === proposalB.id && stale.body.current_proposal_version === 2, "stale proposal response omitted current proposal identity");
assertSnapshotEqual(beforeStale, await snapshot(loopId), "stale proposal acceptance");
assert((await rows(`runtime_requests?client_event_id=eq.${staleEventId}&select=client_event_id`)).length === 0, "stale proposal created a request-ledger row");

const validAcceptanceId = `http-valid-accept-${randomUUID()}`;
const validAcceptance = await invokeRuntime(runtimeRequest({
  action: "accept_shape_proposal",
  eventId: validAcceptanceId,
  loopId,
  expectedRevision: 3,
  proposalId: proposalB.id,
  proposalVersion: 2,
  input: { declared_starting_conditions: "At the desk" },
}));
assert(validAcceptance.status === 200 && validAcceptance.body.loop_revision === 4, "current proposal acceptance did not succeed exactly once");
const afterValidAcceptance = await snapshot(loopId);
assert(afterValidAcceptance.loop.installed_shape?.accepted_proposal_id === proposalB.id && afterValidAcceptance.loop.installed_shape?.shape_version === 2, "valid acceptance was not bound to proposal B identity and version");
assert(afterValidAcceptance.proposals.find((item) => item.id === proposalA.id)?.proposal_status === "superseded", "valid acceptance incorrectly mutated proposal A");
assert(afterValidAcceptance.proposals.find((item) => item.id === proposalB.id)?.proposal_status === "accepted", "valid acceptance did not make proposal B authoritative");
assert(afterValidAcceptance.events.filter((event) => event.event_type === "shape_proposal_accepted").length === 1, "valid acceptance did not record exactly one acceptance event");
assert((await rows(`runtime_requests?client_event_id=eq.${validAcceptanceId}&accepted_proposal_id=eq.${proposalB.id}&accepted_proposal_version=eq.2&select=client_event_id`)).length === 1, "valid acceptance ledger omitted exact proposal identity");

// Same key, another loop: conflict must precede stale-state or transition handling.
const beforeDifferentLoopConflict = await snapshot(loopId);
const differentLoop = await invokeRuntime({ ...semanticRequest, loop_id: loopId });
assert(differentLoop.status === 409 && differentLoop.body.category === "idempotency_fingerprint_conflict", "same event ID reused for another loop did not return HTTP 409 fingerprint conflict");
assertSnapshotEqual(beforeDifferentLoopConflict, await snapshot(loopId), "different-loop idempotency conflict");

const beforeRestore = await snapshot(loopId);
const restored = await invokeRuntime(runtimeRequest({
  action: "open_current_surface",
  eventId: `http-restore-${randomUUID()}`,
  loopId,
  expectedRevision: null,
}));
assert(restored.status === 200 && restored.body.loop_revision === 4, "read-only restoration did not return current revision");
assert(restored.body.receipt.persisted === false && restored.body.receipt.event_id === null, "read-only restoration persisted an event");
assertSnapshotEqual(beforeRestore, await snapshot(loopId), "read-only restoration");

console.log(`PASS HTTP authority integrity: ${checks}/${checks} adversarial assertions`);
