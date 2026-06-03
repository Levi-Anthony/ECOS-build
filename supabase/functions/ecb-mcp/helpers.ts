// ecb-mcp shared helpers — env-var validation, shared constants, the tracked-registrar
// wrapper, and re-exports from lib/*. Each tool module imports from here.
//
// lib/embedding.ts: getEmbedding implementation
// lib/metadata.ts:  extractMetadata implementation
// lib/supabase.ts:  createServiceClient factory
// lib/format.ts:    textResult / errorResult helpers
// lib/annotations.ts: READ_ONLY / WRITE_APPEND / WRITE_TRANSACTIONAL presets
//
// The createTrackedRegistrar wrapper (see below) is the load-bearing safety
// mechanism: every tool registration in every module flows through it, which
// prevents silent name collisions and gives index.ts an authoritative count.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding as _getEmbedding } from "./lib/embedding.ts";
import { extractMetadata as _extractMetadata } from "./lib/metadata.ts";

// ─── Required env-var validation (fails fast at module load) ─────────────────
// SUPABASE_URL and SUPABASE_SECRET_KEYS are auto-injected by Supabase Edge
// Functions. SUPABASE_SERVICE_ROLE_KEY is a legacy fallback for local/older
// runtimes only. MCP_ACCESS_KEY and OPENROUTER_API_KEY MUST be user-set.
const REQUIRED_ENV = ["MCP_ACCESS_KEY", "OPENROUTER_API_KEY", "SUPABASE_URL"] as const;
for (const name of REQUIRED_ENV) {
  if (!Deno.env.get(name)) {
    throw new Error(`ecb-mcp: required env var ${name} is missing or empty`);
  }
}

function getSupabaseAdminKey(): string {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
    const defaultKey = parsed.default;
    if (typeof defaultKey === "string" && defaultKey.length > 0) {
      return defaultKey;
    }
    throw new Error("ecb-mcp: SUPABASE_SECRET_KEYS.default is missing or empty");
  }

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacyKey) return legacyKey;

  throw new Error("ecb-mcp: missing SUPABASE_SECRET_KEYS or legacy SUPABASE_SERVICE_ROLE_KEY");
}

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_SERVICE_ROLE_KEY = getSupabaseAdminKey();
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
export const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

// ─── Constants ───────────────────────────────────────────────────────────────
export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const RELATIONSHIP_DOMAINS = ["tango", "ttc", "outreach", "it", "music", "personal", "general"] as const;
export const ADMIN_STATUSES = ["active", "passive", "administrative_closed", "community"] as const;
export const OPPORTUNITY_STAGES = ["prospect", "qualified", "proposal", "closed_won", "closed_lost"] as const;
export const ECOS_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// ─── getEmbedding / extractMetadata ──────────────────────────────────────────
// Implementations live in lib/embedding.ts and lib/metadata.ts.
// Re-exported here so existing tool files and the helpers bundle remain unchanged.
export const getEmbedding = _getEmbedding;
export const extractMetadata = _extractMetadata;

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
