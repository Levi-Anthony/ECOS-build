import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  try {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are processing a captured thought for storage in a semantic memory system. Complete two tasks and return a single JSON object.

TASK 1 — Self-containment rewrite:
Rewrite the content to stand alone when retrieved cold with no conversation context. Remove or replace session-specific references ("in this session," "as discussed," "earlier," "the above," etc.) by substituting the actual referent. If no session references exist, return the content unchanged. Preserve all meaning. Do not summarize.

TASK 2 — Metadata extraction from the rewritten content:
- "rewritten_content": the self-contained version from Task 1 (required)
- "needs_split": true if this entry requires two distinct concept-labels to fully describe its content — i.e., it sits at the intersection of two semantic neighborhoods rather than at the center of one. Close relationship between the concepts is NOT a reason to omit this flag; closely-related but distinct mechanisms or claims are still two separate centers of mass. false only if one concept-label covers the entire entry.
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates as YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
- "domain": one of "ecos-architecture", "tango-pedagogy", "ttc-board", "neil-outreach", "it-consulting", "music-production", "brain-protocol", "personal" — choose the single best-fit domain
- "horizon": one of "immediate" (time-sensitive, actionable now), "project" (relevant to an active project, not urgent), "evergreen" (durable reference or principle)
- "signal_type": one of "taste" (aesthetic preference or style constraint), "voice" (tone, phrasing, communication style), "struct" (structural pattern or architecture), "decision" (committed choice or resolution), "framework" (conceptual model or heuristic), "content" (factual or narrative content)
- "confidence": one of "observed" (directly witnessed or stated), "inferred" (reasoned from evidence), "hypothetical" (speculative or conditional)

Return only the JSON object.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!r.ok) return { topics: ["uncategorized"], type: "observation", _fallback: true };
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation", _fallback: true };
  }
  } catch {
    return { topics: ["uncategorized"], type: "observation", _fallback: true };
  }
}

// --- MCP Server Setup ---
const server = new McpServer({
  name: "open-brain",
  version: "1.0.0",
});

// Tool 1: Semantic Search
server.registerTool(
  "search_thoughts",
  {
    title: "Search Thoughts",
    description:
      "Search captured thoughts by meaning. Use this when the user asks about a topic, person, or idea they've previously captured.",
    inputSchema: {
      query: z.string().describe("What to search for"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.38),
      domain: z.string().optional().describe("Filter by domain: ecos-architecture, tango-pedagogy, ttc-board, neil-outreach, it-consulting, music-production, brain-protocol, personal"),
      horizon: z.string().optional().describe("Filter by horizon: immediate, project, evergreen"),
      signal_type: z.string().optional().describe("Filter by signal_type: taste, voice, struct, decision, framework, content"),
    },
  },
  async ({ query, limit, threshold, domain, horizon, signal_type }) => {
    try {
      const qEmb = await getEmbedding(query);
      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: qEmb,
        match_threshold: threshold,
        match_count: limit,
        filter: {},
      });
      if (error) {
        return {
          content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
          isError: true,
        };
      }
      if (!data || data.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
        };
      }

      // Apply post-query metadata filters
      type RawResult = { id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string };
      let filtered: RawResult[] = data;
      if (domain) filtered = filtered.filter((t: RawResult) => t.metadata?.domain === domain);
      if (horizon) filtered = filtered.filter((t: RawResult) => t.metadata?.horizon === horizon);
      if (signal_type) filtered = filtered.filter((t: RawResult) => t.metadata?.signal_type === signal_type);

      if (filtered.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No thoughts found matching "${query}" with the applied filters.` }],
        };
      }

      const results = filtered.map(
        (t: RawResult, i: number) => {
          const m = t.metadata || {};
          const parts = [
            `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
            `ID: ${t.id}`,
            `Captured: ${new Date(t.created_at).toLocaleDateString()}`,
            `Type: ${m.type || "unknown"}${m.domain ? ` | Domain: ${m.domain}` : ""}${m.horizon ? ` | Horizon: ${m.horizon}` : ""}${m.signal_type ? ` | Signal: ${m.signal_type}` : ""}`,
          ];
          if (Array.isArray(m.topics) && m.topics.length)
            parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
          if (Array.isArray(m.people) && m.people.length)
            parts.push(`People: ${(m.people as string[]).join(", ")}`);
          if (Array.isArray(m.action_items) && m.action_items.length)
            parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
          parts.push(`\n${t.content}`);
          return parts.join("\n");
        }
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: List Recent
server.registerTool(
  "list_thoughts",
  {
    title: "List Recent Thoughts",
    description:
      "List recently captured thoughts with optional filters by type, topic, person, or time range.",
    inputSchema: {
      limit: z.number().optional().default(10),
      type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
      topic: z.string().optional().describe("Filter by topic tag"),
      person: z.string().optional().describe("Filter by person mentioned"),
      days: z.number().optional().describe("Only thoughts from the last N days"),
      domain: z.string().optional().describe("Filter by domain: ecos-architecture, tango-pedagogy, ttc-board, neil-outreach, it-consulting, music-production, brain-protocol, personal"),
      horizon: z.string().optional().describe("Filter by horizon: immediate, project, evergreen"),
      signal_type: z.string().optional().describe("Filter by signal_type: taste, voice, struct, decision, framework, content"),
      collection_id: z.string().optional().describe("Filter by collection slug — returns all members of a named collection regardless of similarity"),
    },
  },
  async ({ limit, type, topic, person, days, domain, horizon, signal_type, collection_id }) => {
    try {
      let q = supabase
        .from("thoughts")
        .select("id, content, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (type) q = q.contains("metadata", { type });
      if (topic) q = q.contains("metadata", { topics: [topic] });
      if (person) q = q.contains("metadata", { people: [person] });
      if (domain) q = q.contains("metadata", { domain });
      if (horizon) q = q.contains("metadata", { horizon });
      if (signal_type) q = q.contains("metadata", { signal_type });
      if (collection_id) q = q.contains("metadata", { collection_id });
      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        q = q.gte("created_at", since.toISOString());
      }
      const { data, error } = await q;
      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
      if (!data || !data.length) {
        return { content: [{ type: "text" as const, text: "No thoughts found." }] };
      }
      const results = data.map(
        (
          t: { id: string; content: string; metadata: Record<string, unknown>; created_at: string },
          i: number
        ) => {
          const m = t.metadata || {};
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          const meta = [m.type || "??", m.domain, m.horizon, m.signal_type].filter(Boolean).join(" | ");
          return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}] (${meta}${tags ? " — " + tags : ""})\n   ID: ${t.id}\n   ${t.content}`;
        }
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
          },
        ],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: Stats
server.registerTool(
  "thought_stats",
  {
    title: "Thought Statistics",
    description: "Get a summary of all captured thoughts: totals, types, top topics, and people.",
    inputSchema: {},
  },
  async () => {
    try {
      const { count } = await supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true });
      const { data } = await supabase
        .from("thoughts")
        .select("metadata, created_at")
        .order("created_at", { ascending: false });
      const types: Record<string, number> = {};
      const topics: Record<string, number> = {};
      const people: Record<string, number> = {};
      for (const r of data || []) {
        const m = (r.metadata || {}) as Record<string, unknown>;
        if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
        if (Array.isArray(m.topics))
          for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
        if (Array.isArray(m.people))
          for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
      }
      const sort = (o: Record<string, number>): [string, number][] =>
        Object.entries(o)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
      const lines: string[] = [
        `Total thoughts: ${count}`,
        `Date range: ${
          data?.length
            ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
              " → " +
              new Date(data[0].created_at).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "Types:",
        ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
      ];
      if (Object.keys(topics).length) {
        lines.push("", "Top topics:");
        for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
      }
      if (Object.keys(people).length) {
        lines.push("", "People mentioned:");
        for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: Capture Thought
server.registerTool(
  "capture_thought",
  {
    title: "Capture Thought",
    description:
      "Save a new thought to the Open Brain. Generates an embedding and extracts metadata automatically. Use this when the user wants to save something to their brain directly from any AI client — notes, insights, decisions, or migrated content from other systems.",
    inputSchema: {
      content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
    },
  },
  async ({ content }) => {
    try {
      const metadata = await extractMetadata(content);
      const meta = metadata as Record<string, unknown>;

      const isFallback = !!meta._fallback;
      delete meta._fallback;

      // Use rewritten content for embedding + storage; fall back to original
      const storedContent = (meta.rewritten_content as string)?.trim() || content;
      delete meta.rewritten_content; // content field, not metadata
      const needsSplit = !!meta.needs_split;
      if (!needsSplit) delete meta.needs_split; // omit false flag from metadata

      const embedding = await getEmbedding(storedContent);
      const { error } = await supabase.from("thoughts").insert({
        content: storedContent,
        original_content: content,
        embedding,
        metadata: {
          ...meta,
          source: "mcp",
          ...(isFallback ? { metadata_fallback: true } : {}),
        },
      });
      if (error) {
        return {
          content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
          isError: true,
        };
      }
      let confirmation = `Captured as ${meta.type || "thought"}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
      if (Array.isArray(meta.people) && meta.people.length)
        confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
      if (Array.isArray(meta.action_items) && meta.action_items.length)
        confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;
      if (storedContent !== content)
        confirmation += ` | Rewritten for self-containment`;
      if (needsSplit)
        confirmation += ` | ⚠ needs_split: entry may contain multiple ideas`;
      if (isFallback)
        confirmation += ` | ⚠ metadata extraction unavailable — captured with fallback metadata (backfill pending)`;
      return {
        content: [{ type: "text" as const, text: confirmation }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: Update Thought
server.registerTool(
  "update_thought",
  {
    title: "Update Thought",
    description:
      "Update an existing thought by ID. Archives the old version to thought_history before overwriting. Re-generates embedding and metadata from the new content. Use this to correct stale entries, refine phrasing, or supersede outdated captures.",
    inputSchema: {
      id: z.string().uuid().describe("UUID of the thought to update"),
      content: z.string().describe("The new content to replace the existing entry"),
    },
  },
  async ({ id, content }) => {
    try {
      // Fetch current entry
      const { data: existing, error: fetchErr } = await supabase
        .from("thoughts")
        .select("id, content, original_content, embedding, metadata")
        .eq("id", id)
        .single();
      if (fetchErr || !existing) {
        return {
          content: [{ type: "text" as const, text: `Thought not found: ${fetchErr?.message ?? "no row returned"}` }],
          isError: true,
        };
      }

      const oldMeta = (existing.metadata || {}) as Record<string, unknown>;

      // Archive old version to thought_history (uses actual table schema)
      const { error: archiveErr } = await supabase.from("thought_history").insert({
        original_thought_id: id,
        content: existing.content,
        original_content: existing.original_content ?? existing.content,
        embedding: existing.embedding,
        type: oldMeta.type ?? null,
        topics: Array.isArray(oldMeta.topics) ? oldMeta.topics : [],
        people: Array.isArray(oldMeta.people) ? oldMeta.people : [],
        actions: Array.isArray(oldMeta.action_items) ? oldMeta.action_items : [],
        archived_reason: "updated",
        archived_by: "mcp",
      });
      if (archiveErr) {
        return {
          content: [{ type: "text" as const, text: `Failed to archive old version: ${archiveErr.message}` }],
          isError: true,
        };
      }

      // Re-extract metadata; storedContent uses rewrite if produced, else input.
      // Mirrors capture_thought semantic: original_content always = user input.
      const newMetadata = await extractMetadata(content);
      const newMeta = newMetadata as Record<string, unknown>;
      const isFallback = !!newMeta._fallback;
      delete newMeta._fallback;
      const storedContent = (newMeta.rewritten_content as string)?.trim() || content;
      delete newMeta.rewritten_content;
      const needsSplit = !!newMeta.needs_split;
      if (!needsSplit) delete newMeta.needs_split;
      const newEmbedding = await getEmbedding(storedContent);

      // Update the thought
      const { error: updateErr } = await supabase
        .from("thoughts")
        .update({
          content: storedContent,
          original_content: content,
          embedding: newEmbedding,
          metadata: {
            ...newMeta,
            source: oldMeta.source ?? "mcp",
            ...(needsSplit ? { needs_split: true } : {}),
            ...(isFallback ? { metadata_fallback: true } : {}),
          },
        })
        .eq("id", id);
      if (updateErr) {
        return {
          content: [{ type: "text" as const, text: `Failed to update thought: ${updateErr.message}` }],
          isError: true,
        };
      }

      const meta = newMetadata as Record<string, unknown>;
      let confirmation = `Updated thought ${id}\nOld: ${existing.content.slice(0, 80)}${existing.content.length > 80 ? "…" : ""}\nNew: ${content.slice(0, 80)}${content.length > 80 ? "…" : ""}`;
      if (Array.isArray(meta.topics) && meta.topics.length)
        confirmation += `\nTopics: ${(meta.topics as string[]).join(", ")}`;

      return { content: [{ type: "text" as const, text: confirmation }] };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// Tool 6: Delete Thought
server.registerTool(
  "delete_thought",
  {
    title: "Delete Thought",
    description:
      "Delete a thought by ID. Archives the full entry to thought_history before removal — nothing is permanently destroyed. Use this to remove duplicates, test entries, or genuinely obsolete captures.",
    inputSchema: {
      id: z.string().uuid().describe("UUID of the thought to delete"),
    },
  },
  async ({ id }) => {
    try {
      // Fetch current entry before deletion
      const { data: existing, error: fetchErr } = await supabase
        .from("thoughts")
        .select("id, content, original_content, embedding, metadata")
        .eq("id", id)
        .single();
      if (fetchErr || !existing) {
        return {
          content: [{ type: "text" as const, text: `Thought not found: ${fetchErr?.message ?? "no row returned"}` }],
          isError: true,
        };
      }

      const oldMeta = (existing.metadata || {}) as Record<string, unknown>;

      // Archive to thought_history before deletion (uses actual table schema)
      const { error: archiveErr } = await supabase.from("thought_history").insert({
        original_thought_id: id,
        content: existing.content,
        original_content: existing.original_content ?? existing.content,
        embedding: existing.embedding,
        type: oldMeta.type ?? null,
        topics: Array.isArray(oldMeta.topics) ? oldMeta.topics : [],
        people: Array.isArray(oldMeta.people) ? oldMeta.people : [],
        actions: Array.isArray(oldMeta.action_items) ? oldMeta.action_items : [],
        archived_reason: "deleted",
        archived_by: "mcp",
      });
      if (archiveErr) {
        return {
          content: [{ type: "text" as const, text: `Failed to archive before delete: ${archiveErr.message}` }],
          isError: true,
        };
      }

      // Delete from thoughts
      const { error: deleteErr } = await supabase
        .from("thoughts")
        .delete()
        .eq("id", id);
      if (deleteErr) {
        return {
          content: [{ type: "text" as const, text: `Failed to delete thought: ${deleteErr.message}` }],
          isError: true,
        };
      }

      const preview = existing.content.slice(0, 120) + (existing.content.length > 120 ? "…" : "");
      return {
        content: [{ type: "text" as const, text: `Deleted thought ${id}\nArchived to thought_history\nContent: ${preview}` }],
      };
    } catch (err: unknown) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// --- Hono App with Auth Check ---
const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);