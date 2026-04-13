import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Hono, type Context } from "hono";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

async function archiveToHistory(
  id: string,
  content: string,
  embedding: unknown,
  metadata: Record<string, unknown>,
  reason: "updated" | "deleted"
): Promise<string | null> {
  const { error } = await supabase.from("thought_history").insert({
    original_thought_id: id,
    content,
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

    const [embedding, metadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);

    const { data, error } = await supabase
      .from("thoughts")
      .insert({
        content,
        embedding,
        metadata: { ...metadata, source: source ?? "shortcut" },
      })
      .select("id")
      .single();

    if (error || !data) {
      return c.json({ error: error?.message ?? "Insert failed" }, 500);
    }

    const meta = metadata as Record<string, unknown>;
    return c.json({
      id: data.id,
      status: "captured",
      type: meta.type ?? "observation",
      topics: Array.isArray(meta.topics) ? meta.topics : [],
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
    const { query, limit = 5, threshold = 0.38, type, topic } = body as {
      query?: string;
      limit?: number;
      threshold?: number;
      type?: string;
      topic?: string;
    };

    if (!query?.trim()) {
      return c.json({ error: "query is required" }, 400);
    }

    const qEmb = await getEmbedding(query);

    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    if (topic) filter.topics = [topic];

    const { data, error } = await supabase.rpc("match_thoughts", {
      query_embedding: qEmb,
      match_threshold: threshold,
      match_count: limit,
      filter: Object.keys(filter).length > 0 ? filter : {},
    });

    if (error) return c.json({ error: error.message }, 500);

    const results = (data ?? []).map((t: {
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      similarity: number;
      created_at: string;
    }) => {
      const m = t.metadata || {};
      return {
        id: t.id,
        content: t.content,
        similarity: Math.round(t.similarity * 1000) / 1000,
        type: m.type ?? null,
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
      .select("id, content, embedding, metadata")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return c.json({ error: fetchErr?.message ?? "Thought not found" }, 404);
    }

    const archiveErr = await archiveToHistory(
      id, existing.content, existing.embedding,
      (existing.metadata || {}) as Record<string, unknown>, "updated"
    );
    if (archiveErr) return c.json({ error: `Archive failed: ${archiveErr}` }, 500);

    const [newEmbedding, newMetadata] = await Promise.all([
      getEmbedding(content),
      extractMetadata(content),
    ]);

    const oldMeta = (existing.metadata || {}) as Record<string, unknown>;
    const { error: updateErr } = await supabase
      .from("thoughts")
      .update({
        content,
        embedding: newEmbedding,
        metadata: { ...(newMetadata as Record<string, unknown>), source: oldMeta.source ?? "mcp" },
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
      .select("id, content, embedding, metadata")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return c.json({ error: fetchErr?.message ?? "Thought not found" }, 404);
    }

    const archiveErr = await archiveToHistory(
      id, existing.content, existing.embedding,
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

Deno.serve(app.fetch);
