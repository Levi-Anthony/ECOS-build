# ECBRAIN V1 — Current State

Snapshot of accepted production and staging state at the close of
Phase 5.1c. This document is the source of truth for "what is true now."
Anything not listed here is unverified.

---

## Production (open-brain)

| Field                 | Value                                                       |
|-----------------------|-------------------------------------------------------------|
| Project name          | open-brain                                                  |
| Project ref           | lqbrzoicorehwidkdhoi                                        |
| MCP function          | ecb-mcp                                                     |
| MCP URL               | https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp |
| Tool count            | 48                                                          |
| Release tag           | ecbrain-v1-rc2                                              |
| Release commit        | 79b824e2e01aeddebc115354895727e7d0c26c3f                    |
| Final verdict         | PASS                                                        |

## Staging (open-brain-staging)

| Field         | Value                  |
|---------------|------------------------|
| Project name  | open-brain-staging     |
| Project ref   | gfqumzumfdeeojuwwvbu   |
| Purpose       | Migration testing and bounded probes prior to production |

## Database objects added in V1

| Object                            | Type   | Notes                                          |
|-----------------------------------|--------|------------------------------------------------|
| `public.pulse_entries`            | table  | Operational pulse stream                       |
| `public.handoff_events`           | table  | Append-only event stream, monotonic event_seq  |
| `public.handoff_snapshots`        | table  | Compiled current-state snapshots               |
| `public.save_handoff_snapshot_tx` | RPC    | Transactional snapshot writer (hardened)       |
| `public.pulse_log_legacy`         | table  | Renamed from `public.pulse_log`, empty, retained |

`public.pulse_log` no longer exists under that name. It was renamed
to `public.pulse_log_legacy` to preserve the empty legacy state without
implying it was reused.

## RPC hardening summary

`public.save_handoff_snapshot_tx` is a SECURITY DEFINER function. It is
hardened along the following lines:

- Explicit safe `search_path`.
- All table references are schema-qualified.
- pgvector references are schema-qualified to the `extensions` schema
  (`extensions.vector(1536)`, `extensions.vector_cosine_ops`).
- No dynamic SQL.
- Explicit EXECUTE permissions limited to `service_role`.
- Acquires an advisory lock before resolving the watermark and
  flipping `is_current`, so concurrent calls serialize cleanly.

## Embedding-bearing writes

Embeddings are computed in TypeScript before any database write. If
embedding fails, no database write is attempted. This is enforced at
the tool layer, not by the database.

## Connectors

| Client       | Connector name | Auth method                                 | Status    |
|--------------|----------------|---------------------------------------------|-----------|
| Claude Code  | ecb            | x-brain-key header                          | Connected |
| Claude.ai    | (web)          | ?key= query-string fallback (UI limitation) | Connected |

Header-based auth is preferred wherever the client supports it.
Query-string MCP URLs are secret-bearing. The Claude.ai web connector
uses the query-string fallback because the UI did not support setting
custom headers at the time of cutover.

## Smoke evidence

| Object                                        | ID                                       |
|-----------------------------------------------|------------------------------------------|
| Test run id                                   | phase_5_1c_prod_smoke_20260508           |
| `pulse_entries` smoke row                     | 906bac6f-f2a8-45d5-807a-e167533bd855     |
| `handoff_events` smoke row                    | e8b5863e-404e-47d5-81c9-88130333aced     |
| `handoff_snapshots` smoke row                 | 7c57094d-1203-4a5d-aaa2-486bcfc11822     |

These rows are retained as audit evidence. They should not be deleted
without a separate, approved cleanup work order.

## Known caveats

- **Supabase CLI v2.75.0 limitation:** the CLI as installed does not
  cleanly support the workflow we needed for production migration
  apply, which forced a temporary linked-worktree pattern during
  cutover. See `operations-runbook.md` and
  `release/phase-5-1c-production-cutover.md` for the pattern.
- **RC1 failed:** unqualified pgvector references caused the migration
  to behave incorrectly on production where `vector` was not on the
  default search path.
- **RC2 fix:** all pgvector references were schema-qualified as
  `extensions.vector(1536)` and `extensions.vector_cosine_ops`.
- **Two connector records, one endpoint:** there is exactly one
  production MCP function. Multiple client connectors point at it.
  Tool count must match across them.
