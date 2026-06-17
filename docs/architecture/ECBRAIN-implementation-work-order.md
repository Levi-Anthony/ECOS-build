# ECBRAIN V1 Implementation Work Order (for Claude Code)

**Reference:** `ECBRAIN-vault-migration-architecture-v3.md` is the governing spec. Section numbers below refer to it.
**Scope:** Server-side V1 only. No client-side projection, no dual-write, no cutover.
**Boundary:** Stop after Phase 5 (smoke tests pass on branch). Do not proceed to client work without explicit approval.

---

## Phase 0 — Verification (read-only; no changes)

Goal: confirm the assumed environment matches reality. If any check fails, stop and report. Do not write SQL, do not modify code.

### 0.1 Confirm `open-brain-mcp` source

- Locate the existing `open-brain-mcp` Edge Function source in the repository.
- Read `index.ts`. Enumerate every tool currently registered.
- Specifically report whether ChatGPT-compatibility aliases `search` and `fetch` are present. Architecture spec preserves them if present.
- Report current file structure (does it already have a `tools/` or `lib/` split, or is it monolithic?).

### 0.2 Confirm `artifacts` table exists and inspect shape

Run against production database:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'artifacts'
ORDER BY ordinal_position;
```

Report the result. Spec assumes `artifacts(id UUID PRIMARY KEY)`. If `id` is not UUID or the table does not exist, stop and escalate — `handoff_snapshots.artifact_id UUID REFERENCES artifacts(id)` will fail.

### 0.3 Inspect `pulse_log`

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pulse_log'
ORDER BY ordinal_position;

SELECT count(*) AS row_count,
       max(created_at) AS most_recent_row
FROM pulse_log;
```

Report:
- Whether the table exists.
- Its column shape.
- Row count and most recent row timestamp.
- Any references to it in the existing Edge Function code (grep `pulse_log` across the repo).

Decision branch (per architecture §9.1):
- If empty and unreferenced: propose renaming to `pulse_log_legacy` in the migration.
- If actively used: leave alone. New table `pulse_entries` is a sibling.
- Do not auto-resolve. Surface the finding and wait.

### 0.4 Confirm pgvector and HNSW availability

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

Architecture requires HNSW. HNSW requires pgvector ≥ 0.5.0. If the version is older, stop and escalate — the user must upgrade pgvector before migration.

### 0.5 Confirm embedding service config

- Locate the embedding call site in the existing `open-brain-mcp` (likely in something like `lib/embedding.ts` or inlined in capture path).
- Confirm which model and which provider (OpenAI direct vs OpenRouter).
- Confirm credentials are available to the Edge Function at runtime.
- Architecture assumes `openai/text-embedding-3-small`, vector(1536). Report any deviation.

### 0.6 Verification report

Produce a short report covering 0.1–0.5. Stop and wait for approval before Phase 1.

---

## Phase 1 — SQL migration files

Goal: produce migration SQL for the three new tables. Reviewed but not run.

### 1.1 Migration file 1 — `pulse_entries`

Per architecture §3.1 and §3.7. Write to `supabase/migrations/<timestamp>_create_pulse_entries.sql`.

Includes: table, all four indexes (session, occurred, created, HNSW), RLS policy, service-role grants.

Embedding column is `NOT NULL` per synchronous embedding policy (§3.1). HNSW vector index per §3.

### 1.2 Migration file 2 — `handoff_events`

Per architecture §3.2 and §3.7. Write to `supabase/migrations/<timestamp>_create_handoff_events.sql`.

Includes: table with `event_seq BIGINT GENERATED ALWAYS AS IDENTITY`, all five indexes, RLS policy, service-role grants on table AND on the identity sequence (`GRANT USAGE, SELECT ON SEQUENCE handoff_events_event_seq_seq TO service_role`).

### 1.3 Migration file 3 — `handoff_snapshots`

Per architecture §3.3, §3.6, §3.7. Write to `supabase/migrations/<timestamp>_create_handoff_snapshots.sql`.

Includes: table with `watermark_event_seq BIGINT NOT NULL`, FK to `artifacts(id)` (only if Phase 0.2 confirmed shape), all four indexes including HNSW and the partial unique index on `is_current`, RLS policy, grants.

Embedding column is `NOT NULL`.

### 1.4 Optional migration file — `pulse_log` rename

Only if Phase 0.3 confirmed `pulse_log` is empty and unreferenced. Write to `supabase/migrations/<timestamp>_rename_pulse_log_legacy.sql`:

```sql
ALTER TABLE pulse_log RENAME TO pulse_log_legacy;
```

Otherwise skip.

### 1.5 Commit

Commit migration files to a new branch. Do not run them yet. Tag the branch `ecbrain-v1`.

---

## Phase 2 — Refactor `open-brain-mcp` to modular layout

Goal: reorganize source per architecture §4.1 without changing tool behavior. Pure refactor.

### 2.1 Create directory structure

```
supabase/functions/open-brain-mcp/
  index.ts
  deno.json
  lib/
    supabase.ts
    embedding.ts
    metadata.ts
    format.ts
    annotations.ts        # NEW per §4.3
  tools/
    thoughts.ts
    pulse.ts              # NEW; empty registration stub
    handoff.ts            # NEW; empty registration stub
    boot.ts               # NEW; empty registration stub
```

### 2.2 Move existing logic

- Move `capture_thought`, `search_thoughts`, `list_thoughts`, `thought_stats`, and any present aliases (`search`, `fetch`) into `tools/thoughts.ts` as `registerThoughtTools(server, supabase)`.
- Move embedding logic into `lib/embedding.ts`.
- Move shared metadata extraction into `lib/metadata.ts`.
- Move response formatting helpers into `lib/format.ts`.
- Move service-role client construction into `lib/supabase.ts`.
- Define annotation presets in `lib/annotations.ts` per §4.3.

### 2.3 Wire `index.ts`

Per the §4.2 sketch. All four `register*Tools` calls present even though three of them are empty stubs.

### 2.4 Verify behavior parity

Deploy to a Supabase branch endpoint. Smoke test all preserved tools via MCP client:
- `capture_thought` round-trips.
- `search_thoughts` returns results.
- `list_thoughts` and `thought_stats` work.
- `search` and `fetch` aliases work if they were preserved.

Refactor commit. Do not proceed until parity is confirmed.

---

## Phase 3 — Apply migration on branch and implement V1 read tools

Goal: branch database has the new tables; read tools work against them.

### 3.1 Apply migration

Apply Phase 1 SQL files to the branch database. Confirm:
- Tables exist with expected columns.
- Indexes exist (`\d <table>`).
- RLS is enabled (`SELECT relrowsecurity FROM pg_class WHERE relname = 'pulse_entries';` returns `t`).
- Policies exist (`SELECT polname FROM pg_policy WHERE polrelid = 'pulse_entries'::regclass;`).
- Sequence grants are in place.

### 3.2 Implement read tools

Per architecture §4.5. All four:

- `list_recent_pulse` (`tools/pulse.ts`)
- `list_handoff_events` (`tools/handoff.ts`)
- `get_latest_handoff_snapshot` (`tools/handoff.ts`)
- `get_boot_context` (`tools/boot.ts`)

Each tool:
- Uses the `READ_ONLY` annotation preset.
- Queries via service-role client.
- Handles empty-result cases as success.
- Returns `null`/`[]` rather than throwing for "no data."

For `get_boot_context`: the `derived_orientation` field is computed inline. Read latest snapshot, read recent pulses (limit 20), build the ORIENT view in code, return all in the bundle. `boot_artifacts` queries `artifacts` filtered to those with metadata flag `boot:true` (or whatever the existing convention is — confirm in 0.1).

### 3.3 Verify reads against empty tables

- All four tools return clean empty payloads (no errors) on empty tables.
- Seed one row in each table; confirm reads return it.
- Confirm `get_boot_context` produces a coherent payload with one snapshot + a few pulses.

---

## Phase 4 — Implement V1 write tools

Goal: branch endpoint accepts and persists writes. Synchronous embedding. Advisory-lock snapshot save.

### 4.1 `log_pulse`

Per §4.5. In `tools/pulse.ts`. Uses `WRITE_APPEND` annotation.

- Accept inputs.
- Compute `occurred_at = inputs.occurred_at ?? inputs.client_ts ?? now()`.
- **Synchronous** embedding via `lib/embedding.ts`. If embedding throws, return error; do not insert.
- Insert row.
- Return `{id, occurred_at, created_at}`.

### 4.2 `append_handoff_event`

Per §4.5. In `tools/handoff.ts`. Uses `WRITE_APPEND` annotation.

- Accept inputs.
- Compute `occurred_at` as in 4.1.
- Insert row. `event_seq` is server-assigned by the IDENTITY column.
- Return `{id, event_seq, occurred_at, created_at}`.

### 4.3 `save_handoff_snapshot`

Per §4.5 and §3.6. In `tools/handoff.ts`. Uses `WRITE_TRANSACTIONAL` annotation.

Transaction shape (single transaction; `supabase.rpc` to a SQL function or raw client transaction — pick the cleaner option for the existing codebase):

```sql
BEGIN;
  SELECT pg_advisory_xact_lock(hashtext('ecbrain.handoff_snapshot_save'));
  -- compute embedding in app code BEFORE this point or via PL/pgSQL stub;
  -- if app-code embedding fails, ROLLBACK and return error
  SELECT max(event_seq), max(occurred_at)
  FROM handoff_events
  WHERE id = ANY($1::uuid[]);
  -- => watermark_event_seq, watermark_occurred_at
  UPDATE handoff_snapshots SET is_current = FALSE WHERE is_current = TRUE;
  INSERT INTO handoff_snapshots
    (compiled_by, source_session_id, source_event_ids,
     watermark_event_seq, watermark_occurred_at,
     content, embedding, metadata, is_current)
  VALUES
    ($2, $3, $1, $4, $5, $6, $7, $8, TRUE)
  RETURNING id, compiled_at, watermark_event_seq, watermark_occurred_at;
COMMIT;
```

Implementation note: the cleanest pattern is usually to compute the embedding in TypeScript first, then run a single transactional RPC that takes the precomputed embedding as a parameter. This keeps the lock window minimal.

Empty `source_event_ids`: allowed. Set `watermark_event_seq` to the prior snapshot's value (or 0 if none) and emit a metadata warning `{warning: "empty_source_event_ids"}`.

### 4.4 Verify writes

- Single-write smoke: each tool inserts a row that the corresponding read tool returns.
- Synchronous embedding: insert a `log_pulse`, immediately read via `list_recent_pulse`, confirm `embedding` is not null. Repeat for `save_handoff_snapshot`.
- Embedding-failure path: temporarily inject a failure in `lib/embedding.ts`. Confirm `log_pulse` returns an error and **no row is inserted** (`SELECT count(*) FROM pulse_entries` unchanged).
- Snapshot uniqueness: save two snapshots in quick succession; confirm only one has `is_current = TRUE`.
- Snapshot concurrency: open two database connections, begin transactions, both call `save_handoff_snapshot`. Confirm one waits on the advisory lock until the other commits, then proceeds; final state has exactly one current snapshot.
- Watermark math: append 5 handoff_events, save snapshot referencing all 5; confirm `watermark_event_seq` equals the max `event_seq` of the 5.
- Append-only safety: append 100 events from two simulated surfaces concurrently; confirm all 100 land with monotonic `event_seq` values.

---

## Phase 5 — Smoke test the full V1 surface

Goal: confirm the eleven-tool surface (four preserved + seven new) works end-to-end on the branch endpoint.

### 5.1 End-to-end script

Write a smoke-test script (Deno or Node, repo's choice) that:

1. Calls each preserved tool once and logs the result.
2. Calls each new tool: `log_pulse` → `list_recent_pulse`; `append_handoff_event` ×3 → `list_handoff_events`; `save_handoff_snapshot` → `get_latest_handoff_snapshot`; `get_boot_context`.
3. Confirms `get_boot_context` returns a payload containing the snapshot, the recent pulses, a coherent derived_orientation, and the boot artifacts.
4. Asserts that all annotations are present and correctly classified by inspecting the MCP server's tool list.

### 5.2 Stop here

Stop after Phase 5 passes. Do not begin client-side projection, dual-write, or cutover work. Report results and wait for explicit approval.

---

## Out of scope for this work order

- Local projection cache (architecture §6) — separate work order after server is accepted.
- Dual-write phase (architecture §8 Phase 6) — separate work order.
- Cutover and vault archive (architecture §8 Phases 7–8) — separate work orders.
- Historical backfill (architecture §8 Phase 9) — optional, separate work order.
- V1.5 tools (`search_pulse`, `search_handoff_events`, `compile_handoff_snapshot`) — explicitly deferred per architecture §4.6.
- Any new Edge Function — explicitly forbidden per architecture §10.2.

---

## Stop conditions during execution

Halt and surface the finding (do not proceed) if any of the following occur:

- Phase 0 verification fails any check (missing table, wrong shape, missing extension, missing credentials, mismatched embedding model).
- An existing tool's behavior changes during the Phase 2 refactor.
- An existing tool disappears from the surface during the refactor.
- A migration fails to apply cleanly on the branch database.
- Embedding-failure-with-no-insert behavior cannot be verified.
- Snapshot concurrency test does not produce serialized behavior.
- Any test in Phase 4.4 or 5.1 fails.

---

*End of work order.*
