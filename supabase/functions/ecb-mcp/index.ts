// ecb-mcp — Effortless Connection Brain (the consolidated MCP server for ECOS::BRAIN).
//
// One MCP server, one URL (/functions/v1/ecb-mcp), one tool prefix (mcp__ecb__*),
// 41 tools across 10 per-domain modules. Per OB1 canon: one logical Open Brain
// instance per user. See ~/ecos/docs/architecture/mcp-boundary-decision.md for
// rationale and migration history.
//
// Module structure: each tool module exports `register(registrar, supabase, helpers)`
// and registers its tools via the tracked registrar (which throws synchronously
// on duplicate name). After all modules register, the count assertion below
// verifies exactly 41 tools live.
//
// Middleware order is load-bearing: CORS first (so OPTIONS preflight succeeds
// without auth), then auth (x-brain-key header OR ?key= query param), then the
// MCP transport handler.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";

import {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MCP_ACCESS_KEY,
  createTrackedRegistrar,
  helpers,
} from "./helpers.ts";

import { register as registerBrain } from "./tools/brain.ts";
import { register as registerContacts } from "./tools/contacts.ts";
import { register as registerOpportunities } from "./tools/opportunities.ts";
import { register as registerBilling } from "./tools/billing.ts";
import { register as registerObservations } from "./tools/observations.ts";
import { register as registerBrainBridge } from "./tools/brain-bridge.ts";
import { register as registerBriefing } from "./tools/briefing.ts";
import { register as registerTaste } from "./tools/taste.ts";
import { register as registerArtifacts } from "./tools/artifacts.ts";
import { register as registerEntities } from "./tools/entities.ts";

const EXPECTED_TOOL_COUNT = 41;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const server = new McpServer({
  name: "ecb",
  version: "1.0.0",
});

const registrar = createTrackedRegistrar(server);

registerBrain(registrar, supabase, helpers);
registerContacts(registrar, supabase, helpers);
registerOpportunities(registrar, supabase, helpers);
registerBilling(registrar, supabase, helpers);
registerObservations(registrar, supabase, helpers);
registerBrainBridge(registrar, supabase, helpers);
registerBriefing(registrar, supabase, helpers);
registerTaste(registrar, supabase, helpers);
registerArtifacts(registrar, supabase, helpers);
registerEntities(registrar, supabase, helpers);

// G-Startup-1: enforce expected tool count. Duplicates would have already
// thrown synchronously during a registrar.registerTool call; this catches
// drift in the count itself (a tool dropped during refactor, or a module
// not registered above).
const registeredNames = registrar.getRegisteredNames();
if (registeredNames.length !== EXPECTED_TOOL_COUNT) {
  throw new Error(
    `ecb-mcp tool count mismatch: expected ${EXPECTED_TOOL_COUNT}, got ${registeredNames.length}. ` +
    `Registered: ${registeredNames.join(", ")}`
  );
}
console.log(`ecb-mcp: ${registeredNames.length} tools registered.`);

// --- Hono App with CORS + Auth ---
const app = new Hono();

// CORS first — OPTIONS preflight must succeed without auth so browser clients
// (any future web integration) can complete the handshake. Move auth before
// CORS and you'll get silent 401s on preflight.
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS", "DELETE"],
  allowHeaders: ["Content-Type", "x-brain-key", "Authorization", "mcp-session-id"],
  maxAge: 86400,
}));

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
