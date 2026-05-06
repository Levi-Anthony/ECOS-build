// Brain-bridge tools — cross-domain CRM↔BRAIN integration.
// link_thought_to_contact + get_linked_thoughts maintain the bidirectional bridge.
// search_brain_for_contact uses the match_thoughts RPC to surface BRAIN context for a contact.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { OPENROUTER_API_KEY } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID, getEmbedding } = helpers;

  registrar.registerTool(
  "link_thought_to_contact",
  {
    title: "Link Thought to Contact",
    description: "Attach a BRAIN thought to a contact by appending its ID and preview to the thought_links JSONB array. Does not touch the notes field.",
    inputSchema: {
      contact_id: z.string().uuid(),
      thought_id: z.string().uuid().describe("UUID of the thought in the thoughts table"),
    },
  },
  async ({ contact_id, thought_id }) => {
    try {
      const { data: thought, error: thoughtErr } = await supabase
        .from("thoughts")
        .select("id, content")
        .eq("id", thought_id)
        .single();
      if (thoughtErr || !thought) return { content: [{ type: "text" as const, text: `Thought not found: ${thoughtErr?.message ?? "no row"}` }], isError: true };

      const content_preview = thought.content.slice(0, 140) + (thought.content.length > 140 ? "…" : "");

      const { data: contact, error: contactErr } = await supabase
        .from("professional_contacts")
        .select("thought_links")
        .eq("id", contact_id)
        .single();
      if (contactErr || !contact) return { content: [{ type: "text" as const, text: `Contact not found: ${contactErr?.message ?? "no row"}` }], isError: true };

      const existing: unknown[] = Array.isArray(contact.thought_links) ? contact.thought_links : [];
      const newEntry = { thought_id, content_preview, linked_at: new Date().toISOString() };
      const updated = [...existing, newEntry];

      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ thought_links: updated, updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return { content: [{ type: "text" as const, text: `Error: ${updateErr.message}` }], isError: true };

      return { content: [{ type: "text" as const, text: `Linked thought ${thought_id} to contact ${contact_id}\nPreview: "${content_preview}"` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);


  registrar.registerTool(
  "get_linked_thoughts",
  {
    title: "Get Linked Thoughts",
    description: "Return the BRAIN thought_links array for a contact — the return lane of the BRAIN↔CRM bridge.",
    inputSchema: {
      contact_id: z.string().uuid(),
    },
  },
  async ({ contact_id }) => {
    try {
      const { data, error } = await supabase
        .from("professional_contacts")
        .select("name, thought_links")
        .eq("id", contact_id)
        .single();
      if (error || !data) return { content: [{ type: "text" as const, text: `Contact not found: ${error?.message ?? "no row"}` }], isError: true };

      const links: unknown[] = Array.isArray(data.thought_links) ? data.thought_links : [];
      if (!links.length) return { content: [{ type: "text" as const, text: `No BRAIN thoughts linked to ${data.name}.` }] };

      type ThoughtLink = { thought_id: string; content_preview: string; linked_at: string };
      const lines = (links as ThoughtLink[]).map((l, i) =>
        `${i + 1}. [${new Date(l.linked_at).toLocaleDateString()}] ${l.thought_id}\n   "${l.content_preview}"`
      );
      return { content: [{ type: "text" as const, text: `${links.length} linked thought(s) for ${data.name}:\n\n${lines.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);


  registrar.registerTool(
  "search_brain_for_contact",
  {
    title: "Search BRAIN for Contact",
    description: "Semantic search of BRAIN thoughts using a contact's name and optional domain. Uses threshold 0.30 by default — lower than standard to surface analytical/framework entries about people.",
    inputSchema: {
      contact_name: z.string().describe("Person's name to search for, e.g. 'Victoria Hermosilla'"),
      domain_context: z.string().optional().describe("Optional domain filter, e.g. 'tango', 'ttc'"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.30),
    },
  },
  async ({ contact_name, domain_context, limit, threshold }) => {
    try {
      if (!OPENROUTER_API_KEY) {
        return { content: [{ type: "text" as const, text: "Error: OPENROUTER_API_KEY not configured in ecb-mcp secrets. Add it via Supabase Dashboard → Edge Functions → ecb-mcp → Secrets." }], isError: true };
      }
      const query = `${contact_name}${domain_context ? " " + domain_context : ""} person notes observations pattern behavior`;
      const embedding = await getEmbedding(query);

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: embedding,
        match_threshold: threshold ?? 0.30,
        match_count: limit ?? 10,
        filter: {},
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No BRAIN entries found for "${contact_name}" at threshold ${threshold ?? 0.30}.` }] };

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
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

};
