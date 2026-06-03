import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Hono, type Context } from "hono";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function getSupabaseAdminKey(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
    const defaultKey = parsed.default;
    if (typeof defaultKey === "string" && defaultKey.length > 0) {
      return defaultKey;
    }
    throw new Error("brain-middleware: SUPABASE_SECRET_KEYS.default is missing or empty");
  }

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  throw new Error("brain-middleware: missing SUPABASE_SECRET_KEYS or legacy SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, getSupabaseAdminKey());

// --- Shared helpers (same pipeline as open-brain-mcp) ---

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Embedding failed: ${r.status} ${msg}`);
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

async function archiveToHistory(
  id: string,
  content: string,
  original_content: string,
  embedding: unknown,
  metadata: Record<string, unknown>,
  reason: "updated" | "deleted"
): Promise<string | null> {
  const { error } = await supabase.from("thought_history").insert({
    original_thought_id: id,
    content,
    original_content,
    embedding,
    type: metadata.type ?? null,
    topics: Array.isArray(metadata.topics) ? metadata.topics : [],
    people: Array.isArray(metadata.people) ? metadata.people : [],
    actions: Array.isArray(metadata.action_items) ? metadata.action_items : [],
    archived_reason: reason,
    archived_by: "middleware",
  });
  return error ? error.message : null;
}

// --- Hono app ---
// Supabase passes the full URL path to the function (e.g. /functions/v1/brain-middleware/capture).
// Wildcard routes like "*/capture" match the last segment regardless of prefix.

const app = new Hono();

// Auth on all routes
app.use("*", async (c, next) => {
  const provided = c.req.header("x-brain-key") || c.req.query("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

// POST */capture
// Body: { content: string, source?: string }
// Returns: { id, status: "captured", type, topics }
app.post("*/capture", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { content, source } = body as { content?: string; source?: string };

    if (!content?.trim()) {
      return c.json({ error: "content is required" }, 400);
    }

    const metadata = await extractMetadata(content);
    const meta = metadata as Record<string, unknown>;

    const isFallback = !!meta._fallback;
    delete meta._fallback;

    // Use rewritten content for embedding + storage; fall back to original
    const storedContent = (meta.rewritten_content as string)?.trim() || content;
    delete meta.rewritten_content;
    const needsSplit = !!meta.needs_split;
    if (!needsSplit) delete meta.needs_split;

    const embedding = await getEmbedding(storedContent);

    const { data, error } = await supabase
      .from("thoughts")
      .insert({
        content: storedContent,
        original_content: content,
        embedding,
        metadata: {
          ...meta,
          source: source ?? "shortcut",
          ...(needsSplit ? { needs_split: true } : {}),
          ...(isFallback ? { metadata_fallback: true } : {}),
        },
      })
      .select("id")
      .single();

    if (error || !data) {
      return c.json({ error: error?.message ?? "Insert failed" }, 500);
    }

    return c.json({
      id: data.id,
      status: "captured",
      type: meta.type ?? "observation",
      topics: Array.isArray(meta.topics) ? meta.topics : [],
      ...(storedContent !== content ? { rewritten: true } : {}),
      ...(needsSplit ? { needs_split: true } : {}),
      ...(isFallback ? { metadata_fallback: true } : {}),
    });
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// POST */search
// Body: { query: string, limit?: number, threshold?: number, type?: string, topic?: string }
// Returns: { results: [{ id, content, similarity, type, topics, people, created_at }] }
app.post("*/search", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { query, limit = 5, threshold = 0.38, type, topic, domain, horizon, signal_type } = body as {
      query?: string;
      limit?: number;
      threshold?: number;
      type?: string;
      topic?: string;
      domain?: string;
      horizon?: string;
      signal_type?: string;
    };

    if (!query?.trim()) {
      return c.json({ error: "query is required" }, 400);
    }

    const qEmb = await getEmbedding(query);

    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: qEmb,
      match_threshold: threshold,
      match_count: limit,
      filter: {},
    });

    if (error) return c.json({ error: error.message }, 500);

    type RawResult = { id: string; content: string; metadata: Record<string, unknown>; similarity: number; created_at: string };
    let filtered: RawResult[] = data ?? [];
    if (type) filtered = filtered.filter((t: RawResult) => t.metadata?.type === type);
    if (topic) filtered = filtered.filter((t: RawResult) => Array.isArray(t.metadata?.topics) && (t.metadata.topics as string[]).includes(topic));
    if (domain) filtered = filtered.filter((t: RawResult) => t.metadata?.domain === domain);
    if (horizon) filtered = filtered.filter((t: RawResult) => t.metadata?.horizon === horizon);
    if (signal_type) filtered = filtered.filter((t: RawResult) => t.metadata?.signal_type === signal_type);

    const results = filtered.map((t: RawResult) => {
      const m = t.metadata || {};
      return {
        id: t.id,
        content: t.content,
        similarity: Math.round(t.similarity * 1000) / 1000,
        type: m.type ?? null,
        domain: m.domain ?? null,
        horizon: m.horizon ?? null,
        signal_type: m.signal_type ?? null,
        topics: Array.isArray(m.topics) ? m.topics : [],
        people: Array.isArray(m.people) ? m.people : [],
        created_at: t.created_at,
      };
    });

    return c.json({ results });
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// PUT */edit
// Body: { id: string, content: string }
// Returns: { id, status: "updated" }
app.put("*/edit", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { id, content } = body as { id?: string; content?: string };

    if (!id || !content) return c.json({ error: "id and content are required" }, 400);

    const { data: existing, error: fetchErr } = await supabase
      .from("thoughts")
      .select("id, content, original_content, embedding, metadata")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return c.json({ error: fetchErr?.message ?? "Thought not found" }, 404);
    }

    const archiveErr = await archiveToHistory(
      id, existing.content, existing.original_content ?? existing.content, existing.embedding,
      (existing.metadata || {}) as Record<string, unknown>, "updated"
    );
    if (archiveErr) return c.json({ error: `Archive failed: ${archiveErr}` }, 500);

    const newMetadata = await extractMetadata(content);
    const newMeta = newMetadata as Record<string, unknown>;
    const isFallback = !!newMeta._fallback;
    delete newMeta._fallback;
    const storedContent = (newMeta.rewritten_content as string)?.trim() || content;
    delete newMeta.rewritten_content;
    const needsSplit = !!newMeta.needs_split;
    if (!needsSplit) delete newMeta.needs_split;
    const newEmbedding = await getEmbedding(storedContent);

    const oldMeta = (existing.metadata || {}) as Record<string, unknown>;
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

    if (updateErr) return c.json({ error: updateErr.message }, 500);

    return c.json({ id, status: "updated" });
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// DELETE */delete
// Body: { id: string }
// Returns: { id, status: "deleted" }
app.delete("*/delete", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { id } = body as { id?: string };

    if (!id) return c.json({ error: "id is required" }, 400);

    const { data: existing, error: fetchErr } = await supabase
      .from("thoughts")
      .select("id, content, original_content, embedding, metadata")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return c.json({ error: fetchErr?.message ?? "Thought not found" }, 404);
    }

    const archiveErr = await archiveToHistory(
      id, existing.content, existing.original_content ?? existing.content, existing.embedding,
      (existing.metadata || {}) as Record<string, unknown>, "deleted"
    );
    if (archiveErr) return c.json({ error: `Archive failed: ${archiveErr}` }, 500);

    const { error: deleteErr } = await supabase.from("thoughts").delete().eq("id", id);
    if (deleteErr) return c.json({ error: deleteErr.message }, 500);

    return c.json({ id, status: "deleted" });
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// GET */backfill/next?limit=50
// Returns the next batch of thoughts missing the `domain` metadata field.
// Used by the backfill agent to fetch unprocessed entries.
// Returns: { entries: [{ id, content, metadata, created_at }], remaining: number }
app.get("*/backfill/next", async (c: Context) => {
  try {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 100);

    const [batchResult, countResult] = await Promise.all([
      supabase
        .from("thoughts")
        .select("id, content, metadata, created_at")
        .filter("metadata->>domain", "is", null)
        .order("created_at", { ascending: true })
        .limit(limit),
      supabase
        .from("thoughts")
        .select("*", { count: "exact", head: true })
        .filter("metadata->>domain", "is", null),
    ]);

    if (batchResult.error) return c.json({ error: batchResult.error.message }, 500);

    return c.json({
      entries: batchResult.data ?? [],
      remaining: countResult.count ?? 0,
    });
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// PATCH */backfill/apply
// Body: { updates: [{ id, domain, horizon, signal_type, confidence }] }
// Merges the 4 new schema fields into each thought's existing metadata JSONB.
// Does NOT touch content or embedding — no re-indexing, no archiving.
// Returns: { applied: number, errors: [{ id, error }] }
app.patch("*/backfill/apply", async (c: Context) => {
  try {
    const body = await c.req.json();
    const { updates } = body as {
      updates?: Array<{
        id: string;
        domain?: string;
        horizon?: string;
        signal_type?: string;
        confidence?: string;
      }>;
    };

    if (!Array.isArray(updates) || updates.length === 0) {
      return c.json({ error: "updates array is required" }, 400);
    }

    const errors: Array<{ id: string; error: string }> = [];
    let applied = 0;

    for (const u of updates) {
      if (!u.id) { errors.push({ id: u.id, error: "missing id" }); continue; }

      const patch: Record<string, string> = {};
      if (u.domain) patch.domain = u.domain;
      if (u.horizon) patch.horizon = u.horizon;
      if (u.signal_type) patch.signal_type = u.signal_type;
      if (u.confidence) patch.confidence = u.confidence;

      if (Object.keys(patch).length === 0) {
        errors.push({ id: u.id, error: "no fields to patch" });
        continue;
      }

      const { error } = await supabase.rpc("patch_thought_metadata", {
        thought_id: u.id,
        patch,
      });

      if (error) {
        errors.push({ id: u.id, error: error.message });
      } else {
        applied++;
      }
    }

    return c.json({ applied, errors });
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

Deno.serve(app.fetch);
