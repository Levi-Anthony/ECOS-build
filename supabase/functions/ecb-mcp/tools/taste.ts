// Taste tools — taste_preferences extension table with audit trail.
// capture_taste_preference dual-writes (taste_preferences row + thoughts mirror).
// update_taste_preference logs every change to taste_evolution.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID, getEmbedding } = helpers;

// === TASTE preferences ===========================================================
// taste_preferences is the structured extension table for taste signals.
// capture_taste_preference dual-writes: a structured row + a thoughts mirror
// (so semantic search continues to surface taste preferences). update_taste_preference
// logs every change to taste_evolution as audit history.

  registrar.registerTool(
  "capture_taste_preference",
  {
    title: "Capture Taste Preference",
    description:
      "Capture a TASTE preference as a structured taste_preferences row, with a thoughts mirror for semantic search. Use after the Taste Harvest Protocol surfaces a candidate and Levi approves it. The Prompt-4 fields are: Preference Name, Domain, Reject (specific and observable), Want (specific and observable), Type (free-form slash-format like 'Session discipline / Process').",
    inputSchema: {
      preference_name: z.string().describe("Short name for the preference"),
      domain: z.string().describe("Where this preference applies"),
      reject: z.string().describe("What to reject — specific and observable"),
      want: z.string().describe("What to do instead — specific and observable"),
      type_label: z.string().describe("Free-form type label, often slash-format (e.g., 'Session discipline / Process')"),
      contact_id: z.string().uuid().optional().describe("Optionally scope this preference to a specific contact"),
      source: z.string().optional().describe("Where this signal came from (defaults to 'mcp:capture_taste_preference')"),
    },
  },
  async ({ preference_name, domain, reject, want, type_label, contact_id, source }) => {
    try {
      const content = `TASTE:: Preference Name: ${preference_name}. Domain: ${domain}. Reject: ${reject} Want: ${want} Type: ${type_label}.`;

      const { data: tasteRow, error: tasteErr } = await supabase
        .from("taste_preferences")
        .insert({
          user_id: ECOS_USER_ID,
          preference_name,
          domain,
          reject,
          want,
          type_label,
          constraint_text: content,
          source: source ?? "mcp:capture_taste_preference",
          contact_id: contact_id ?? null,
          status: "active",
        })
        .select("id")
        .single();
      if (tasteErr || !tasteRow) {
        return { content: [{ type: "text" as const, text: `Failed to insert taste_preferences row: ${tasteErr?.message ?? "no row returned"}` }], isError: true };
      }

      const embedding = await getEmbedding(content);
      const { data: thoughtRow, error: thoughtErr } = await supabase
        .from("thoughts")
        .insert({
          content,
          original_content: content,
          embedding,
          metadata: {
            signal_type: "taste",
            domain,
            type: "observation",
            topics: [domain, "taste-preference"],
            taste_preference_id: tasteRow.id,
            source: "mcp:capture_taste_preference",
          },
        })
        .select("id")
        .single();
      if (thoughtErr || !thoughtRow) {
        return { content: [{ type: "text" as const, text: `taste_preferences row inserted (${tasteRow.id}) but thoughts mirror failed: ${thoughtErr?.message ?? "no row returned"}` }], isError: true };
      }

      const { error: linkErr } = await supabase
        .from("taste_preferences")
        .update({ thought_id: thoughtRow.id })
        .eq("id", tasteRow.id);
      if (linkErr) {
        return { content: [{ type: "text" as const, text: `Both rows created (taste=${tasteRow.id}, thought=${thoughtRow.id}) but back-link failed: ${linkErr.message}` }], isError: true };
      }

      return {
        content: [{
          type: "text" as const,
          text: `Captured taste preference ${tasteRow.id} ↔ thought ${thoughtRow.id}\nName: ${preference_name}\nDomain: ${domain}\nType: ${type_label}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

  registrar.registerTool(
  "update_taste_preference",
  {
    title: "Update Taste Preference",
    description:
      "Update a taste_preferences row. Logs the change to taste_evolution as an audit row (taste_id, change_type, old_value, new_value, reason). Use change_type 'refined' for content changes, 'archived' to retire, 'upgraded'/'downgraded' for status shifts.",
    inputSchema: {
      id: z.string().uuid(),
      changes: z.object({
        preference_name: z.string().optional(),
        domain: z.string().optional(),
        reject: z.string().optional(),
        want: z.string().optional(),
        type_label: z.string().optional(),
        status: z.enum(["active", "archived", "superseded"]).optional(),
        invocation_count: z.number().int().nonnegative().optional(),
        evidence: z.string().nullable().optional().describe("Human-readable provenance of why this preference exists"),
        confidence: z.enum(["low", "medium", "high"]).nullable().optional().describe("Durability assessment: low/medium/high or null"),
      }),
      change_type: z.enum(["upgraded", "downgraded", "refined", "archived"]),
      reason: z.string().describe("Why this change is being made"),
    },
  },
  async ({ id, changes, change_type, reason }) => {
    try {
      const { data: existing, error: fetchErr } = await supabase
        .from("taste_preferences")
        .select("*")
        .eq("id", id)
        .single();
      if (fetchErr || !existing) {
        return { content: [{ type: "text" as const, text: `Not found: ${fetchErr?.message ?? "no row"}` }], isError: true };
      }

      const newValue = { ...existing, ...changes };
      const { error: evoErr } = await supabase.from("taste_evolution").insert({
        taste_id: id,
        change_type,
        old_value: JSON.stringify(existing),
        new_value: JSON.stringify(newValue),
        reason,
        approved: true,
        applied_at: new Date().toISOString(),
      });
      if (evoErr) {
        return { content: [{ type: "text" as const, text: `Failed to log evolution row: ${evoErr.message}` }], isError: true };
      }

      const { error: updateErr } = await supabase
        .from("taste_preferences")
        .update(changes)
        .eq("id", id);
      if (updateErr) {
        return { content: [{ type: "text" as const, text: `Evolution logged but update failed: ${updateErr.message}` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: `Updated taste preference ${id} (${change_type}); audit row logged.` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

  registrar.registerTool(
  "list_taste_preferences",
  {
    title: "List Taste Preferences",
    description:
      "List taste preferences with optional filters. Returns active preferences first by default, sorted by invocation_count DESC then most recent. Use this to retrieve the operative taste profile before sessions or to find candidates for refinement.",
    inputSchema: {
      domain: z.string().optional().describe("Filter by domain"),
      status: z.enum(["active", "archived", "superseded"]).optional().describe("Filter by status (defaults to all)"),
      limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)"),
    },
  },
  async ({ domain, status, limit }) => {
    try {
      let q = supabase
        .from("taste_preferences")
        .select("id, preference_name, domain, reject, want, type_label, status, invocation_count, last_invoked_at, created_at, thought_id, evidence, confidence, source")
        .order("status", { ascending: true })
        .order("invocation_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit ?? 50);
      if (domain) q = q.eq("domain", domain);
      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: "No taste preferences found." }] };

      const lines: string[] = [`${data.length} taste preference(s):\n`];
      for (const row of data as Array<{ id: string; preference_name: string | null; domain: string | null; type_label: string | null; status: string; invocation_count: number; reject: string | null; want: string | null; evidence: string | null; confidence: string | null; source: string | null }>) {
        lines.push(`• [${row.status}] ${row.preference_name ?? "(unnamed)"} — ${row.type_label ?? ""}${row.domain ? " · " + row.domain : ""}`);
        if (row.reject) lines.push(`  Reject: ${row.reject.slice(0, 120)}${row.reject.length > 120 ? "…" : ""}`);
        if (row.want) lines.push(`  Want: ${row.want.slice(0, 120)}${row.want.length > 120 ? "…" : ""}`);
        lines.push(`  ID: ${row.id} · invocations: ${row.invocation_count}${row.confidence ? " · confidence: " + row.confidence : ""}${row.source ? " · source: " + row.source : ""}`);
        if (row.evidence) lines.push(`  Evidence: ${row.evidence.slice(0, 160)}${row.evidence.length > 160 ? "…" : ""}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

};
