// Observations tools — person intelligence: atomic observations + compiled snapshots.
//
// Contract convention: see ./CONVENTION.md.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY, WRITE_APPEND, WRITE_TRANSACTIONAL } from "../lib/annotations.ts";
import { errorResult, structuredResult } from "../lib/format.ts";
import {
  ContactSchema,
  PersonObservationSchema,
  PersonSnapshotSchema,
  ThoughtLinkSchema,
  listOf,
  writeResult,
} from "../lib/schemas.ts";

export const register: RegisterFn = (registrar, supabase, _helpers) => {

  registrar.registerTool(
  "add_person_observation",
  {
    title: "Add Person Observation",
    description:
      "Record an analytical observation about a contact — pattern insight, interpretation, hypothesis, or strategy.\n" +
      "Use when: capturing a derived insight about a person. Not for: a factual touchpoint — use `log_interaction`; a general memory — use `capture_thought`.\n" +
      "Side effects: inserts one person_observations row (append).\n" +
      "Returns: { ok, id, observation_type, confidence }.",
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
    outputSchema: writeResult({
      observation_type: z.string(),
      confidence: z.number().int(),
    }),
    annotations: WRITE_APPEND,
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
      if (error) return errorResult(`Error: ${error.message}`);
      return structuredResult(
        { ok: true, id: data.id, observation_type, confidence },
        `Observation recorded — ID: ${data.id}\nType: ${observation_type} | Confidence: ${confidence}/5${domain_context ? ` | Domain: ${domain_context}` : ""}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 19: get_person_observations ───────────────────────────────────────
  registrar.registerTool(
  "get_person_observations",
  {
    title: "Get Person Observations",
    description:
      "Retrieve analytical observations for a contact (newest first), optionally filtered to one type.\n" +
      "Use when: reviewing what's been inferred about a person. Not for: the composite card — use `get_person_card`; interaction history — use `get_contact_history`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { items, count } of observations.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      observation_type: z.enum(["fact", "observation", "interpretation", "hypothesis", "strategy"]).optional().describe("Filter to one type"),
      limit: z.number().optional().default(20),
    },
    outputSchema: listOf(PersonObservationSchema),
    annotations: READ_ONLY,
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
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ items: [], count: 0 }, `No observations found for contact ${contact_id}${observation_type ? ` of type ${observation_type}` : ""}.`);

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
      return structuredResult({ items: data, count: data.length }, lines.join("\n"));
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 20: compile_person_snapshot ───────────────────────────────────────
  registrar.registerTool(
  "compile_person_snapshot",
  {
    title: "Compile Person Snapshot",
    description:
      "Write a versioned compiled person card for a contact.\n" +
      "Use when: synthesizing observations/thoughts into a durable person card. Not for: a single observation — use `add_person_observation`.\n" +
      "Side effects: uses compile_snapshot_tx to insert the new snapshot and atomically flip the previous to is_current=false (transactional).\n" +
      "Returns: { ok, id (snapshot id), contact_id }.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      snapshot_content: z.string().describe("The compiled person card — readable prose summary"),
      domains_covered: z.array(z.string()).optional().describe("Domains this snapshot covers"),
      source_observation_ids: z.array(z.string().uuid()).optional().describe("person_observations UUIDs used as source"),
      source_thought_ids: z.array(z.string().uuid()).optional().describe("BRAIN thought UUIDs used as source"),
    },
    outputSchema: writeResult({
      contact_id: z.string(),
    }),
    annotations: WRITE_TRANSACTIONAL,
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
      if (error) return errorResult(`Error: ${error.message}`);
      return structuredResult(
        { ok: true, id: data as string, contact_id },
        `Person snapshot compiled — ID: ${data}\nContact: ${contact_id}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 21: get_person_card ────────────────────────────────────────────────
  registrar.registerTool(
  "get_person_card",
  {
    title: "Get Person Card",
    description:
      "Composite person card: contact header, latest compiled snapshot, recent observations, and linked BRAIN thoughts. Primary agent entry point for pre-meeting context.\n" +
      "Use when: you want the full picture of a person in one call. Not for: just observations — use `get_person_observations`; just interactions — use `get_contact_history`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { contact, snapshot, observations[], brain_links[] } (snapshot is null until one is compiled).",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
    },
    outputSchema: {
      contact: ContactSchema,
      snapshot: PersonSnapshotSchema.nullable(),
      observations: z.array(PersonObservationSchema),
      brain_links: z.array(ThoughtLinkSchema),
    },
    annotations: READ_ONLY,
  },
  async ({ contact_id }) => {
    try {
      const [contactRes, snapshotRes, observationsRes] = await Promise.all([
        supabase.from("professional_contacts").select("*").eq("id", contact_id).single(),
        supabase.from("person_snapshots").select("snapshot_content, domains_covered, compiled_by, version, created_at").eq("contact_id", contact_id).eq("is_current", true).maybeSingle(),
        supabase.from("person_observations").select("observation_type, content, confidence, domain_context, observed_at, linked_thought_id").eq("contact_id", contact_id).order("observed_at", { ascending: false }).limit(10),
      ]);

      if (contactRes.error || !contactRes.data) return errorResult(`Contact not found: ${contactRes.error?.message ?? "no row"}`, "NOT_FOUND");
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

      return structuredResult(
        { contact: c, snapshot: snap ?? null, observations: obs, brain_links: thoughtLinks },
        lines.join("\n"),
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

};
