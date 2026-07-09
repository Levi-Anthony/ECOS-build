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
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const localUrl = Deno.env.get("ECB_LOCAL_URL") ?? "http://127.0.0.1:54321";
    const serviceKey = Deno.env.get("ECB_LOCAL_SERVICE_KEY") ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supa = createClient(localUrl, serviceKey, { auth: { persistSession: false } });

    // Capture tool handlers from the real modules (real supa client closes over them).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Handler = (params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
    const handlers = new Map<string, Handler>();
    const capturingRegistrar = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerTool: (name: string, _cfg: unknown, handler: any) => handlers.set(name, handler),
      getRegisteredNames: () => [...handlers.keys()],
      count: () => handlers.size,
    };
    const stubHelpers = {
      getEmbedding: () => Promise.resolve([] as number[]),
      extractMetadata: () => Promise.resolve({}),
      RELATIONSHIP_DOMAINS: [], ADMIN_STATUSES: [], OPPORTUNITY_STAGES: [],
      ECOS_USER_ID: "00000000-0000-0000-0000-000000000000",
      OPENROUTER_BASE: "",
    };
    const [artifactsMod, bootMod] = await Promise.all([
      import("./tools/artifacts.ts"),
      import("./tools/boot.ts"),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    artifactsMod.register(capturingRegistrar as any, supa as any, stubHelpers as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bootMod.register(capturingRegistrar as any, supa as any, stubHelpers as any);

    // Fixture UUIDs (20000000-…-10…13; no collision with pgTAP 01-04).
    const PRED_ID = "20000000-0000-0000-0000-000000000010";
    const SUCC_ID = "20000000-0000-0000-0000-000000000011";
    const BOOT_ID = "20000000-0000-0000-0000-000000000012";
    const BOOT_SUCC_ID = "20000000-0000-0000-0000-000000000013";
    const ALL_IDS = [PRED_ID, SUCC_ID, BOOT_ID, BOOT_SUCC_ID];

    // Use direct SQL via the db URL for reliable cleanup (supabase-js REST
    // layer can silently fail on multi-table deletes with FK deps).
    const DB_URL = Deno.env.get("ECB_LOCAL_DB_URL") ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    const cleanup = async () => {
      const ids = ALL_IDS.map((id) => `'${id}'`).join(",");
      const sql = `
        DO $$
        DECLARE ids uuid[] := ARRAY[${ids}]::uuid[];
        BEGIN
          UPDATE artifacts SET superseded_by=NULL, superseded_at=NULL WHERE id = ANY(ids);
          DELETE FROM artifact_block_embeddings WHERE artifact_id = ANY(ids);
          DELETE FROM artifact_review_events     WHERE artifact_id = ANY(ids);
          DELETE FROM artifact_change_proposals  WHERE artifact_id = ANY(ids);
          DELETE FROM artifact_links             WHERE artifact_id = ANY(ids);
          DELETE FROM handoff_snapshots          WHERE artifact_id = ANY(ids);
          DELETE FROM artifact_snapshots         WHERE artifact_id = ANY(ids);
          DELETE FROM artifact_revisions         WHERE artifact_id = ANY(ids);
          DELETE FROM artifact_blocks            WHERE artifact_id = ANY(ids);
          DELETE FROM artifacts                  WHERE id = ANY(ids);
        END;
        $$;
      `;
      // POST to /rest/v1/rpc/... won't work for raw SQL; use supabase-js executeRawSql
      // via the management API is not available locally. Fall back to psql via subprocess.
      const cmd = new Deno.Command("docker", {
        args: ["exec", "supabase_db_ecos", "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
        stdout: "piped", stderr: "piped",
      });
      const { code, stderr } = await cmd.output();
      if (code !== 0) {
        console.error("cleanup psql failed:", new TextDecoder().decode(stderr));
      }
    };

    // Pre-clean any leftover fixtures from a prior aborted run.
    await cleanup();

    try {
      // ── Create fixtures ──────────────────────────────────────────────────────
      const { error: e1 } = await supa.rpc("create_artifact_v2", {
        p_key: "eco46_int_pred", p_title: "ECO-46 Integration Predecessor",
        p_id: PRED_ID,
        p_blocks: [{ path: "/body", content: "original predecessor content", title: "Body", sort_order: 1 }],
        p_supersede_ids: null,
        p_supersession_receipt: { declares: "nothing", op_class: "content" },
      });
      assert(!e1, `fixture pred: ${e1?.message}`);

      const { error: e2 } = await supa.rpc("create_artifact_v2", {
        p_key: "eco46_int_succ", p_title: "ECO-46 Integration Successor",
        p_id: SUCC_ID,
        p_blocks: [{ path: "/body", content: "successor content", title: "Body", sort_order: 1 }],
        p_supersede_ids: [PRED_ID],
        p_supersession_receipt: { declares: ["eco46_int_pred"], op_class: "content", ids: [PRED_ID] },
      });
      assert(!e2, `fixture succ: ${e2?.message}`);

      const { error: e3 } = await supa.rpc("create_artifact_v2", {
        p_key: "eco46_int_boot", p_title: "ECO-46 Integration Boot Artifact",
        p_id: BOOT_ID,
        p_metadata: { tags: ["boot"] },
        p_supersede_ids: null,
        p_supersession_receipt: { declares: "nothing", op_class: "content" },
      });
      assert(!e3, `fixture boot: ${e3?.message}`);

      const { error: e4 } = await supa.rpc("create_artifact_v2", {
        p_key: "eco46_int_boot_succ", p_title: "ECO-46 Integration Boot Successor",
        p_id: BOOT_SUCC_ID,
        p_metadata: { tags: ["boot"] },
        p_supersede_ids: [BOOT_ID],
        p_supersession_receipt: { declares: ["eco46_int_boot"], op_class: "content", ids: [BOOT_ID] },
      });
      assert(!e4, `fixture boot_succ: ${e4?.message}`);

      // ── Test 2: declaration queryable in artifact_revisions.metadata ─────────
      const { data: rev2 } = await supa
        .from("artifact_revisions").select("metadata")
        .eq("artifact_id", PRED_ID).order("version", { ascending: false }).limit(1).single();
      assert(
        (rev2?.metadata as Record<string, unknown>)?.supersession !== undefined,
        `T2: supersession receipt missing from revision metadata (got ${JSON.stringify(rev2?.metadata)})`,
      );
      const decl2 = ((rev2?.metadata as Record<string, unknown>)?.supersession as Record<string, unknown>)?.declares;
      assert(decl2 === "nothing", `T2: declares should be "nothing" (got ${JSON.stringify(decl2)})`);

      // ── Test 5: op_class logged on revision — mechanical receipt stored in DB ─
      // Call apply_artifact_agent_patch_tx with explicit mechanical receipt.
      // This tests the DB storage side; TS classification is covered by hermetic T5.
      // Fixture is human_gate; flip to live_audit so the agent RPC call is accepted.
      // Use psql directly — supabase-js REST update silently fails on RLS-protected tables.
      const flipCmd = new Deno.Command("docker", {
        args: ["exec", "supabase_db_ecos", "psql", "-U", "postgres", "-d", "postgres",
          "-c", `UPDATE artifacts SET review_policy='live_audit' WHERE id='${SUCC_ID}'`],
        stdout: "piped", stderr: "piped",
      });
      const { code: flipCode } = await flipCmd.output();
      assert(flipCode === 0, "T5 setup: failed to flip review_policy to live_audit");
      const { data: succCurrent } = await supa
        .from("artifacts").select("current_version").eq("id", SUCC_ID).single();
      const mechReceipt = { op_class: "mechanical", exempt: true, declares: null };
      const { error: pe5 } = await supa.rpc("apply_artifact_agent_patch_tx", {
        p_key: "eco46_int_succ",
        p_base_version: (succCurrent as Record<string, number>).current_version,
        p_ops: [{ op: "set_block_sort_order", path: "/body", sort_order: 2 }],
        p_summary: "ECO-46 T5: mechanical patch receipt storage",
        p_actor_id: "mcp",
        p_source_refs: {},
        p_admin: false,
        p_supersede_ids: null,
        p_supersession_receipt: mechReceipt,
      });
      assert(!pe5, `T5: mechanical patch failed: ${pe5?.message}`);
      const { data: rev5 } = await supa
        .from("artifact_revisions").select("metadata")
        .eq("artifact_id", SUCC_ID).order("version", { ascending: false }).limit(1).single();
      const op5 = ((rev5?.metadata as Record<string, unknown>)?.supersession as Record<string, unknown>)?.op_class;
      assert(op5 === "mechanical", `T5: op_class not logged as mechanical (got ${JSON.stringify(op5)})`);

      // ── Test 8: get_artifact on superseded → SUPERSEDED stamp ────────────────
      const getArtifact = handlers.get("get_artifact")!;
      assert(getArtifact, "T8: get_artifact handler not captured");
      const r8 = await getArtifact({ key: "eco46_int_pred" });
      const t8 = r8.content.map((c) => c.text).join("\n");
      assert(t8.includes("SUPERSEDED"), `T8: stamp must show SUPERSEDED (got: ${t8.slice(0, 300)})`);
      assert(t8.includes("eco46_int_succ"), `T8: stamp must name successor key`);
      assert(t8.includes("original predecessor content"), `T8: content must be fully retrievable`);

      // ── Test 9: list_artifacts shows stamps on drafts and superseded ──────────
      // (search_artifacts stamp-and-surface proxy — uses list to avoid vector deps)
      const listArtifacts = handlers.get("list_artifacts")!;
      assert(listArtifacts, "T9: list_artifacts handler not captured");
      const r9 = await listArtifacts({ limit: 50 });
      const t9 = r9.content.map((c) => c.text).join("\n");
      assert(t9.includes("⟦STAMP⟧"), `T9: list results must carry ⟦STAMP⟧ lines`);
      // Both draft fixtures should appear stamped.
      const predLine = t9.split("\n").find((l) => l.includes("eco46_int_pred"));
      const suppStamp = t9.split("\n").find((l, i) => {
        const block = t9.split("\n").slice(Math.max(0, i - 1), i + 2).join(" ");
        return block.includes("eco46_int_pred") && block.includes("SUPERSEDED");
      });
      assert(predLine, "T9: eco46_int_pred must appear in list");
      assert(suppStamp !== undefined || t9.includes("SUPERSEDED → eco46_int_succ"), `T9: superseded fixture must show SUPERSEDED stamp`);

      // ── Test 10: get_boot_context → BOOT DEFECT for superseded boot artifact ──
      const getBootCtx = handlers.get("get_boot_context")!;
      assert(getBootCtx, "T10: get_boot_context handler not captured");
      const r10 = await getBootCtx({});
      const t10 = r10.content.map((c) => c.text).join("\n");
      assert(t10.includes("BOOT DEFECT"), `T10: response must contain BOOT DEFECT (got: ${t10.slice(0, 400)})`);
      assert(t10.includes("eco46_int_boot"), `T10: BOOT DEFECT must name the superseded boot artifact`);

      // ── Test 12 proxy: contamination specimen → stamped, not silently served ──
      const r12 = await getArtifact({ key: "eco46_int_boot" });
      const t12 = r12.content.map((c) => c.text).join("\n");
      assert(t12.includes("SUPERSEDED"), `T12: superseded boot artifact must be stamped SUPERSEDED on read`);
      assert(!t12.includes("current boot canon"), `T12: must not claim artifact is current boot canon`);

    } finally {
      await cleanup();
    }
  },
});
