// ecb-mcp shared helpers — single home for getEmbedding, extractMetadata,
// shared constants, the tracked-registrar wrapper, and env-var validation.
// Each tool module imports from here rather than redefining.
//
// The createTrackedRegistrar wrapper (see below) is the load-bearing safety
// mechanism: every tool registration in every module flows through it, which
// prevents silent name collisions and gives index.ts an authoritative count.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Required env-var validation (fails fast at module load) ─────────────────
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase
// Edge Functions; we read them but don't enforce here. MCP_ACCESS_KEY and
// OPENROUTER_API_KEY MUST be user-set; missing either is a hard failure.
const REQUIRED_ENV = ["MCP_ACCESS_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
for (const name of REQUIRED_ENV) {
  if (!Deno.env.get(name)) {
    throw new Error(`ecb-mcp: required env var ${name} is missing or empty`);
  }
}

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
export const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

// ─── Constants ───────────────────────────────────────────────────────────────
export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const RELATIONSHIP_DOMAINS = ["tango", "ttc", "outreach", "it", "music", "personal", "general"] as const;
export const ADMIN_STATUSES = ["active", "passive", "administrative_closed", "community"] as const;
export const OPPORTUNITY_STAGES = ["prospect", "qualified", "proposal", "closed_won", "closed_lost"] as const;
export const ECOS_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// ─── getEmbedding ────────────────────────────────────────────────────────────
export async function getEmbedding(text: string): Promise<number[]> {
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

// ─── extractMetadata ─────────────────────────────────────────────────────────
// The LLM system-prompt string below is the load-bearing artifact: do not
// modify without understanding the downstream effect on rewrite quality and
// metadata fields. Behavior is preserved from prior server implementations.
export async function extractMetadata(text: string): Promise<Record<string, unknown>> {
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

// ─── Tracked tool registrar ───────────────────────────────────────────────────
// Wraps server.registerTool. Records every tool name in a private Set; throws
// synchronously on duplicate registration (which would otherwise silently
// overwrite the prior registration). index.ts queries getRegisteredNames() at
// the end to assert the expected total count.
//
// Usage pattern:
//   const registrar = createTrackedRegistrar(server);
//   register_brain(registrar, supabase, helpers);
//   register_contacts(registrar, supabase, helpers);
//   ...
//   if (registrar.getRegisteredNames().length !== 31) throw ...
export type TrackedRegistrar = {
  registerTool: McpServer["registerTool"];
  getRegisteredNames: () => string[];
  count: () => number;
};

export function createTrackedRegistrar(server: McpServer): TrackedRegistrar {
  const registered = new Set<string>();

  const registerTool: McpServer["registerTool"] = (...args) => {
    const name = args[0] as string;
    if (registered.has(name)) {
      throw new Error(
        `ecb-mcp tool name collision: "${name}" registered twice. ` +
        `Already-registered names: ${Array.from(registered).sort().join(", ")}`
      );
    }
    registered.add(name);
    return server.registerTool(...args);
  };

  return {
    registerTool,
    getRegisteredNames: () => Array.from(registered).sort(),
    count: () => registered.size,
  };
}

// ─── Helpers bundle (passed into module register() calls) ────────────────────
// Modules may either receive this object as their third parameter OR import
// the individual symbols directly. Both paths are equivalent.
export const helpers = {
  getEmbedding,
  extractMetadata,
  RELATIONSHIP_DOMAINS,
  ADMIN_STATUSES,
  OPPORTUNITY_STAGES,
  ECOS_USER_ID,
  OPENROUTER_BASE,
};

export type Helpers = typeof helpers;

// ─── RegisterFn type — every tool module exports this signature ──────────────
export type RegisterFn = (
  registrar: TrackedRegistrar,
  supabase: SupabaseClient,
  helpers: Helpers,
) => void;
