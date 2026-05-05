# MCP Boundary Decision — BRAIN vs ECOS
*Decided 2026-05-04. Supersedes the implicit "OB1 single-MCP-server invariant" carried forward from Nate B. Jones's reference architecture.*

## Decision

ECOS infrastructure runs **two MCP servers**, both as Supabase Edge Functions in a single Supabase project, sharing one access key. This is the canonical architecture going forward — not drift from a stricter invariant.

| Server | URL | Purpose |
|---|---|---|
| `open-brain-mcp` | `/functions/v1/open-brain-mcp` | Memory substrate — capture, retrieve, mutate-with-history |
| `ecos-mcp` | `/functions/v1/ecos-mcp` | Structured action on memory and on real-world entities |

`ecos-mcp` was renamed from `ecos-crm-mcp` on 2026-05-04 to reflect its actual scope (CRM is one part; the server also houses IT billing, person intelligence, taste preferences, and the eventual home for life-engine and dispatcher tooling).

## The functional border

**BRAIN = memory substrate.** Anything whose purpose is "store and retrieve text that may be relevant later" belongs in `open-brain-mcp`. The current tool set: `capture_thought`, `update_thought`, `delete_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`. The `thoughts` and `thought_history` tables.

**ECOS = action on memory.** Anything whose purpose is "do something with structured data, possibly enriched by memory" belongs in `ecos-mcp`. The current tool set spans CRM (contacts, interactions, opportunities), IT consulting (service logs, billing entries), person intelligence (observations, snapshots), and taste (preferences, evolution history). The tables: `professional_contacts`, `contact_interactions`, `opportunities`, `service_logs`, `billing_entries`, `person_observations`, `person_snapshots`, `taste_preferences`, `taste_evolution`, `pulse_log`, `briefings`.

The border resolves cleanly at the verb level: capture/retrieve = BRAIN; everything else = ECOS.

## Compatibility with the OB1 single-server invariant

Nate B. Jones's OB1 reference architecture specifies "one Open Brain MCP server per user" hosting all personal knowledge tools. That invariant was load-bearing for: (a) ownership over rented infrastructure (Supabase, MCP, pgvector — owned by the user, not a SaaS provider), (b) protocol-over-platform durability (any client speaking MCP can use the system), (c) one auth boundary per user.

ECOS preserves the spirit of that invariant — **one logical OB1 instance per user** — at the project, auth, and identity layers:

- **One Supabase project** (`lqbrzoicorehwidkdhoi`) holds all tables for both servers.
- **One access key** (`MCP_ACCESS_KEY`) authenticates both servers.
- **One Edge Functions runtime** hosts both as siblings in `~/ecos/supabase/functions/`.
- **One owned data plane** — every byte sits in Levi's pgvector-enabled Postgres.

What ECOS rejects is the *single-HTTP-endpoint* reading of the invariant. The MCP SDK's flat tool namespace doesn't scale gracefully past ~20 tools, and the BRAIN/ECOS verb distinction is real enough to deserve separate code surfaces with independent release cadences. The two servers are siblings, not a violation.

## Cross-server access pattern

`ecos-mcp` reads BRAIN tables directly when needed for enrichment. The canonical example is `search_brain_for_contact`, which calls the `match_thoughts` RPC against `thoughts` to surface semantic context for a contact. Tables-via-RPC is the cross-cutting integration mechanism; no new table, no replication.

`open-brain-mcp` does not reach into ECOS tables. The asymmetry is by design: memory is shared substrate; action layers are leaves that consume substrate. If BRAIN ever needs to surface ECOS-side data (e.g., "thoughts linked to this contact"), the integration goes through a join/RPC owned by the calling layer (`ecos-mcp`), not by adding ECOS-aware code to BRAIN.

## Rule for future ECOS subsystems

When adding a new ECOS subsystem (life-engine, dispatcher, taste tooling, future domains), **consolidate under `ecos-mcp` by default**. Fork into a third MCP server only when one of these conditions holds:

1. **Independent release cadence** — the subsystem ships at a different rhythm than the rest of `ecos-mcp` and that rhythm matters operationally.
2. **Different access pattern** — e.g., a subsystem that needs to be reachable without `MCP_ACCESS_KEY`, or with a different rate limit, or with a webhook-only contract.
3. **Foreign concept space** — the tools genuinely don't belong alongside contacts/billing/taste/observations. Stretch test: would a reader of the tool list be confused by their adjacency?

Renames are cheap relative to splits. If a single `ecos-mcp` starts feeling overloaded, prefer renaming/regrouping the function or its tools before forking.

## What the OB1 invariant *does* still enforce

Both servers are remote MCP endpoints (Supabase Edge Functions). Neither runs locally via `claude_desktop_config.json`, `StdioServerTransport`, or a local Node.js server. This part of the OB1 guard rail is intact and non-negotiable — it's what makes the system reachable from any MCP-capable client (Claude Desktop, Claude Code, claude.ai, mobile clients, future agents) without maintaining N+1 local processes.

## Migration tooling note

After the rename (2026-05-04), clients pointing at `/functions/v1/ecos-crm-mcp` will continue to work for a transition period — the old function remains deployed alongside the new one. Cleanup (deletion of the old function) is gated on Levi confirming all his clients have switched to `/functions/v1/ecos-mcp`. The migration command for each client is:

```bash
claude mcp remove ecos-crm
claude mcp add --transport http ecos-mcp \
  https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecos-mcp \
  --header "x-brain-key: [MCP_ACCESS_KEY]"
# then restart the client to refresh the tool registry
```
