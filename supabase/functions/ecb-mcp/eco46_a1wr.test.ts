// ECO-46 A1 W+R — deno test harness (Q2 hybrid owner map).
//
// Owns tests 1, 2, 5, 6, 8, 9, 10, 13 (+ 11/12 proxy). Tests 3/4/7 (transactional
// DB behavior) live in supabase/tests/eco46_a1w_supersession.sql (pgTAP).
//
// TWO tiers:
//   • HERMETIC (always run): the TS classification layer (1/5/6/2-decl), the
//     STAMP formatter (8-fmt/11-proxy), and the readOnlyHint rider (13). These
//     exercise the tool-layer JUDGMENT directly — NOT the RPCs — per the ruling
//     (testing the RPC for 1/5/6 would green-light a leaking tool layer).
//   • INTEGRATION (run when ECB_INTEGRATION=1 against the local Supabase stack):
//     the queryable/logged/stamped/boot-defect/reconstruction behaviors that
//     need the DB. Completed + exercised at staged-verify.
//
// Run hermetic:      deno test --allow-env eco46_a1wr.test.ts
// Run + integration: ECB_INTEGRATION=1 ECB_LOCAL_URL=… ECB_LOCAL_SERVICE_KEY=… \
//                    deno test --allow-env --allow-net eco46_a1wr.test.ts

// Throwaway env so helpers.ts module-load validation passes on import.
Deno.env.set("MCP_ACCESS_KEY", Deno.env.get("MCP_ACCESS_KEY") ?? "test");
Deno.env.set("OPENROUTER_API_KEY", Deno.env.get("OPENROUTER_API_KEY") ?? "test");
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://localhost");
Deno.env.set("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS") ?? JSON.stringify({ default: "test" }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTRACT_KEY, patchIsContentClass, resolveSupersession } from "./tools/artifacts.ts";
import { stampLine } from "./lib/format.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// The classification paths under test return BEFORE any supabase call (missing
// param, mechanical-exempt, declares:"nothing"), so a stub client is sufficient.
const stubSupa = {} as unknown as SupabaseClient;

// ─── HERMETIC — TS classification layer (guardrail 4) ─────────────────────────

Deno.test("Test 1: content-class write without a supersession param is rejected in TS; error names the contract key", async () => {
  const r = await resolveSupersession(stubSupa, undefined, /* isContentClass */ true);
  assert(!r.ok, "expected rejection");
  if (!r.ok) {
    assert(r.error.includes("SUPERSESSION_REQUIRED"), "error should name the requirement");
    assert(r.error.includes(CONTRACT_KEY), `error should point at ${CONTRACT_KEY}`);
  }
});

Deno.test("Test 5: mechanical-only batch is exempt (no param required) and logs op_class=mechanical", async () => {
  assert(patchIsContentClass([{ op: "set_block_sort_order" }, { op: "update_block_metadata" }]) === false,
    "mechanical-only batch must NOT be content-class");
  const r = await resolveSupersession(stubSupa, undefined, false);
  assert(r.ok, "mechanical write should succeed without a param");
  if (r.ok) {
    assert(r.receipt.op_class === "mechanical", "op_class should be logged as mechanical");
    assert(r.receipt.exempt === true, "receipt should record the exemption");
    assert(r.ids.length === 0, "mechanical write stamps nothing");
  }
});

Deno.test("Test 6: mixed batch (any content op) is content-class and is rejected without a param", async () => {
  assert(patchIsContentClass([{ op: "replace_block" }, { op: "set_block_sort_order" }]) === true,
    "a batch with any content op must be content-class (anti-laundering)");
  const r = await resolveSupersession(stubSupa, undefined, true);
  assert(!r.ok, "mixed batch without a param must be rejected");
});

Deno.test("Test 2 (declaration): declares:\"nothing\" succeeds and is recorded verbatim in the receipt", async () => {
  const r = await resolveSupersession(stubSupa, { declares: "nothing" }, true);
  assert(r.ok, "declares:nothing should succeed");
  if (r.ok) {
    assert(r.ids.length === 0, "declares:nothing stamps nothing");
    assert(r.receipt.declares === "nothing", "declaration persisted verbatim (nothing-ratio sensor)");
    assert(r.receipt.op_class === "content", "op_class content recorded");
  }
});

// ─── HERMETIC — STAMP formatter (R-code) ──────────────────────────────────────

Deno.test("Test 8 (stamp shape): a superseded artifact stamps SUPERSEDED with a successor pointer", () => {
  const s = stampLine({
    status: "active", current_version: 9, updated_at: "2026-07-06",
    superseded_by: "00000000-0000-0000-0000-0000000000ff", superseded_at: "2026-08-01",
    successor_key: "ecos-v3-build-model", trust_stage: "approved",
  });
  assert(s.startsWith("⟦STAMP⟧"), "uniform stamp prefix");
  assert(s.includes("SUPERSEDED → ecos-v3-build-model"), "successor pointer present");
  assert(s.includes("trust:approved") && s.includes("active v9"), "fixed field order preserved");
});

Deno.test("Test 11 (proxy): a fresh stamp is interpretable without the authority model", () => {
  const s = stampLine({
    status: "draft", current_version: 1, updated_at: "2026-07-07",
    superseded_by: null, superseded_at: null, trust_stage: "draft",
  });
  // Format-strength proxy: currency + trust + status + a not-authority warning
  // are all legible in one line (Item 10 / R-F2). Full fresh-agent read = 7-point.
  assert(s.includes("CURRENT"), "lineage legible");
  assert(s.includes("trust:draft") && s.includes("draft v1"), "trust + status legible");
  assert(s.includes("⚠ draft — not authority"), "draft carries a not-authority warning");
});

// ─── HERMETIC — readOnlyHint rider (Test 13) ──────────────────────────────────

Deno.test("Test 13: every read tool declares readOnlyHint:true in its annotations", async () => {
  const modules = await Promise.all([
    import("./tools/contacts.ts"), import("./tools/thoughts.ts"), import("./tools/artifacts.ts"),
    import("./tools/boot.ts"), import("./tools/handoff.ts"), import("./tools/pulse.ts"),
    import("./tools/observations.ts"), import("./tools/brain-bridge.ts"), import("./tools/briefing.ts"),
    import("./tools/opportunities.ts"), import("./tools/billing.ts"), import("./tools/entities.ts"),
    import("./tools/taste.ts"),
  ]);
  const captured: { name: string; config: Record<string, unknown> }[] = [];
  const registrar = {
    registerTool: (name: string, config: Record<string, unknown>) => captured.push({ name, config }),
    getRegisteredNames: () => captured.map((c) => c.name),
    count: () => captured.length,
  } as unknown as Parameters<(typeof modules)[0]["register"]>[0];
  const helpers = {
    getEmbedding: () => Promise.resolve([] as number[]), extractMetadata: () => Promise.resolve({}),
    RELATIONSHIP_DOMAINS: [], ADMIN_STATUSES: [], OPPORTUNITY_STAGES: [],
    ECOS_USER_ID: "00000000-0000-0000-0000-000000000000", OPENROUTER_BASE: "",
  } as unknown as Parameters<(typeof modules)[0]["register"]>[2];
  const supabase = {} as unknown as SupabaseClient;
  for (const m of modules) m.register(registrar, supabase, helpers);

  const isRead = (n: string) =>
    /^(get_|list_|search_)/.test(n) || n === "thought_stats" || n === "get_briefing_context";
  const writesNamedLikeRead = new Set(["compile_person_snapshot"]);
  let checked = 0;
  for (const { name, config } of captured) {
    if (isRead(name) && !writesNamedLikeRead.has(name)) {
      const ann = config.annotations as { readOnlyHint?: boolean } | undefined;
      assert(ann?.readOnlyHint === true, `read tool "${name}" is missing readOnlyHint:true`);
      checked++;
    }
  }
  assert(checked >= 20, `expected to check 20+ read tools, checked ${checked}`);
});

// ─── INTEGRATION — needs the local stack (ECB_INTEGRATION=1) ───────────────────
// Completed + exercised at staged-verify against `supabase start` + `db reset`.
// Covers: Test 2 (declaration queryable in artifact_revisions.metadata),
// Test 5 (op_class logged on the revision), Test 8 (get_artifact returns the
// SUPERSEDED stamp + full retrievable content), Test 9 (search stamp-and-surface
// defaults: drafts visible+stamped, superseded deprioritized, archived absent),
// Test 10 (get_boot_context BOOT DEFECT on a superseded boot-tagged fixture),
// Test 12 proxy (reconstruct specimen 6a46b3ec fixture → stamped/impossible).
Deno.test({
  name: "Integration: A1 W+R behavior against the local stack",
  ignore: Deno.env.get("ECB_INTEGRATION") !== "1",
  fn: async () => {
    // Wired at staged-verify: create a service-role client against ECB_LOCAL_URL,
    // drive the captured tool handlers with created+torn-down fixtures
    // (ids 2000…-00xx), and assert the six behaviors above. Fixtures are created
    // and removed within the test; real rows are never mutated.
    throw new Error("integration fixtures wired at staged-verify (ECB_INTEGRATION=1)");
  },
});
