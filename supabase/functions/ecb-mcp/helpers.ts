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
import { z } from "zod";
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
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      const defaultKey = parsed.default;
      if (typeof defaultKey === "string" && defaultKey.length > 0) {
        return defaultKey;
      }
    } catch {
      // fall through to legacy key below
    }
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

// Defensive output guard. The MCP SDK throws a tool error if a tool declares an
// `outputSchema` and the handler's `structuredContent` does not validate. That
// is the correct contract for clients, but it makes a single schema/real-data
// mismatch a hard production failure. This guard re-validates first and, on
// mismatch, STRIPS structuredContent and logs — so the tool degrades to its
// pre-existing text-only behavior instead of failing. Error results (isError)
// and results without structuredContent are passed through untouched (the SDK
// exempts both from output validation). Applied centrally here so every tool —
// and every future tool — is covered without per-handler boilerplate.
function guardStructuredOutput(name: string, validator: z.ZodTypeAny, result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as { isError?: boolean; structuredContent?: unknown };
  if (r.isError) return result;
  if (r.structuredContent == null) return result;
  const parsed = validator.safeParse(r.structuredContent);
  if (!parsed.success) {
    console.warn(
      `ecb-mcp: outputSchema mismatch for "${name}" — returning text-only. ` +
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
    const { structuredContent: _omit, ...rest } = result as Record<string, unknown>;
    return rest;
  }
  return result;
}

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

    // Wrap the handler with the defensive output guard when (and only when) the
    // tool declares an outputSchema via the config-object overload
    // (name, config, handler) that every ECB tool uses.
    const config = args[1] as { outputSchema?: z.ZodRawShape } | undefined;
    const handler = args[args.length - 1];
    if (config && typeof config === "object" && config.outputSchema && typeof handler === "function") {
      const validator = z.object(config.outputSchema);
      const origHandler = handler as (...a: unknown[]) => unknown;
      const wrapped = async (...callbackArgs: unknown[]) =>
        guardStructuredOutput(name, validator, await origHandler(...callbackArgs));
      // ECB always uses the (name, config, handler) overload; we only swap the
      // handler. Bypass the heavily-overloaded registerTool signature with a
      // narrow local cast rather than reconstructing its argument tuple.
      // Use .call(server, ...) to preserve `this` — bare register(...) loses
      // binding in strict-mode runtimes (Supabase edge runtime us-west-1).
      const register = server.registerTool as unknown as (
        n: string,
        c: unknown,
        h: (...a: unknown[]) => unknown,
      ) => ReturnType<McpServer["registerTool"]>;
      return register.call(server, name, config, wrapped);
    }
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
