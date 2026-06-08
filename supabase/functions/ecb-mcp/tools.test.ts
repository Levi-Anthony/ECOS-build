// Meta-test: enforces the tool-authoring contract (see tools/CONVENTION.md).
//
// Every tool in EXPECTED_FULL_CONTRACT must declare a non-empty description, an
// `annotations` preset, and an `outputSchema` whose values are Zod schemas. This
// guards the whole ECB surface — all 58 tools across 13 modules.
//
// Hermetic: we drive each module's register() with a fake registrar that captures
// (name, config) and a fake helpers bundle. Some modules (e.g. brain-bridge) do a
// runtime value-import from helpers.ts, whose module load validates env vars, so
// we set throwaway env values and dynamic-import the modules after.
//
// Run:  deno test supabase/functions/ecb-mcp/tools.test.ts

import type { Helpers, TrackedRegistrar } from "./helpers.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// Throwaway env so helpers.ts module-load validation passes (no real secrets).
Deno.env.set("MCP_ACCESS_KEY", "test");
Deno.env.set("OPENROUTER_API_KEY", "test");
Deno.env.set("SUPABASE_URL", "http://localhost");
Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "test" }));

// Dynamic-import every tool module after env is set.
const modules = await Promise.all([
  import("./tools/contacts.ts"),
  import("./tools/thoughts.ts"),
  import("./tools/artifacts.ts"),
  import("./tools/boot.ts"),
  import("./tools/handoff.ts"),
  import("./tools/pulse.ts"),
  import("./tools/observations.ts"),
  import("./tools/brain-bridge.ts"),
  import("./tools/briefing.ts"),
  import("./tools/opportunities.ts"),
  import("./tools/billing.ts"),
  import("./tools/entities.ts"),
  import("./tools/taste.ts"),
]);

// ─── Tools that must satisfy the FULL contract (all 58) ──────────────────────
const EXPECTED_FULL_CONTRACT: string[] = [
  // contacts (8)
  "add_contact", "search_contacts", "log_interaction", "get_contact_history",
  "get_follow_ups_due", "update_contact", "get_contacts_by_domain", "set_administrative_status",
  // thoughts / BRAIN (8)
  "search_thoughts", "list_thoughts", "thought_stats", "capture_thought",
  "update_thought", "delete_thought", "get_thought", "get_thoughts",
  // artifacts (15)
  "create_artifact", "get_artifact_manifest", "get_artifact_block", "patch_artifact",
  "search_artifacts", "checkpoint_artifact", "get_artifact_snapshot", "get_artifact",
  "list_artifacts", "link_artifact", "propose_artifact_patch",
  "list_artifact_change_proposals", "get_artifact_change_proposal", "replace_artifact_body",
  "reindex_artifact_embeddings",
  // boot (1)
  "get_boot_context",
  // handoff (4)
  "list_handoff_events", "get_latest_handoff_snapshot", "append_handoff_event", "save_handoff_snapshot",
  // pulse (2)
  "list_recent_pulse", "log_pulse",
  // observations (4)
  "add_person_observation", "get_person_observations", "compile_person_snapshot", "get_person_card",
  // brain-bridge (3)
  "link_thought_to_contact", "get_linked_thoughts", "search_brain_for_contact",
  // briefing (1)
  "get_briefing_context",
  // opportunities (1)
  "create_opportunity",
  // billing (5)
  "log_service_call", "get_client_service_history", "get_unbilled_work",
  "create_billing_entry", "update_billing_status",
  // entities (3)
  "add_entity", "search_entities", "link_entities",
  // taste (3)
  "capture_taste_preference", "update_taste_preference", "list_taste_preferences",
];

// ─── Harness ──────────────────────────────────────────────────────────────────
interface Captured { name: string; config: Record<string, unknown> }

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function isZodSchema(v: unknown): boolean {
  return !!v && (typeof v === "object" || typeof v === "function") &&
    typeof (v as { safeParse?: unknown }).safeParse === "function";
}

const captured: Captured[] = [];
const registrar = {
  registerTool: (name: string, config: Record<string, unknown>) => {
    captured.push({ name, config });
  },
  getRegisteredNames: () => captured.map((c) => c.name),
  count: () => captured.length,
} as unknown as TrackedRegistrar;

const helpers = {
  getEmbedding: () => Promise.resolve([] as number[]),
  extractMetadata: () => Promise.resolve({}),
  RELATIONSHIP_DOMAINS: ["tango", "ttc", "outreach", "it", "music", "personal", "general"],
  ADMIN_STATUSES: ["active", "passive", "administrative_closed", "community"],
  OPPORTUNITY_STAGES: ["prospect", "qualified", "proposal", "closed_won", "closed_lost"],
  ECOS_USER_ID: "00000000-0000-0000-0000-000000000000",
  OPENROUTER_BASE: "https://openrouter.ai/api/v1",
} as unknown as Helpers;

const supabase = {} as unknown as SupabaseClient;

for (const m of modules) {
  (m as { register: (r: TrackedRegistrar, s: SupabaseClient, h: Helpers) => void })
    .register(registrar, supabase, helpers);
}

const byName = new Map(captured.map((t) => [t.name, t.config]));

// ─── Tests ────────────────────────────────────────────────────────────────────
Deno.test("all modules register exactly the expected 58 tools", () => {
  assert(
    captured.length === EXPECTED_FULL_CONTRACT.length,
    `expected ${EXPECTED_FULL_CONTRACT.length} tools, captured ${captured.length}`,
  );
  for (const name of EXPECTED_FULL_CONTRACT) {
    assert(byName.has(name), `expected tool "${name}" was not registered`);
  }
});

Deno.test("every registered tool has a non-empty description", () => {
  for (const { name, config } of captured) {
    const d = config.description;
    assert(typeof d === "string" && d.trim().length > 0, `tool "${name}" has no description`);
  }
});

Deno.test("every tool declares annotations + a Zod-shaped outputSchema", () => {
  for (const name of EXPECTED_FULL_CONTRACT) {
    const c = byName.get(name) as Record<string, unknown>;
    assert(c !== undefined, `expected tool "${name}" was not registered`);
    assert(
      c.annotations !== undefined && typeof c.annotations === "object",
      `tool "${name}" is missing an annotations preset`,
    );
    const out = c.outputSchema;
    assert(
      out !== undefined && typeof out === "object" && !Array.isArray(out),
      `tool "${name}" is missing an outputSchema object`,
    );
    const entries = Object.entries(out as Record<string, unknown>);
    assert(entries.length > 0, `tool "${name}" has an empty outputSchema`);
    for (const [field, schema] of entries) {
      assert(isZodSchema(schema), `tool "${name}" outputSchema.${field} is not a Zod schema`);
    }
  }
});
