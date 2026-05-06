// Observations tools — person intelligence: atomic observations + compiled snapshots.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID } = helpers;

  registrar.registerTool(
  "add_person_observation",
  {
    title: "Add Person Observation",
    description: "Record an analytical observation about a contact — pattern insight, interpretation, hypothesis, or strategy. Separate from interaction event logging.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      observation_type: z.enum(["fact", "observation", "interpretation", "hypothesis", "strategy"]),
      content: z.string().describe("The observation — a standalone statement that makes sense without surrounding context"),
      confidence: z.number().int().min(1).max(5).describe("Confidence 1-5"),
      domain_context: z.string().optional().describe("Domain this observation is scoped to, e.g. 'tango', 'ttc'"),
      observed_at: z.string().optional().describe("ISO timestamp — defaults to now"),
      source: z.string().optional().describe("Source client — defaults to 'claude-code'"),
      linked_thought_id: z.string().uuid().optional().describe("UUID of a BRAIN thought this observation is linked to"),
    },
  },
  async ({ contact_id, observation_type, content, confidence, domain_context, observed_at, source, linked_thought_id }) => {
    try {
      const { data, error } = await supabase
        .from("person_observations")
        .insert({
          contact_id,
          observation_type,
          content,
          confidence,
          domain_context: domain_context ?? null,
          observed_at: observed_at ?? new Date().toISOString(),
          source: source ?? "claude-code",
          linked_thought_id: linked_thought_id ?? null,
        })
        .select("id")
        .single();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Observation recorded — ID: ${data.id}\nType: ${observation_type} | Confidence: ${confidence}/5${domain_context ? ` | Domain: ${domain_context}` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 19: get_person_observations ───────────────────────────────────────
  registrar.registerTool(
  "get_person_observations",
  {
    title: "Get Person Observations",
    description: "Retrieve analytical observations for a contact, grouped by type. Separate from interaction history.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      observation_type: z.enum(["fact", "observation", "interpretation", "hypothesis", "strategy"]).optional().describe("Filter to one type"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ contact_id, observation_type, limit }) => {
    try {
      let q = supabase
        .from("person_observations")
        .select("id, observation_type, content, confidence, domain_context, observed_at, linked_thought_id")
        .eq("contact_id", contact_id)
        .order("observed_at", { ascending: false })
        .limit(limit ?? 20);
      if (observation_type) q = q.eq("observation_type", observation_type);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No observations found for contact ${contact_id}${observation_type ? ` of type ${observation_type}` : ""}.` }] };

      type Obs = { id: string; observation_type: string; content: string; confidence: number; domain_context: string | null; observed_at: string; linked_thought_id: string | null };
      const grouped: Record<string, Obs[]> = {};
      for (const o of data as Obs[]) {
        if (!grouped[o.observation_type]) grouped[o.observation_type] = [];
        grouped[o.observation_type].push(o);
      }

      const lines: string[] = [`${data.length} observation(s) for contact ${contact_id}:\n`];
      for (const [type, items] of Object.entries(grouped)) {
        lines.push(`── ${type.toUpperCase()} (${items.length}) ──`);
        for (const o of items) {
          lines.push(`• [${o.confidence}/5] ${o.content}${o.domain_context ? ` [${o.domain_context}]` : ""}${o.linked_thought_id ? ` ◆ ${o.linked_thought_id}` : ""}`);
          lines.push(`  ${new Date(o.observed_at).toLocaleDateString()} | ID: ${o.id}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 20: compile_person_snapshot ───────────────────────────────────────
  registrar.registerTool(
  "compile_person_snapshot",
  {
    title: "Compile Person Snapshot",
    description: "Write a versioned compiled person card for a contact. Uses compile_snapshot_tx to atomically flip the previous snapshot to is_current=false.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      snapshot_content: z.string().describe("The compiled person card — readable prose summary"),
      domains_covered: z.array(z.string()).optional().describe("Domains this snapshot covers"),
      source_observation_ids: z.array(z.string().uuid()).optional().describe("person_observations UUIDs used as source"),
      source_thought_ids: z.array(z.string().uuid()).optional().describe("BRAIN thought UUIDs used as source"),
    },
  },
  async ({ contact_id, snapshot_content, domains_covered, source_observation_ids, source_thought_ids }) => {
    try {
      const { data, error } = await supabase.rpc("compile_snapshot_tx", {
        p_contact_id: contact_id,
        p_snapshot_content: snapshot_content,
        p_domains_covered: domains_covered ?? [],
        p_source_observation_ids: source_observation_ids ?? [],
        p_source_thought_ids: source_thought_ids ?? [],
        p_compiled_by: "claude-code",
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Person snapshot compiled — ID: ${data}\nContact: ${contact_id}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 21: get_person_card ────────────────────────────────────────────────
  registrar.registerTool(
  "get_person_card",
  {
    title: "Get Person Card",
    description: "Composite person card: contact header, latest compiled snapshot, recent observations grouped by type, and linked BRAIN thoughts. Primary agent entry point for pre-meeting context.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
    },
  },
  async ({ contact_id }) => {
    try {
      const [contactRes, snapshotRes, observationsRes] = await Promise.all([
        supabase.from("professional_contacts").select("*").eq("id", contact_id).single(),
        supabase.from("person_snapshots").select("snapshot_content, domains_covered, compiled_by, version, created_at").eq("contact_id", contact_id).eq("is_current", true).maybeSingle(),
        supabase.from("person_observations").select("observation_type, content, confidence, domain_context, observed_at, linked_thought_id").eq("contact_id", contact_id).order("observed_at", { ascending: false }).limit(10),
      ]);

      if (contactRes.error || !contactRes.data) return { content: [{ type: "text" as const, text: `Contact not found: ${contactRes.error?.message ?? "no row"}` }], isError: true };
      const c = contactRes.data;

      const lines: string[] = [
        `=== ${c.name} ===`,
        c.company ? `Company: ${c.company}` : "",
        c.title ? `Title: ${c.title}` : "",
        `Domain: ${c.relationship_domain} | Status: ${c.administrative_status}`,
        c.email ? `Email: ${c.email}` : "",
        c.phone ? `Phone: ${c.phone}` : "",
        c.follow_up_date ? `Follow-up: ${c.follow_up_date}` : "",
        "",
      ].filter(l => l !== "");

      // Snapshot
      const snap = snapshotRes.data;
      lines.push("── Person Card ──");
      if (snap) {
        lines.push(`v${snap.version} · ${new Date(snap.created_at).toLocaleDateString()} · ${snap.compiled_by}`);
        lines.push(snap.snapshot_content);
      } else {
        lines.push("No compiled snapshot yet.");
      }
      lines.push("");

      // Observations
      type Obs = { observation_type: string; content: string; confidence: number; domain_context: string | null; observed_at: string; linked_thought_id: string | null };
      const obs = (observationsRes.data ?? []) as Obs[];
      if (obs.length) {
        lines.push("── Observations ──");
        const grouped: Record<string, Obs[]> = {};
        for (const o of obs) {
          if (!grouped[o.observation_type]) grouped[o.observation_type] = [];
          grouped[o.observation_type].push(o);
        }
        for (const [type, items] of Object.entries(grouped)) {
          lines.push(`${type}:`);
          for (const o of items) {
            lines.push(`  [${o.confidence}/5] ${o.content}${o.domain_context ? ` [${o.domain_context}]` : ""}`);
          }
        }
        lines.push("");
      }

      // Linked BRAIN thoughts
      const thoughtLinks: unknown[] = Array.isArray(c.thought_links) ? c.thought_links : [];
      if (thoughtLinks.length) {
        lines.push("── BRAIN Links ──");
        type TL = { thought_id: string; content_preview: string; linked_at: string };
        for (const l of thoughtLinks as TL[]) {
          lines.push(`• ${l.thought_id}\n  "${l.content_preview}"`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

};
