import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const status = execFileSync("supabase", ["status", "-o", "env"], {
  encoding: "utf8",
  env: { ...process.env, DO_NOT_TRACK: "1" },
});
const local = Object.fromEntries(status.split("\n")
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean)
  .map((match) => [match[1], match[2]]));
if (!local.API_URL || !local.SERVICE_ROLE_KEY) throw new Error("Local Supabase status did not provide required test values");

const headers = {
  apikey: local.SERVICE_ROLE_KEY,
  authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
  "content-profile": "ssmm_spike1",
  "accept-profile": "ssmm_spike1",
};
const protocol = "spike1-slice-contract-0.3";
const prompt = "spike1-shape-0.3";
let checks = 0;
const assert = (condition, message) => { checks += 1; if (!condition) throw new Error(message); };
const normalize = (value) => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
};
const shapeContent = (target) => ({
  move_target: target, decision: "Do the bounded Move",
  orientation: "Prefer contact over abstraction", immediate_why: "The live obligation is here",
  reason_chain_handles: ["project:test"], exit_condition: "One bounded result exists",
  degrees_of_freedom: ["wording"], quick_check_adjustments: ["location"],
  help_required_conditions: ["target changes"], invalidation_conditions: ["target disappears"],
  anticipated_obstacles: ["fatigue"], completion_evidence: ["saved result"],
  installation_requirements: ["open workspace"], first_physical_action: "Open the workspace",
  interruption_handling: "Return through the cockpit", cockpit_cues: ["show exit"],
  uncertainty: "Energy may change", purpose_handle: { id: "purpose", label: "Purpose" },
});
const proposal = (id, version, status, target) => ({
  id, proposal_version: version, proposal_content: shapeContent(target),
  machine_interpretation: {}, proposal_status: status,
  created_at: `2026-07-31T00:00:0${version}Z`,
});
const installedShape = (proposalValue, status = "pending") => ({
  ...proposalValue.proposal_content, accepted_proposal_id: proposalValue.id,
  accepted_by: "levi", accepted_at: "2026-07-31T00:05:00Z",
  installation_actions: status === "pending" ? [] : [{ description: "Opened workspace", evidence: "visible", completed_at: "2026-07-31T00:06:00Z" }],
  installation_status: status, installed_at: status === "installed" ? "2026-07-31T00:07:00Z" : null,
  declared_starting_conditions: "At the desk", small_move_exception: false,
  installation_waiver: null, transition_event_identifier: null,
  shape_version: proposalValue.proposal_version,
});
const initialState = () => ({
  loop_status: "active", authoritative_phase: "sense", current_step: "sense_entry",
  working_state: {}, purpose_handle: { id: "purpose", label: "Purpose" },
  orientation_handle: { id: "orientation", label: "Orientation" }, no_active_reason: "never_started",
  sense_state: { grounded_inputs: [], field_representation: {}, uncertainties: [], material_constraints: [], purpose_orientation_context: {}, sense_completion_basis: null, inherited_residue: null },
  shape_proposals: [], proposed_shape: null, installed_shape: null, move_custody: null,
  active_adjustment: null, metabolize_state: null,
});
const moveCustody = (progress = null) => ({
  move_position: progress ? "active" : "not_started", latest_progress: progress,
  latest_interruption: null, active_friction: null, pause_reason: null,
  last_resumed_at: null, completion_claim: null, evidence_supplied: [],
  current_disposition: null, pending_changed_conditions: null,
});
const semantic = ({ loopId, action, input, expectedRevision, proposalId, proposalVersion }) => normalize({
  protocol_version: protocol, loop_id: loopId, action, input,
  expected_loop_revision: expectedRevision, accepted_proposal_id: proposalId,
  accepted_proposal_version: proposalVersion,
  client: { source: "direct_test", shortcut_version: "race-v0.3" },
});
const requestBody = ({ loopId, eventId, action, input = {}, expectedRevision = null, proposalId = null, proposalVersion = null, events, nextState }) => {
  const canonical = semantic({ loopId, action, input, expectedRevision, proposalId, proposalVersion });
  const canonicalText = JSON.stringify(canonical);
  return {
    p_loop_id: loopId, p_client_event_id: eventId, p_action: action,
    p_request_canonical: canonical, p_request_canonical_text: canonicalText,
    p_request_fingerprint: createHash("sha256").update(canonicalText).digest("hex"),
    p_expected_loop_revision: expectedRevision, p_accepted_proposal_id: proposalId,
    p_accepted_proposal_version: proposalVersion, p_events: events,
    p_protocol_version: protocol, p_prompt_version: prompt,
    p_invocation_source: "direct_test", p_next_state: nextState, p_close_loop: false,
  };
};
const invoke = async (options) => {
  const response = await fetch(`${local.API_URL}/rest/v1/rpc/apply_runtime_events`, { method: "POST", headers, body: JSON.stringify(requestBody(options)) });
  return { status: response.status, body: await response.json(), eventId: options.eventId };
};
const getLoop = async (loopId) => {
  const response = await fetch(`${local.API_URL}/rest/v1/rpc/get_loop_state`, { method: "POST", headers, body: JSON.stringify({ p_loop_id: loopId }) });
  if (!response.ok) throw new Error(`get_loop_state failed: ${response.status}`);
  return await response.json();
};
const query = async (path) => {
  const response = await fetch(`${local.API_URL}/rest/v1/${path}`, { headers });
  if (!response.ok) throw new Error(`query failed ${path}: ${response.status}`);
  return await response.json();
};
const closeFixture = async (loopId) => {
  const response = await fetch(`${local.API_URL}/rest/v1/main_loops?id=eq.${loopId}`, {
    method: "PATCH", headers: { ...headers, prefer: "return=minimal" },
    body: JSON.stringify({ loop_status: "closed", closed_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`fixture close failed: ${response.status}`);
};
const createProposedFixture = async (suffix) => {
  const opened = await invoke({
    loopId: null, eventId: `race-open-${suffix}-${randomUUID()}`, action: "open_current_surface",
    events: [{ event_type: "loop_created", actor: "system", perspective: "lr_system_evidence", payload: {} }, { event_type: "sense_started", actor: "system", perspective: "lr_system_evidence", payload: {} }],
    nextState: initialState(),
  });
  if (opened.status !== 200) throw new Error(`fixture open failed: ${JSON.stringify(opened)}`);
  const loopId = opened.body.loop.loop_id;
  const candidate = proposal(randomUUID(), 1, "proposed", `Proposal ${suffix}`);
  const proposed = await invoke({
    loopId, eventId: `race-proposal-${suffix}-${randomUUID()}`, action: "request_shape_proposal",
    expectedRevision: 1, input: { sense_completion_basis: "enough" },
    events: [{ event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} }],
    nextState: { ...opened.body.loop, authoritative_phase: "shape", current_step: "shape_review", shape_proposals: [candidate], proposed_shape: candidate },
  });
  if (proposed.status !== 200) throw new Error(`fixture proposal failed: ${JSON.stringify(proposed)}`);
  return { loopId, candidate, state: proposed.body.loop };
};
const createAcceptedFixture = async (suffix) => {
  const fixture = await createProposedFixture(suffix);
  const accepted = await invoke({
    loopId: fixture.loopId, eventId: `race-accept-${suffix}-${randomUUID()}`, action: "accept_shape_proposal",
    expectedRevision: 2, proposalId: fixture.candidate.id, proposalVersion: 1,
    input: { declared_starting_conditions: "At the desk" },
    events: [{ event_type: "shape_proposal_accepted", actor: "levi", perspective: "decision", payload: {} }, { event_type: "shape_installation_started", actor: "system", perspective: "lr_system_evidence", payload: {} }],
    nextState: { ...fixture.state, shape_proposals: [{ ...fixture.candidate, proposal_status: "accepted" }], proposed_shape: null, installed_shape: installedShape(fixture.candidate, "pending") },
  });
  if (accepted.status !== 200) throw new Error(`fixture acceptance failed: ${JSON.stringify(accepted)}`);
  return { ...fixture, state: accepted.body.loop };
};
const createMoveFixture = async (suffix) => {
  const fixture = await createAcceptedFixture(suffix);
  const result = await invoke({
    loopId: fixture.loopId, eventId: `race-install-${suffix}-${randomUUID()}`, action: "confirm_shape_installed",
    expectedRevision: 3, proposalId: fixture.candidate.id, proposalVersion: 1,
    input: { conditions_satisfied: true },
    events: [{ event_type: "shape_installed", actor: "levi", perspective: "decision", payload: {} }, { event_type: "parent_entered_move", actor: "system", perspective: "lr_system_evidence", payload: {} }],
    nextState: { ...fixture.state, authoritative_phase: "move", current_step: "move_cockpit", installed_shape: installedShape(fixture.candidate, "installed"), move_custody: moveCustody() },
  });
  if (result.status !== 200) throw new Error(`fixture install failed: ${JSON.stringify(result)}`);
  return { ...fixture, state: result.body.loop };
};

{
  const fixture = await createProposedFixture("correction-acceptance");
  const replacement = proposal(randomUUID(), 2, "proposed", "Proposal replacement");
  const correction = {
    loopId: fixture.loopId, eventId: `race-correct-${randomUUID()}`, action: "correct_shape_proposal", expectedRevision: 2,
    input: { correction: "Use replacement" },
    events: [{ event_type: "shape_proposal_corrected", actor: "levi", perspective: "ul_levi_report", payload: {} }, { event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} }],
    nextState: { ...fixture.state, shape_proposals: [{ ...fixture.candidate, proposal_status: "superseded" }, replacement], proposed_shape: replacement },
  };
  const acceptance = {
    loopId: fixture.loopId, eventId: `race-accept-${randomUUID()}`, action: "accept_shape_proposal", expectedRevision: 2,
    proposalId: fixture.candidate.id, proposalVersion: 1, input: { declared_starting_conditions: "At the desk" },
    events: [{ event_type: "shape_proposal_accepted", actor: "levi", perspective: "decision", payload: {} }, { event_type: "shape_installation_started", actor: "system", perspective: "lr_system_evidence", payload: {} }],
    nextState: { ...fixture.state, shape_proposals: [{ ...fixture.candidate, proposal_status: "accepted" }], proposed_shape: null, installed_shape: installedShape(fixture.candidate, "pending") },
  };
  const results = await Promise.all([invoke(correction), invoke(acceptance)]);
  assert(results.filter((r) => r.status === 200).length === 1, "correction/acceptance race did not produce exactly one success");
  assert(results.filter((r) => r.body?.message === "stale_loop_revision").length === 1, "correction/acceptance loser was not a revision conflict");
  const state = await getLoop(fixture.loopId);
  assert(state.authoritative_revision === 3, "correction/acceptance race incremented revision more than once");
  const ledgers = await query(`runtime_requests?client_event_id=in.(${correction.eventId},${acceptance.eventId})&select=client_event_id`);
  assert(ledgers.length === 1, "correction/acceptance loser created a request ledger row");
  await closeFixture(fixture.loopId);
}

{
  const fixture = await createAcceptedFixture("installation");
  const option = (label) => ({
    loopId: fixture.loopId, eventId: `race-install-${label}-${randomUUID()}`, action: "confirm_shape_installed", expectedRevision: 3,
    proposalId: fixture.candidate.id, proposalVersion: 1, input: { conditions_satisfied: true, label },
    events: [{ event_type: "shape_installed", actor: "levi", perspective: "decision", payload: { label } }, { event_type: "parent_entered_move", actor: "system", perspective: "lr_system_evidence", payload: { label } }],
    nextState: { ...fixture.state, authoritative_phase: "move", current_step: "move_cockpit", installed_shape: installedShape(fixture.candidate, "installed"), move_custody: moveCustody() },
  });
  const results = await Promise.all([invoke(option("first")), invoke(option("second"))]);
  assert(results.filter((r) => r.status === 200).length === 1, "installation race did not produce exactly one success");
  assert(results.filter((r) => r.body?.message === "stale_loop_revision").length === 1, "installation race loser was not a revision conflict");
  const state = await getLoop(fixture.loopId);
  assert(state.authoritative_revision === 4 && state.authoritative_phase === "move", "installation race did not produce one coherent Move revision");
  const seamEvents = await query(`events?loop_id=eq.${fixture.loopId}&event_type=in.(shape_installed,parent_entered_move)&select=event_type`);
  assert(seamEvents.length === 2, "installation race produced duplicate authoritative seam events");
  await closeFixture(fixture.loopId);
}

{
  const fixture = await createMoveFixture("progress");
  const option = (label) => ({
    loopId: fixture.loopId, eventId: `race-progress-${label}-${randomUUID()}`, action: "record_move_progress", expectedRevision: 4,
    input: { progress: { label }, move_position: "active" },
    events: [{ event_type: "move_progress_recorded", actor: "levi", perspective: "ul_levi_report", payload: { label } }, { event_type: "move_position_updated", actor: "system", perspective: "lr_system_evidence", payload: { move_position: "active" } }],
    nextState: { ...fixture.state, move_custody: moveCustody({ label }) },
  });
  const results = await Promise.all([invoke(option("first")), invoke(option("second"))]);
  assert(Boolean(results.find((r) => r.status === 200)), "progress race produced no successful request");
  assert(results.filter((r) => r.body?.message === "stale_loop_revision").length === 1, "progress race loser was not a revision conflict");
  const state = await getLoop(fixture.loopId);
  assert(state.authoritative_revision === 5, "progress race incremented revision more than once");
  const progressEvents = await query(`events?loop_id=eq.${fixture.loopId}&event_type=eq.move_progress_recorded&select=payload`);
  assert(progressEvents.length === 1, "progress race silently persisted both progress writes");
  assert(state.move_custody.latest_progress.label === progressEvents[0].payload.label, "progress projection does not match the one persisted winner");
  await closeFixture(fixture.loopId);
}

console.log(`PASS authority concurrency: ${checks}/${checks} adversarial assertions`);
