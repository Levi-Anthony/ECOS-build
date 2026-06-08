// Shared OUTPUT schemas for ecb-mcp tools.
//
// These mirror the canonical domain types in apps/crm-dashboard/lib/supabase.ts
// so the dashboard and the MCP surface stay in lockstep. They are consumed as a
// tool's `outputSchema` and validated by the MCP SDK against the handler's
// `structuredContent` (see lib/format.ts → structuredResult).
//
// Design rules (see tools/CONVENTION.md):
//   • `outputSchema` wants a ZodRawShape (a plain object of validators), the same
//     shape style as `inputSchema`. Entity schemas below are ZodObjects so they
//     can nest inside arrays/objects; the envelope factories return raw shapes
//     ready to drop straight into `outputSchema`.
//   • Be generous about absence: any column that is nullable in the DB, or any
//     field a handler may omit, is `.nullable()` and/or `.optional()`. The SDK
//     throws only on a MISSING REQUIRED field or a WRONG TYPE — extra fields are
//     stripped silently, so erring toward optional is safe.
//   • Required fields are limited to stable identity/content a handler ALWAYS
//     returns (e.g. id, name, content).

import { z } from "zod";

// ─── Envelope factories (the repeated output shapes) ─────────────────────────

/** List/search result: `{ items: Item[], count }`. structuredContent must be an
 *  object, never a bare array — this is the canonical wrapper for collections. */
export const listOf = (item: z.ZodTypeAny) => ({
  items: z.array(item).describe("Result rows, in the order returned"),
  count: z.number().int().describe("Number of items in this result"),
});

/** Write/mutation result: identity of the written row plus optional extras.
 *  `ok` is always true on the success path (errors return errorResult instead). */
export const writeResult = (extra: z.ZodRawShape = {}) => ({
  ok: z.boolean().describe("Always true on the success path"),
  id: z.string().nullable().describe("UUID of the affected row, or null when not applicable"),
  ...extra,
});

/** Patch/propose result: whether the change applied immediately (live_audit) or
 *  was routed to a pending human-review proposal (human_gate / authority ops). */
export const proposalResult = {
  applied: z.boolean().describe("true if the patch applied immediately; false if a proposal was opened"),
  proposal_id: z.string().nullable().describe("Pending proposal UUID when applied=false, else null"),
  version: z.number().int().nullable().describe("New artifact version when applied=true, else null"),
  status: z.string().nullable().optional().describe("Proposal status when a proposal was opened"),
  summary: z.string().optional().describe("Human-readable summary of the change"),
};

// ─── CRM: contacts, interactions, opportunities ──────────────────────────────

/** Summary contact row as returned by search/list/by-domain tools. */
export const ContactSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  relationship_domain: z.string(),
  administrative_status: z.string().nullable().optional(),
  follow_up_date: z.string().nullable().optional(),
  last_contacted: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});

/** Full contact row (get_contact_history header, add/update echoes). */
export const ContactSchema = ContactSummarySchema.extend({
  entity_id: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  community_role: z.string().nullable().optional(),
  music_role: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const InteractionSchema = z.object({
  id: z.string(),
  interaction_type: z.string(),
  summary: z.string().nullable().optional(),
  follow_up_notes: z.string().nullable().optional(),
  occurred_at: z.string(),
});

export const OpportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: z.string(),
  value: z.number().nullable().optional(),
  close_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ─── BRAIN: thoughts ─────────────────────────────────────────────────────────

/** A thought atom as surfaced by search/list/get tools. Never includes the
 *  embedding vector. `similarity` is present only on semantic-search results. */
export const ThoughtSchema = z.object({
  id: z.string(),
  content: z.string(),
  original_content: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().nullable().optional(),
  similarity: z.number().optional().describe("Cosine similarity 0–1; semantic-search results only"),
});

/** Batch get_thoughts adds a found/missing split alongside the resolved atoms. */
export const ThoughtBatchSchema = {
  items: z.array(ThoughtSchema),
  count: z.number().int(),
  requested: z.number().int().describe("How many IDs were asked for"),
  missing: z.array(z.string()).describe("Requested IDs that did not resolve"),
};

export const ThoughtStatsSchema = {
  total: z.number().int(),
  date_range: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  types: z.record(z.string(), z.number()),
  top_topics: z.record(z.string(), z.number()),
  top_people: z.record(z.string(), z.number()),
};

// ─── Artifacts (v2/v3) ───────────────────────────────────────────────────────

/** Artifact manifest header — identity, version, review policy, metadata. */
export const ArtifactManifestSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  review_policy: z.string().describe("live_audit | human_gate"),
  current_version: z.number().int(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const ArtifactBlockSchema = z.object({
  id: z.string().optional(),
  path: z.string(),
  title: z.string().nullable().optional(),
  content: z.string(),
  content_hash: z.string().nullable().optional(),
  version: z.number().int().optional(),
  sort_order: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const ArtifactChangeProposalSchema = z.object({
  id: z.string(),
  artifact_id: z.string(),
  base_version: z.number().int(),
  ops: z.array(z.record(z.string(), z.unknown())),
  summary: z.string(),
  proposer_actor_type: z.string(),
  proposer_actor_id: z.string().nullable().optional(),
  review_policy_at_proposal: z.string(),
  status: z.string(),
  review_reason: z.string().nullable().optional(),
  applied_version: z.number().int().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const ArtifactSnapshotSchema = z.object({
  id: z.string(),
  artifact_id: z.string().optional(),
  version: z.number().int(),
  content: z.string().nullable().optional(),
  blocks: z.array(ArtifactBlockSchema).optional(),
  created_at: z.string().optional(),
});

// ─── Handoff stream + snapshots ───────────────────────────────────────────────

export const HandoffEventSchema = z.object({
  id: z.string(),
  event_seq: z.number().int().optional(),
  session_id: z.string().nullable().optional(),
  surface: z.string().nullable().optional(),
  event_type: z.string().optional(),
  content: z.string().optional(),
  refs: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  occurred_at: z.string().nullable().optional(),
  client_ts: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  client_request_id: z.string().nullable().optional(),
});

export const HandoffSnapshotSchema = z.object({
  id: z.string(),
  compiled_at: z.string().nullable().optional(),
  compiled_by: z.string().nullable().optional(),
  source_session_id: z.string().nullable().optional(),
  source_event_ids: z.array(z.string()).nullable().optional(),
  watermark_event_seq: z.number().int().nullable().optional(),
  watermark_occurred_at: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  is_current: z.boolean().nullable().optional(),
  artifact_id: z.string().nullable().optional(),
  client_request_id: z.string().nullable().optional(),
});

// ─── Pulse entries ────────────────────────────────────────────────────────────

export const PulseEntrySchema = z.object({
  id: z.string(),
  session_id: z.string().nullable().optional(),
  surface: z.string().nullable().optional(),
  pulse_type: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  occurred_at: z.string().nullable().optional(),
  client_ts: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  client_request_id: z.string().nullable().optional(),
});

// ─── People: observations, snapshots, BRAIN links ────────────────────────────

export const PersonObservationSchema = z.object({
  id: z.string().optional(),
  observation_type: z.string(),
  content: z.string(),
  confidence: z.number().nullable().optional(),
  domain_context: z.string().nullable().optional(),
  observed_at: z.string().nullable().optional(),
  linked_thought_id: z.string().nullable().optional(),
});

export const PersonSnapshotSchema = z.object({
  snapshot_content: z.string(),
  domains_covered: z.array(z.string()).nullable().optional(),
  compiled_by: z.string().nullable().optional(),
  version: z.number().int().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

export const ThoughtLinkSchema = z.object({
  thought_id: z.string(),
  content_preview: z.string().nullable().optional(),
  linked_at: z.string().nullable().optional(),
});

// ─── Opportunities, briefing ─────────────────────────────────────────────────

export const OpportunityBriefSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
  close_date: z.string().nullable().optional(),
  contact_id: z.string().nullable().optional(),
});

// ─── IT consulting: service logs ──────────────────────────────────────────────

export const ServiceLogSchema = z.object({
  id: z.string(),
  service_date: z.string().nullable().optional(),
  service_type: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  resolution: z.string().nullable().optional(),
  time_spent_minutes: z.number().nullable().optional(),
  billable: z.boolean().nullable().optional(),
  billed: z.boolean().nullable().optional(),
  follow_up_needed: z.boolean().nullable().optional(),
  follow_up_notes: z.string().nullable().optional(),
});

// ─── Entities (general substrate) ─────────────────────────────────────────────

export const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entity_type: z.string(),
  description: z.string().nullable().optional(),
  aliases: z.array(z.string()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

// ─── Taste preferences ────────────────────────────────────────────────────────

export const TastePreferenceSchema = z.object({
  id: z.string(),
  preference_name: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  reject: z.string().nullable().optional(),
  want: z.string().nullable().optional(),
  type_label: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  invocation_count: z.number().nullable().optional(),
  last_invoked_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  thought_id: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  confidence: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});
