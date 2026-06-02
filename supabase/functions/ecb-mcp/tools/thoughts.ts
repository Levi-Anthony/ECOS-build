// BRAIN tools — semantic memory layer (capture, retrieve, update, delete).
// Registrations flow through the tracked registrar; this module never touches
// server.registerTool directly.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { getEmbedding, extractMetadata } = helpers;

  // Tool 1: Semantic Search
  registrar.registerTool(
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
  registrar.registerTool(
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
        needs_split: z.boolean().optional().describe("Only thoughts flagged as needing a split (metadata.needs_split=true)"),
        status: z.string().optional().describe("Lifecycle filter. Defaults to current rows only (status='current' or null). Pass 'all' to include superseded/archived/split."),
      },
    },
    async ({ limit, type, topic, person, days, domain, horizon, signal_type, collection_id, needs_split, status }) => {
      try {
        let q = supabase
          .from("thoughts")
          .select("id, content, metadata, status, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        // Lifecycle default: hide non-current rows unless caller opts in.
        // Live data is all status='current'; null-tolerant so a future
        // null-defaulted insert is not silently hidden from browse.
        if (status && status !== "all") {
          q = q.eq("status", status);
        } else if (!status) {
          q = q.or("status.eq.current,status.is.null");
        }
        if (needs_split) q = q.contains("metadata", { needs_split: true });
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
            t: { id: string; content: string; metadata: Record<string, unknown>; status: string | null; created_at: string; updated_at: string | null },
            i: number
          ) => {
            const m = t.metadata || {};
            const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
            const meta = [m.type || "??", m.domain, m.horizon, m.signal_type].filter(Boolean).join(" | ");
            const stale = t.status && t.status !== "current" ? ` | status: ${t.status}` : "";
            const updated =
              t.updated_at && t.updated_at !== t.created_at
                ? ` | updated: ${new Date(t.updated_at).toLocaleDateString()}`
                : "";
            return `${i + 1}. [${new Date(t.created_at).toLocaleDateString()}${updated}]${stale} (${meta}${tags ? " — " + tags : ""})\n   ID: ${t.id}\n   ${t.content}`;
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
  registrar.registerTool(
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
  registrar.registerTool(
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
        const { data: inserted, error } = await supabase.from("thoughts").insert({
          content: storedContent,
          original_content: content,
          embedding,
          metadata: {
            ...meta,
            source: "mcp",
            ...(isFallback ? { metadata_fallback: true } : {}),
          },
        }).select("id").single();
        if (error || !inserted?.id) {
          return {
            content: [{ type: "text" as const, text: `Failed to capture: ${error?.message ?? "insert returned no id"}` }],
            isError: true,
          };
        }
        let confirmation = `Captured thought ${inserted.id} as ${meta.type || "thought"}`;
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
  registrar.registerTool(
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
  registrar.registerTool(
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

  // Tool 7: Get Thought (exact-ID read — provenance addressability)
  registrar.registerTool(
    "get_thought",
    {
      title: "Get Thought by ID",
      description:
        "Fetch a single thought atom by its exact UUID. Resolves regardless of lifecycle status (current, superseded, archived, split) — exact-handle lookup is the provenance guarantee that citations to old atoms stay verifiable. Returns the atom plus its status; does NOT return the embedding vector.",
      inputSchema: {
        thought_id: z.string().uuid().describe("Exact UUID of the thought atom"),
      },
    },
    async ({ thought_id }) => {
      try {
        const { data: t, error } = await supabase
          .from("thoughts")
          .select("id, content, original_content, metadata, status, created_at, updated_at")
          .eq("id", thought_id)
          .single();
        // retrieval_count intentionally NOT selected — telemetry is deferred this
        // sprint and the column is unwired; selecting it would imply a feature that
        // does not exist. Re-add here if/when a record_retrieval path lands.
        if (error || !t) {
          return {
            content: [{ type: "text" as const, text: `Thought not found: ${thought_id}${error ? ` (${error.message})` : ""}` }],
            isError: true,
          };
        }
        const m = (t.metadata || {}) as Record<string, unknown>;
        const lines = [
          `ID: ${t.id}`,
          t.status && t.status !== "current"
            ? `Status: ${t.status}  ⚠ not current — may have been superseded; verify before relying on it.`
            : `Status: ${t.status ?? "current"}`,
          `Captured: ${new Date(t.created_at).toLocaleDateString()}${t.updated_at && t.updated_at !== t.created_at ? ` | Updated: ${new Date(t.updated_at).toLocaleDateString()}` : ""}`,
          `Type: ${m.type || "unknown"}${m.domain ? ` | Domain: ${m.domain}` : ""}${m.horizon ? ` | Horizon: ${m.horizon}` : ""}${m.signal_type ? ` | Signal: ${m.signal_type}` : ""}`,
        ];
        if (Array.isArray(m.topics) && m.topics.length) lines.push(`Topics: ${(m.topics as string[]).join(", ")}`);
        if (Array.isArray(m.people) && m.people.length) lines.push(`People: ${(m.people as string[]).join(", ")}`);
        if (Array.isArray(m.action_items) && m.action_items.length) lines.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
        lines.push(`\n${t.content}`);
        // Provenance: surface the raw user input when capture rewrote it for self-containment.
        if (t.original_content && t.original_content !== t.content)
          lines.push(`\n--- original_content (raw input, pre-rewrite) ---\n${t.original_content}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 8: Get Thoughts (batch exact-ID read — resolve a whole FIBERR's cited atoms at once)
  registrar.registerTool(
    "get_thoughts",
    {
      title: "Get Thoughts by ID (batch)",
      description:
        "Fetch multiple thought atoms by exact UUID in one call. Preserves input order, reports any IDs that were not found, and includes each atom's lifecycle status. Resolves regardless of status (no lifecycle filter) — same provenance guarantee as get_thought. Use this to resolve all atoms a FIBERR/Filament cites in a single round-trip instead of N searches.",
      inputSchema: {
        thought_ids: z.array(z.string().uuid()).min(1).max(100).describe("Exact UUIDs to fetch (1–100)"),
      },
    },
    async ({ thought_ids }) => {
      try {
        const { data, error } = await supabase
          .from("thoughts")
          .select("id, content, metadata, status, created_at, updated_at")
          .in("id", thought_ids);
        if (error) {
          return { content: [{ type: "text" as const, text: `Batch fetch error: ${error.message}` }], isError: true };
        }
        const byId = new Map((data ?? []).map((r) => [r.id as string, r]));
        const found: string[] = [];
        const missing: string[] = [];
        const blocks = thought_ids.map((id, i) => {
          const t = byId.get(id);
          if (!t) { missing.push(id); return `--- ${i + 1}. ${id} — NOT FOUND ---`; }
          found.push(id);
          const m = (t.metadata || {}) as Record<string, unknown>;
          const stale = t.status && t.status !== "current" ? `  ⚠ ${t.status}` : "";
          const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
          return `--- ${i + 1}. ${id}${stale} ---\n[${new Date(t.created_at).toLocaleDateString()}] ${m.type || "?"}${m.domain ? ` | ${m.domain}` : ""}${tags ? ` — ${tags}` : ""}\n${t.content}`;
        });
        const header = `Resolved ${found.length}/${thought_ids.length} atom(s)` +
          (missing.length ? ` | ${missing.length} not found: ${missing.join(", ")}` : "");
        return { content: [{ type: "text" as const, text: `${header}\n\n${blocks.join("\n\n")}` }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );
};
