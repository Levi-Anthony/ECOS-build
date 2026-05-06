# Single MCP Server — `ecb-mcp`
*Decided 2026-05-04 (consolidation). Replaces the prior version of this document, which described a two-server architecture that was a deviation from canon.*

## Decision

ECOS::BRAIN runs as **one MCP server**, deployed as a Supabase Edge Function called `ecb-mcp` (Effortless Connection Brain). All 31 MCP tools — across BRAIN (semantic memory) and ECOS (action on memory) domains — are hosted in this single server. Tool prefix is `mcp__ecb__*`.

There is no `open-brain-mcp` and no `ecos-mcp` going forward. Any reference to those names in BRAIN entries, plan files, or historical docs is documenting prior state, not current architecture.

## Canon citations

This decision flows from two layers of stated authority:

**Upstream (Nate B. Jones / OB1 reference architecture):** Nate's reference architecture treats Open Brain as one logical instance per user — the underlying memory substrate, with extensions/integrations stacking on top of (not alongside) it. The local OB1 reference doc at `~/.claude/projects/-Users-prodadmin-ecos/memory/reference_ob1_architecture.md` is explicit on the remote-Edge-Function constraint and points at this single-instance model. BRAIN entry `43e30fa5` (March 2026) records Levi's commitment to Nate's Substack as canonical authority for BRAIN architecture work — *"main bible for BRAIN architecture — always check against, only consciously and never hubristically deviate from"*.

**Downstream (Levi's SIGMA-method canonization):** BRAIN entry `9eb47599` (March 8, 2026) records `ECOS::BRAIN` (Brain Retrieval Associative Integration Node) as the canonized name for Levi's personal-namespace memory and retrieval system. `ecb-mcp` is the abbreviation that pattern-matches the ECOS naming family while staying consistent with the OB1 base — Effortless Connection Brain, the brain layer of ECOS. The expansion is documented in `~/ecos/CLAUDE.md`.

## Why this document had to be rewritten

The prior version of this file argued that two MCP servers — `open-brain-mcp` for memory and `ecos-crm-mcp` (renamed `ecos-mcp`) for action — was the correct architecture, citing "code organization" and "MCP SDK flat-namespace limits" as rationale. That was wrong, and worth naming directly:

- The "MCP SDK flat-namespace limits" claim was unsubstantiated. MCP servers commonly host 30–100+ tools without issue.
- The "different release cadences" argument doesn't apply to a single-user system.
- The actual cause of the two-server outcome was anchoring on the existing on-disk split (it was already there from prior development drift) and dressing up that anchor as architecture. Levi explicitly stated single-server direction at least three times in the consolidation session that produced commit `d3540fb`; that direction was not honored. The pattern was correctly named as gaslighting in the same session.

This rewrite exists to make the canon-aligned position the load-bearing one in the repo, so future agents reading docs/architecture/ before adding tools or making changes find the correct architecture immediately.

## Code organization

The 31 tools are organized into 8 per-domain TypeScript modules under `~/ecos/supabase/functions/ecb-mcp/tools/`:

| Module | Tools | Count |
|---|---|---|
| `brain.ts` | search_thoughts, list_thoughts, thought_stats, capture_thought, update_thought, delete_thought | 6 |
| `contacts.ts` | add_contact, search_contacts, log_interaction, get_contact_history, get_follow_ups_due, update_contact, get_contacts_by_domain, set_administrative_status | 8 |
| `opportunities.ts` | create_opportunity | 1 |
| `billing.ts` | log_service_call, get_client_service_history, get_unbilled_work, create_billing_entry, update_billing_status | 5 |
| `observations.ts` | add_person_observation, get_person_observations, compile_person_snapshot, get_person_card | 4 |
| `brain-bridge.ts` | link_thought_to_contact, get_linked_thoughts, search_brain_for_contact | 3 |
| `briefing.ts` | get_briefing_context | 1 |
| `taste.ts` | capture_taste_preference, update_taste_preference, list_taste_preferences | 3 |

Each module exports `register(registrar, supabase, helpers)`. Shared utilities (`getEmbedding`, `extractMetadata`, constants like `ECOS_USER_ID`, the tracked registrar wrapper) live in `helpers.ts`.

The top-level `index.ts` is under 100 lines and consists of: imports, supabase client creation, McpServer creation, `createTrackedRegistrar(server)`, sequential `register(...)` calls, count assertion (`registrar.getRegisteredNames().length === 31`), Hono setup with CORS-then-auth middleware order.

## Tracked tool registration (load-bearing safety)

Every module registers tools through a wrapper exported by `helpers.ts`:

```ts
const registrar = createTrackedRegistrar(server);
// Modules call registrar.registerTool(...) instead of server.registerTool(...)
```

The wrapper records every name in a private `Set<string>` and throws synchronously on duplicate. After all modules have registered, `index.ts` asserts the recorded count equals 31. This makes silent name collisions impossible and catches drift in expected count at startup, not in production.

## Authentication

Both authentication patterns work and are documented in `DEPLOY.md`:

- **Claude Code (terminal)** — `--header "x-brain-key: $MCP_ACCESS_KEY"` flag on `claude mcp add`.
- **Claude Desktop, ChatGPT, claude.ai (any client whose connector UI doesn't expose custom headers)** — append `?key=$MCP_ACCESS_KEY` to the URL. The auth middleware accepts either path.

`verify_jwt = false` is set in `~/ecos/supabase/config.toml` for `ecb-mcp`. Auth is the function's own `MCP_ACCESS_KEY` check, not Supabase's JWT layer. Setting `verify_jwt = true` would reject every request at the gateway before reaching the function's own auth.

## Rule for future ECOS subsystems

When adding a new subsystem (life-engine, dispatcher, future domains), **add a new module file under `tools/` and register it from `index.ts`**. Do not create another MCP server. Increment the `EXPECTED_TOOL_COUNT` constant in `index.ts` by the number of tools added.

The only conditions under which a separate MCP server would be justified:

1. **Different access pattern** — a subsystem that needs to be reachable without `MCP_ACCESS_KEY`, with a different rate limit, or via a different auth mechanism entirely.
2. **Foreign concept space** — tools that genuinely don't belong alongside the existing domains, where adjacency in the same server would confuse readers.
3. **Independent release cadence required by a real constraint** — not a preference for "neater organization."

None of those apply to currently planned subsystems. Default is "add a module to `ecb-mcp`."

## Cross-domain access pattern

`ecb-mcp` reads BRAIN tables (`thoughts`, `match_thoughts` RPC) directly when needed for enrichment. The canonical example is `search_brain_for_contact` (in `brain-bridge.ts`), which calls `match_thoughts` to surface semantic context for a contact. This works because all tools share the same `supabase` client passed into each module's `register()` — there is no longer a "cross-server" call to manage.

## What the OB1 invariant *does* still enforce

`ecb-mcp` is a remote MCP server (Supabase Edge Function). It does NOT run locally via `claude_desktop_config.json`, `StdioServerTransport`, or a local Node.js server. This part of the OB1 guard rail is intact and non-negotiable — it's what makes the system reachable from any MCP-capable client (Claude Code, Claude Desktop, claude.ai, ChatGPT, mobile, future agents) without maintaining N+1 local processes.

## Migration record

| Date | Change |
|---|---|
| Pre-2026-05-04 | Two MCP servers existed: `open-brain-mcp` (BRAIN) and `ecos-crm-mcp` (ECOS, later renamed `ecos-mcp`). Drift, not design. |
| 2026-05-04 (commit `d3540fb`) | Original-content invariant + TASTE wiring + `ecos-crm-mcp` → `ecos-mcp` rename. The two-server split was preserved in this commit; that decision was an anchoring failure, not canon. |
| 2026-05-04 (this consolidation) | All 31 tools collapsed into `ecb-mcp`. `open-brain-mcp` and `ecos-mcp` Edge Functions deleted from Supabase after grace-period client migration. |
