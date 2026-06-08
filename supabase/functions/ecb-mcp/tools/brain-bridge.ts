// Brain-bridge tools — cross-domain CRM↔BRAIN integration.
// link_thought_to_contact + get_linked_thoughts maintain the bidirectional bridge.
// search_brain_for_contact uses the match_thoughts RPC to surface BRAIN context for a contact.
//
// Contract convention: see ./CONVENTION.md.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { OPENROUTER_API_KEY } from "../helpers.ts";
import { READ_ONLY, WRITE_TRANSACTIONAL } from "../lib/annotations.ts";
import { errorResult, structuredResult } from "../lib/format.ts";
import { ThoughtSchema, ThoughtLinkSchema, listOf, writeResult } from "../lib/schemas.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { getEmbedding } = helpers;

  registrar.registerTool(
  "link_thought_to_contact",
  {
    title: "Link Thought to Contact",
    description:
      "Attach a BRAIN thought to a contact by appending its ID + preview to the contact's thought_links JSONB array.\n" +
      "Use when: cross-referencing a memory atom to a person. Not for: reading the links — use `get_linked_thoughts`; observations — use `add_person_observation`.\n" +
      "Side effects: updates the contact's thought_links (transactional); does not touch the notes field.\n" +
      "Returns: { ok, id (contact_id), thought_id, content_preview }.",
    inputSchema: {
      contact_id: z.string().uuid(),
      thought_id: z.string().uuid().describe("UUID of the thought in the thoughts table"),
    },
    outputSchema: writeResult({
      thought_id: z.string(),
      content_preview: z.string(),
    }),
    annotations: WRITE_TRANSACTIONAL,
  },
  async ({ contact_id, thought_id }) => {
    try {
      const { data: thought, error: thoughtErr } = await supabase
        .from("thoughts")
        .select("id, content")
        .eq("id", thought_id)
        .single();
      if (thoughtErr || !thought) return errorResult(`Thought not found: ${thoughtErr?.message ?? "no row"}`, "NOT_FOUND");

      const content_preview = thought.content.slice(0, 140) + (thought.content.length > 140 ? "…" : "");

      const { data: contact, error: contactErr } = await supabase
        .from("professional_contacts")
        .select("thought_links")
        .eq("id", contact_id)
        .single();
      if (contactErr || !contact) return errorResult(`Contact not found: ${contactErr?.message ?? "no row"}`, "NOT_FOUND");

      const existing: unknown[] = Array.isArray(contact.thought_links) ? contact.thought_links : [];
      const newEntry = { thought_id, content_preview, linked_at: new Date().toISOString() };
      const updated = [...existing, newEntry];

      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ thought_links: updated, updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return errorResult(`Error: ${updateErr.message}`);

      return structuredResult(
        { ok: true, id: contact_id, thought_id, content_preview },
        `Linked thought ${thought_id} to contact ${contact_id}\nPreview: "${content_preview}"`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);


  registrar.registerTool(
  "get_linked_thoughts",
  {
    title: "Get Linked Thoughts",
    description:
      "Return the BRAIN thought_links array for a contact — the return lane of the BRAIN↔CRM bridge.\n" +
      "Use when: seeing which memories are pinned to a person. Not for: semantic recall — use `search_brain_for_contact`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { items, count, contact_name } of thought links.",
    inputSchema: {
      contact_id: z.string().uuid(),
    },
    outputSchema: {
      items: z.array(ThoughtLinkSchema),
      count: z.number().int(),
      contact_name: z.string().nullable().optional(),
    },
    annotations: READ_ONLY,
  },
  async ({ contact_id }) => {
    try {
      const { data, error } = await supabase
        .from("professional_contacts")
        .select("name, thought_links")
        .eq("id", contact_id)
        .single();
      if (error || !data) return errorResult(`Contact not found: ${error?.message ?? "no row"}`, "NOT_FOUND");

      const links: unknown[] = Array.isArray(data.thought_links) ? data.thought_links : [];
      if (!links.length) return structuredResult({ items: [], count: 0, contact_name: data.name }, `No BRAIN thoughts linked to ${data.name}.`);

      type ThoughtLink = { thought_id: string; content_preview: string; linked_at: string };
      const lines = (links as ThoughtLink[]).map((l, i) =>
        `${i + 1}. [${new Date(l.linked_at).toLocaleDateString()}] ${l.thought_id}\n   "${l.content_preview}"`
      );
      return structuredResult(
        { items: links, count: links.length, contact_name: data.name },
        `${links.length} linked thought(s) for ${data.name}:\n\n${lines.join("\n\n")}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);


  registrar.registerTool(
  "search_brain_for_contact",
  {
    title: "Search BRAIN for Contact",
    description:
      "Semantic search of BRAIN thoughts using a contact's name and optional domain. Uses threshold 0.30 by default — lower than standard — to surface analytical/framework entries about people.\n" +
      "Use when: gathering everything BRAIN knows about a person. Not for: explicitly pinned links — use `get_linked_thoughts`; general search — use `search_thoughts`.\n" +
      "Side effects: none; read only (embeds the query).\n" +
      "Returns: { items, count } of matching thoughts with similarity scores.",
    inputSchema: {
      contact_name: z.string().describe("Person's name to search for, e.g. 'Victoria Hermosilla'"),
      domain_context: z.string().optional().describe("Optional domain filter, e.g. 'tango', 'ttc'"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.30),
    },
    outputSchema: listOf(ThoughtSchema),
    annotations: READ_ONLY,
  },
  async ({ contact_name, domain_context, limit, threshold }) => {
    try {
      if (!OPENROUTER_API_KEY) {
        return errorResult("Error: OPENROUTER_API_KEY not configured in ecb-mcp secrets. Add it via Supabase Dashboard → Edge Functions → ecb-mcp → Secrets.", "UPSTREAM");
      }
      const query = `${contact_name}${domain_context ? " " + domain_context : ""} person notes observations pattern behavior`;
      const embedding = await getEmbedding(query);

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: embedding,
        match_threshold: threshold ?? 0.30,
        match_count: limit ?? 10,
        filter: {},
      });
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ items: [], count: 0 }, `No BRAIN entries found for "${contact_name}" at threshold ${threshold ?? 0.30}.`);

      type ThoughtMatch = { id: string; content: string; similarity: number; metadata?: { domain?: string; type?: string; signal_type?: string } };
      const results = data as ThoughtMatch[];
      const lines: string[] = [`${results.length} BRAIN entry(ies) for "${contact_name}":\n`];
      for (const t of results) {
        const sim = (t.similarity * 100).toFixed(1);
        const meta = t.metadata ?? {};
        lines.push(`• [${sim}%] ${meta.type ?? ""}${meta.domain ? " · " + meta.domain : ""}${meta.signal_type ? " · " + meta.signal_type : ""}`);
        lines.push(`  ${t.content.slice(0, 200)}${t.content.length > 200 ? "…" : ""}`);
        lines.push(`  ID: ${t.id}`);
      }
      const items = results.map((t) => ({ id: t.id, content: t.content, similarity: t.similarity, metadata: t.metadata ?? null }));
      return structuredResult({ items, count: items.length }, lines.join("\n"));
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

};
