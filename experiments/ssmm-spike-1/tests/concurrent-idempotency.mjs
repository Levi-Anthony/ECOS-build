import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const env = Object.fromEntries(execFileSync("supabase", ["status", "-o", "env"], {
  encoding: "utf8",
  env: { ...process.env, DO_NOT_TRACK: "1" },
}).split("\n").map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!env.API_URL || !env.SERVICE_ROLE_KEY) throw new Error("Local Supabase status missing test values");

const headers = {
  apikey: env.SERVICE_ROLE_KEY,
  authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
  "content-type": "application/json",
  "content-profile": "ssmm_spike1",
  "accept-profile": "ssmm_spike1",
};
const protocol = "spike1-slice-contract-0.3";
let checks = 0;
const assert = (ok, message) => {
  checks += 1;
  if (!ok) throw new Error(message);
};
const conflict = (result) => result.status !== 200 &&
  result.body?.code === "40001" &&
  result.body?.message === "stale_loop_revision";
const normalize = (value) => value === null || ["string", "number", "boolean"].includes(typeof value)
  ? value
  : Array.isArray(value)
  ? value.map(normalize)
  : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
const shape = (target) => ({
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
const proposal = (id, version, status, target) => ({
  id,
  proposal_version: version,
  proposal_content: shape(target),
  machine_interpretation: {},
  proposal_status: status,
  created_at: `2026-07-31T00:00:0${version}Z`,
});
const installed = (p, status = "pending") => ({
  ...p.proposal_content,
  accepted_proposal_id: p.id,
  accepted_by: "levi",
  accepted_at: "2026-07-31T00:05:00Z",
  installation_actions: status === "pending" ? [] : [{ description: "Opened workspace", evidence: "visible", completed_at: "2026-07-31T00:06:00Z" }],
  installation_status: status,
  installed_at: status === "installed" ? "2026-07-31T00:07:00Z" : null,
  declared_starting_conditions: "At the desk",
  small_move_exception: false,
  installation_waiver: null,
  transition_event_identifier: null,
  shape_version: p.proposal_version,
});
const initial = () => ({
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
const custody = (progress = null) => ({
  move_position: progress ? "active" : "not_started",
  latest_progress: progress,
  latest_interruption: null,
  active_friction: null,
  pause_reason: null,
  last_resumed_at: null,
  completion_claim: null,
  evidence_supplied: [],
  current_disposition: null,
  pending_changed_conditions: null,
});

const call = async ({ loopId, eventId, action, expected = null, proposalId = null, proposalVersion = null, input = {}, events, next }) => {
  const canonical = normalize({
    protocol_version: protocol,
    loop_id: loopId,
    action,
    input,
    expected_loop_revision: expected,
    accepted_proposal_id: proposalId,
    accepted_proposal_version: proposalVersion,
    client: { source: "direct_test", shortcut_version: "race-v0.3" },
  });
  const text = JSON.stringify(canonical);
  const response = await fetch(`${env.API_URL}/rest/v1/rpc/apply_runtime_events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_loop_id: loopId,
      p_client_event_id: eventId,
      p_action: action,
      p_request_canonical: canonical,
      p_request_canonical_text: text,
      p_request_fingerprint: createHash("sha256").update(text).digest("hex"),
      p_expected_loop_revision: expected,
      p_accepted_proposal_id: proposalId,
      p_accepted_proposal_version: proposalVersion,
      p_events: events,
      p_protocol_version: protocol,
      p_prompt_version: "spike1-shape-0.3",
      p_invocation_source: "direct_test",
      p_next_state: next,
      p_close_loop: false,
    }),
  });
  return { status: response.status, body: await response.json(), eventId };
};
const get = async (loopId) => (await (await fetch(`${env.API_URL}/rest/v1/rpc/get_loop_state`, {
  method: "POST",
  headers,
  body: JSON.stringify({ p_loop_id: loopId }),
})).json());
const rows = async (path) => (await (await fetch(`${env.API_URL}/rest/v1/${path}`, { headers })).json());
const loopEvents = async (loopId) => rows(`events?loop_id=eq.${loopId}&select=client_event_id,event_type,payload&order=sequence_number.asc`);
const requestRows = async (eventIds) => {
  const all = await rows("runtime_requests?select=client_event_id");
  return all.filter((row) => eventIds.includes(row.client_event_id));
};
const mutationEvents = (events, eventIds) => events.filter((event) =>
  eventIds.some((id) => event.client_event_id === id || event.client_event_id.startsWith(`${id}:`))
);
const close = async (loopId) => {
  const response = await fetch(`${env.API_URL}/rest/v1/main_loops?id=eq.${loopId}`, {
    method: "PATCH",
    headers: { ...headers, prefer: "return=minimal" },
    body: JSON.stringify({ loop_status: "closed", closed_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`fixture close failed ${response.status}`);
};

const proposedFixture = async (tag) => {
  const open = await call({
    loopId: null,
    eventId: `race-open-${tag}-${randomUUID()}`,
    action: "open_current_surface",
    expected: 0,
    events: [
      { event_type: "loop_created", actor: "system", perspective: "lr_system_evidence", payload: {} },
      { event_type: "sense_started", actor: "system", perspective: "lr_system_evidence", payload: {} },
    ],
    next: initial(),
  });
  if (open.status !== 200) throw new Error(`fixture open failed ${JSON.stringify(open)}`);
  const loopId = open.body.loop.loop_id;
  const p = proposal(randomUUID(), 1, "proposed", `Proposal ${tag}`);
  const made = await call({
    loopId,
    eventId: `race-proposal-${tag}-${randomUUID()}`,
    action: "request_shape_proposal",
    expected: 1,
    input: { sense_completion_basis: "enough" },
    events: [{ event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} }],
    next: { ...open.body.loop, authoritative_phase: "shape", current_step: "shape_review", shape_proposals: [p], proposed_shape: p },
  });
  if (made.status !== 200) throw new Error(`fixture proposal failed ${JSON.stringify(made)}`);
  return { loopId, p, state: made.body.loop };
};
const acceptedFixture = async (tag) => {
  const f = await proposedFixture(tag);
  const result = await call({
    loopId: f.loopId,
    eventId: `race-accept-${tag}-${randomUUID()}`,
    action: "accept_shape_proposal",
    expected: 2,
    proposalId: f.p.id,
    proposalVersion: 1,
    input: { declared_starting_conditions: "At the desk" },
    events: [
      { event_type: "shape_proposal_accepted", actor: "levi", perspective: "decision", payload: {} },
      { event_type: "shape_installation_started", actor: "system", perspective: "lr_system_evidence", payload: {} },
    ],
    next: { ...f.state, shape_proposals: [{ ...f.p, proposal_status: "accepted" }], proposed_shape: null, installed_shape: installed(f.p) },
  });
  if (result.status !== 200) throw new Error(`fixture accept failed ${JSON.stringify(result)}`);
  return { ...f, state: result.body.loop };
};
const moveFixture = async (tag) => {
  const f = await acceptedFixture(tag);
  const result = await call({
    loopId: f.loopId,
    eventId: `race-install-${tag}-${randomUUID()}`,
    action: "confirm_shape_installed",
    expected: 3,
    proposalId: f.p.id,
    proposalVersion: 1,
    input: { conditions_satisfied: true },
    events: [
      { event_type: "shape_installed", actor: "levi", perspective: "decision", payload: {} },
      { event_type: "parent_entered_move", actor: "system", perspective: "lr_system_evidence", payload: {} },
    ],
    next: { ...f.state, authoritative_phase: "move", current_step: "move_cockpit", installed_shape: installed(f.p, "installed"), move_custody: custody() },
  });
  if (result.status !== 200) throw new Error(`fixture install failed ${JSON.stringify(result)}`);
  return { ...f, state: result.body.loop };
};

{
  const f = await proposedFixture("correction-acceptance");
  const p2 = proposal(randomUUID(), 2, "proposed", "Replacement");
  const correction = {
    loopId: f.loopId,
    eventId: `race-correct-${randomUUID()}`,
    action: "correct_shape_proposal",
    expected: 2,
    input: { correction: "Use replacement" },
    events: [
      { event_type: "shape_proposal_corrected", actor: "levi", perspective: "ul_levi_report", payload: {} },
      { event_type: "shape_proposal_created", actor: "runtime", perspective: "proposal", payload: {} },
    ],
    next: { ...f.state, shape_proposals: [{ ...f.p, proposal_status: "superseded" }, p2], proposed_shape: p2 },
  };
  const acceptance = {
    loopId: f.loopId,
    eventId: `race-accept-${randomUUID()}`,
    action: "accept_shape_proposal",
    expected: 2,
    proposalId: f.p.id,
    proposalVersion: 1,
    input: { declared_starting_conditions: "At the desk" },
    events: [
      { event_type: "shape_proposal_accepted", actor: "levi", perspective: "decision", payload: {} },
      { event_type: "shape_installation_started", actor: "system", perspective: "lr_system_evidence", payload: {} },
    ],
    next: { ...f.state, shape_proposals: [{ ...f.p, proposal_status: "accepted" }], proposed_shape: null, installed_shape: installed(f.p) },
  };
  const options = [correction, acceptance];
  const results = await Promise.all(options.map(call));
  const winner = results.find((result) => result.status === 200);
  const loser = results.find(conflict);
  assert(Boolean(winner), "correction/acceptance race lacked one winner");
  assert(results.filter((result) => result.status === 200).length === 1, "correction/acceptance race had multiple winners");
  assert(Boolean(loser) && results.filter(conflict).length === 1, `correction/acceptance loser was not stale: ${JSON.stringify(results)}`);
  const state = await get(f.loopId);
  const raceEvents = mutationEvents(await loopEvents(f.loopId), options.map((option) => option.eventId));
  assert(state.authoritative_revision === 3, "correction/acceptance race incremented revision more than once");
  assert((await requestRows(options.map((option) => option.eventId))).length === 1, "correction/acceptance loser wrote request ledger");
  assert(raceEvents.length === 2 && raceEvents.every((event) => event.client_event_id === winner.eventId || event.client_event_id.startsWith(`${winner.eventId}:`)), "correction/acceptance loser persisted an event");
  if (winner.eventId === correction.eventId) {
    assert(state.proposed_shape?.id === p2.id && state.installed_shape === null, "correction winner projection is incoherent");
    assert(raceEvents.map((event) => event.event_type).join(",") === "shape_proposal_corrected,shape_proposal_created", "correction winner event history is incoherent");
  } else {
    assert(state.proposed_shape === null && state.installed_shape?.accepted_proposal_id === f.p.id, "acceptance winner projection is incoherent");
    assert(raceEvents.map((event) => event.event_type).join(",") === "shape_proposal_accepted,shape_installation_started", "acceptance winner event history is incoherent");
  }
  await close(f.loopId);
}

{
  const f = await acceptedFixture("installation");
  const option = (tag) => ({
    loopId: f.loopId,
    eventId: `race-install-${tag}-${randomUUID()}`,
    action: "confirm_shape_installed",
    expected: 3,
    proposalId: f.p.id,
    proposalVersion: 1,
    input: { conditions_satisfied: true, tag },
    events: [
      { event_type: "shape_installed", actor: "levi", perspective: "decision", payload: { tag } },
      { event_type: "parent_entered_move", actor: "system", perspective: "lr_system_evidence", payload: { tag } },
    ],
    next: { ...f.state, authoritative_phase: "move", current_step: "move_cockpit", installed_shape: installed(f.p, "installed"), move_custody: custody() },
  });
  const options = [option("one"), option("two")];
  const results = await Promise.all(options.map(call));
  const winner = results.find((result) => result.status === 200);
  assert(results.filter((result) => result.status === 200).length === 1, "installation race lacked exactly one winner");
  assert(results.filter(conflict).length === 1, `installation loser was not stale: ${JSON.stringify(results)}`);
  const state = await get(f.loopId);
  const raceEvents = mutationEvents(await loopEvents(f.loopId), options.map((item) => item.eventId));
  assert(state.authoritative_revision === 4 && state.authoritative_phase === "move" && state.installed_shape?.installation_status === "installed", "installation race produced incoherent state");
  assert(raceEvents.length === 2 && raceEvents.every((event) => event.client_event_id === winner.eventId || event.client_event_id.startsWith(`${winner.eventId}:`)), "installation loser persisted an event");
  assert(raceEvents.map((event) => event.event_type).join(",") === "shape_installed,parent_entered_move", "installation winner event history is incoherent");
  assert(new Set(raceEvents.map((event) => event.payload.tag)).size === 1, "installation event bundle mixed race payloads");
  assert((await requestRows(options.map((item) => item.eventId))).length === 1, "installation loser wrote request ledger");
  await close(f.loopId);
}

{
  const f = await moveFixture("progress");
  const option = (tag) => ({
    loopId: f.loopId,
    eventId: `race-progress-${tag}-${randomUUID()}`,
    action: "record_move_progress",
    expected: 4,
    input: { progress: { tag }, move_position: "active" },
    events: [
      { event_type: "move_progress_recorded", actor: "levi", perspective: "ul_levi_report", payload: { tag } },
      { event_type: "move_position_updated", actor: "system", perspective: "lr_system_evidence", payload: { move_position: "active", tag } },
    ],
    next: { ...f.state, move_custody: custody({ tag }) },
  });
  const options = [option("one"), option("two")];
  const results = await Promise.all(options.map(call));
  const winner = results.find((result) => result.status === 200);
  assert(results.filter((result) => result.status === 200).length === 1, "progress race lacked exactly one winner");
  assert(results.filter(conflict).length === 1, `progress loser was not stale: ${JSON.stringify(results)}`);
  const state = await get(f.loopId);
  const raceEvents = mutationEvents(await loopEvents(f.loopId), options.map((item) => item.eventId));
  assert(state.authoritative_revision === 5, "progress race incremented revision more than once");
  assert(raceEvents.length === 2 && raceEvents.every((event) => event.client_event_id === winner.eventId || event.client_event_id.startsWith(`${winner.eventId}:`)), "progress loser persisted an event");
  assert(raceEvents.map((event) => event.event_type).join(",") === "move_progress_recorded,move_position_updated", "progress winner event history is incoherent");
  assert(state.move_custody.latest_progress.tag === raceEvents[0].payload.tag, "progress projection disagrees with winner event");
  assert((await requestRows(options.map((item) => item.eventId))).length === 1, "progress loser wrote request ledger");
  await close(f.loopId);
}

console.log(`PASS authority concurrency: ${checks}/${checks} adversarial assertions`);
