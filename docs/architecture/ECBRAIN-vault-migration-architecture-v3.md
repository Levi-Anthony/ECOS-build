# ECBRAIN Vault Migration Architecture (v3)

**Status:** Approved for implementation, pending the work order's verification phase passing.
**Supersedes:** v2 of this document, and the prior three-tier content model where it conflicts (specifically: Obsidian-as-canonical for tier 2 documents).
**Scope:** Migration of vault-resident operational state (CLAUDE.md, HANDOFF.md, PULSE_LOG.md, ORIENT.md, governance docs, session management, Obsidian vault files) into ECBRAIN — the Open Brain–derived memory substrate on Supabase Postgres + pgvector, accessed via the `open-brain-mcp` Edge Function.

**Changes from v2:** synchronous embeddings; `occurred_at` added to event tables; `event_seq` watermarks replace UUID watermarks; explicit RLS policies; HNSW vector indexes; explicit confirmation that `artifacts` already exists; preservation of any ChatGPT-compatibility aliases; advisory-lock concurrency for snapshot save; MCP tool annotations.

---

## Governing Principle

**Do not migrate files into Artifacts. Migrate responsibilities into the right storage shapes.**

- Artifacts / versioned documents for canonical, low-churn docs.
- Typed append-only tables for event streams.
- Raw events plus compiled snapshots for HANDOFF.
- Derived state for ORIENT, computed on-demand.
- Local files as projections, never source of truth.
- Obsidian as read-only projection initially.

This principle governs every section that follows. Where a section seems to choose a different shape, the principle wins.

---

## 1. Architecture Summary

ECBRAIN is the source of truth. Everything that lives outside it is a projection of it. The substrate splits responsibilities across four storage shapes, all hosted in one Supabase Postgres database and exposed through a single MCP endpoint.

**Versioned canonical documents** live in the existing `artifacts` table. These are objects authored and edited as wholes — constitutions, governance docs, the boot substrate, reusable protocols. They have version history and are embedded so they can be retrieved semantically. They are the natural home for anything currently authored as a markdown file meant to persist as-is.

**Append-only event streams** live in typed tables (`pulse_entries`, `handoff_events`). These are emissions, not edits. Rows are immutable. Embedding is selective: embed when semantic recall pays off, skip when the field is operational.

**Compiled snapshots** live in a dedicated table (`handoff_snapshots`). A snapshot is the result of running a compilation pass over recent events plus prior canonical state. It carries a watermark identifying the last event consumed and an `is_current` flag. In V1, compilation runs in the AI client (visible reasoning), and the resulting snapshot is persisted via `save_handoff_snapshot`. Server-side compilation is deferred to V1.5.

**Derived state**, like the ORIENT view, is computed on demand by `get_boot_context` from the latest handoff snapshot, recent pulses, and session metadata. No dedicated ORIENT table in V1. Add a cache table in V1.5 only if read latency becomes a real problem.

**Local projections / caches** live as flat files on the device. They are written by the boot/sync cycle from BRAIN and never the source of truth. They make boot fast and offline operation possible. They can be deleted at any time without data loss.

**Three operating disciplines:**

1. Writes are append-only. Truth is reconstructed by retrieval and compilation. Clients read projections. This eliminates "latest-file-wins" because no file is the truth.
2. The MCP tool surface is small, typed, and read/write-asymmetric. Reads bundle (one boot call returns everything needed); writes are atomic and granular.
3. Mobile and desktop are first-class peers. Both write events. Both can save snapshots. Both read the same BRAIN. Local projections are per-surface; BRAIN is shared.

The MCP gateway is `open-brain-mcp`. It is the single canonical Edge Function for both BRAIN (semantic memory) and ECBRAIN extensions (operational state). Modular internal organization keeps it understandable as it grows. Splitting into separate functions is deferred until concrete pressure justifies it (Section 11).

**On embedding policy (v3):** All embedding-bearing writes (`log_pulse`, `save_handoff_snapshot`) compute embeddings synchronously inside the MCP tool transaction. If the embedding service is unreachable, the write fails and the client queues the payload to its outbox for replay. This is simpler than an async/backfill mechanism, easier to debug, and matches the OB1 reference pattern. Async/backfill can be added later if synchronous embedding latency becomes painful in practice.

---

## 2. Data-Shape Classification

| File | Classification | Storage primitive | Embedded | Versioned | Editable from Obsidian |
|---|---|---|---|---|---|
| CLAUDE.md | Canonical document | `artifacts` | Yes | Yes | No (read-only projection) |
| Session Management protocols/templates | Canonical documents | `artifacts` | Yes | Yes | No |
| Governance docs (Two-Door, BRAIN constitution, ECOS spec) | Canonical documents | `artifacts` | Yes | Yes | No |
| HANDOFF.md | Compiled state + raw events | `handoff_snapshots` (compiled) + `handoff_events` (raw) | Snapshot: yes; events: no | Snapshot: implicit via `is_current` chain | No (projection only) |
| PULSE_LOG.md | Event stream | `pulse_entries` | Yes (semantic recall is useful) | No | No (projection; outbox writes only) |
| ORIENT.md | Derived state | Computed inline by `get_boot_context` | N/A | N/A | No (projection only) |
| Obsidian vault files | Projections of canonical artifacts | Local filesystem rendered from `artifacts` | N/A | N/A | No, V1 |

CLAUDE.md is treated as a canonical document, not a magic boot file. Its loading mechanics are a client concern; its content is just an artifact. The "unreliable global boot" problem disappears when CLAUDE.md is fetched explicitly as part of `get_boot_context`.

Session Management splits cleanly: protocols and templates are artifacts; live session state is event-stream + snapshot.

ORIENT is derived, not authored. Its content (mode, focus, open loops, highest leverage, constraints) is reconstructible from recent handoff events, recent pulses, and the latest handoff snapshot.

Obsidian vault files become a one-way export. The artifacts table renders them on demand for human reading and Obsidian's link graph. Edits in Obsidian do not propagate back. V1 scope.

---

## 3. Proposed Schema

All new tables in `public` schema. Embedding column type `vector(1536)` matching `openai/text-embedding-3-small`. RLS policies are explicit (Section 3.7). Vector indexes are HNSW for consistency with OB1 reference architecture.

### 3.1 `pulse_entries`

Append-only event stream of in-session pulses.

```sql
CREATE TABLE pulse_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   TEXT NOT NULL,
  surface      TEXT NOT NULL,
  pulse_type   TEXT NOT NULL,
  content      TEXT NOT NULL,
  embedding    VECTOR(1536) NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_ts    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pulse_entries_session_idx
  ON pulse_entries (session_id, occurred_at DESC);
CREATE INDEX pulse_entries_occurred_idx
  ON pulse_entries (occurred_at DESC);
CREATE INDEX pulse_entries_created_idx
  ON pulse_entries (created_at DESC);
CREATE INDEX pulse_entries_embedding_idx
  ON pulse_entries USING hnsw (embedding vector_cosine_ops);
```

| Field | Meaning |
|---|---|
| `id` | UUID primary key. |
| `session_id` | Per-surface-per-session identifier (UUIDv7 recommended for sortability). Mobile and desktop never share a session_id. |
| `surface` | `'desktop'` \| `'mobile'` \| `'shortcut'` \| `'cron'`. |
| `pulse_type` | Controlled vocabulary at the application layer: `'mode'`, `'focus'`, `'block'`, `'note'`, `'state_change'`, etc. Open enum at the schema layer to avoid migration churn. |
| `content` | Raw pulse text. |
| `embedding` | NOT NULL — synchronous embedding policy. Write fails if embedding fails. |
| `metadata` | Open extension. |
| `occurred_at` | When the event happened from the user/session perspective. Application sets this from `client_ts` if provided, else `now()`. **This is the chronology field.** |
| `client_ts` | Raw client-reported timestamp. Retained for audit/diagnostics; not used for ordering. |
| `created_at` | Server insert time. **Ingestion/debugging field, not chronology.** |

### 3.2 `handoff_events`

Append-only events that contribute to the next handoff snapshot.

```sql
CREATE TABLE handoff_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_seq    BIGINT GENERATED ALWAYS AS IDENTITY,
  session_id   TEXT NOT NULL,
  surface      TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  content      TEXT NOT NULL,
  refs         JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_ts    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX handoff_events_seq_idx
  ON handoff_events (event_seq);
CREATE INDEX handoff_events_session_idx
  ON handoff_events (session_id, occurred_at DESC);
CREATE INDEX handoff_events_type_idx
  ON handoff_events (event_type, occurred_at DESC);
CREATE INDEX handoff_events_occurred_idx
  ON handoff_events (occurred_at DESC);
CREATE INDEX handoff_events_seq_consumed_idx
  ON handoff_events (event_seq);
```

| Field | Meaning |
|---|---|
| `event_seq` | Monotonic, gap-free server-assigned sequence. The watermark cursor. |
| `event_type` | Controlled vocabulary: `'open_loop_added'`, `'open_loop_resolved'`, `'decision'`, `'next_action'`, `'state_change'`, `'block'`, etc. |
| `content` | Human-readable event text — the line that would land in a HANDOFF.md bullet. |
| `refs` | Soft references (not enforced FKs): `{thought_ids: [...], artifact_ids: [...], contact_ids: [...]}`. |
| `metadata` | Open extension. |
| `occurred_at` | Chronology field. Same semantics as in `pulse_entries`. |
| `client_ts` | Raw client timestamp; diagnostic only. |
| `created_at` | Server insert time. |

No embedding column. Handoff events are operational; semantic recall on individual events is rarely useful. The compiled snapshot is what gets searched, when search lands in V1.5.

### 3.3 `handoff_snapshots`

Compiled handoff state. Exactly one row is current at any time; older rows retained as history.

```sql
CREATE TABLE handoff_snapshots (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compiled_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  compiled_by            TEXT NOT NULL,
  source_session_id      TEXT,
  source_event_ids       UUID[]    NOT NULL DEFAULT ARRAY[]::UUID[],
  watermark_event_seq    BIGINT    NOT NULL,
  watermark_occurred_at  TIMESTAMPTZ,
  content                TEXT NOT NULL,
  embedding              VECTOR(1536) NOT NULL,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current             BOOLEAN NOT NULL DEFAULT TRUE,
  artifact_id            UUID REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX handoff_snapshots_current_unique
  ON handoff_snapshots (is_current)
  WHERE is_current = TRUE;
CREATE INDEX handoff_snapshots_compiled_idx
  ON handoff_snapshots (compiled_at DESC);
CREATE INDEX handoff_snapshots_watermark_idx
  ON handoff_snapshots (watermark_event_seq DESC);
CREATE INDEX handoff_snapshots_embedding_idx
  ON handoff_snapshots USING hnsw (embedding vector_cosine_ops);
```

| Field | Meaning |
|---|---|
| `compiled_by` | `'desktop'` \| `'mobile'` \| `'cron'` \| `'manual'`. |
| `source_session_id` | Session that triggered compilation. Optional. |
| `source_event_ids` | Explicit list of `handoff_events.id` values folded into this snapshot. Provided by the client at save time. Enables traceability and debugging. |
| `watermark_event_seq` | Highest `event_seq` consumed. Monotonic cursor. The next compile reads events with `event_seq > watermark_event_seq`. |
| `watermark_occurred_at` | Denormalized for human-readable queries ("when does this snapshot view end?"). Not used for cursor logic. |
| `content` | Rendered HANDOFF.md content. This is what projects to disk. |
| `embedding` | NOT NULL — synchronous embedding policy. |
| `is_current` | Exactly one row may have `TRUE`. Enforced by partial unique index plus advisory lock at write time (Section 3.6). |
| `artifact_id` | Optional. If set, the snapshot is also published to `artifacts` for long-term reference. Most snapshots will not be promoted. |

### 3.4 ORIENT — derived, not stored

V1: no orientation table. `get_boot_context` derives orientation inline from the latest `handoff_snapshots` row, recent `pulse_entries`, and active session metadata.

V1.5 (only if needed): add an `orientation_cache` table to memoize derived orientation, invalidated on new pulse or new handoff snapshot.

### 3.5 Artifact linkage

The existing `artifacts` table absorbs CLAUDE.md, governance docs, and session management protocols. **The `artifacts` table is already present in ECBRAIN** — it backs the existing ECB tools (`create_artifact`, `get_artifact`, `update_artifact`, `link_artifact`, `list_artifacts`, `search_artifacts`). The work order (Section 10.3) includes a verification step that confirms the table's exact column names and types before the migration referencing `artifacts(id)` is run.

For snapshots that warrant long-term referencing (weekly or milestone handoffs), `handoff_snapshots.artifact_id` provides a soft promotion path. The promoted artifact is a frozen copy; the snapshot row remains the operational record.

### 3.6 Snapshot save concurrency

The partial unique index on `is_current` is a safety net, not a coordination mechanism — racing transactions can both attempt to flip the current row and one will get a unique-violation error. To avoid relying on retry-on-error, `save_handoff_snapshot` acquires a Postgres transaction-scoped advisory lock at the start of its transaction:

```sql
SELECT pg_advisory_xact_lock(hashtext('ecbrain.handoff_snapshot_save'));
```

This serializes all snapshot saves cluster-wide. Lock is released automatically at transaction commit/rollback. Single-user operational state machine — the lock contention cost is negligible.

If the lock acquisition itself fails (extremely unlikely outside connection-pool exhaustion), the tool returns an error and the client retries.

### 3.7 RLS policies and grants

All three new tables: row level security enabled, service-role-only access, no anonymous or authenticated access at V1.

```sql
-- pulse_entries
ALTER TABLE pulse_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on pulse_entries"
  ON pulse_entries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON pulse_entries TO service_role;

-- handoff_events
ALTER TABLE handoff_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on handoff_events"
  ON handoff_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON handoff_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE handoff_events_event_seq_seq TO service_role;

-- handoff_snapshots
ALTER TABLE handoff_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on handoff_snapshots"
  ON handoff_snapshots FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON handoff_snapshots TO service_role;
```

When multi-user becomes a real concern: add `user_id UUID NOT NULL` to all three tables, replace policies with `user_id = auth.uid()` form, migrate existing rows under a single user_id.

---

## 4. MCP Surface Design Inside `open-brain-mcp`

ECBRAIN extends the existing `open-brain-mcp` Edge Function. One canonical remote MCP memory gateway, one endpoint, modular internal organization.

### 4.1 File layout

```
supabase/functions/open-brain-mcp/
  index.ts                  # MCP entrypoint; server construction; tool registration
  deno.json
  lib/
    supabase.ts             # service-role client
    embedding.ts            # OpenAI/OpenRouter embedding wrapper (synchronous)
    metadata.ts             # shared metadata extraction
    format.ts               # response formatting helpers
    annotations.ts          # tool annotation presets (read/write)
  tools/
    thoughts.ts             # capture_thought, search_thoughts, list_thoughts, thought_stats,
                            # plus any existing ChatGPT-compat aliases (search, fetch)
    pulse.ts                # log_pulse, list_recent_pulse
    handoff.ts              # append_handoff_event, list_handoff_events,
                            # save_handoff_snapshot, get_latest_handoff_snapshot
    boot.ts                 # get_boot_context
```

### 4.2 Registration pattern

```ts
// index.ts (sketch)
import { registerThoughtTools } from "./tools/thoughts.ts";
import { registerPulseTools }   from "./tools/pulse.ts";
import { registerHandoffTools } from "./tools/handoff.ts";
import { registerBootTools }    from "./tools/boot.ts";

const server   = new Server(/* ... */);
const supabase = createServiceClient();

registerThoughtTools(server, supabase);   // includes existing aliases if present
registerPulseTools(server, supabase);
registerHandoffTools(server, supabase);
registerBootTools(server, supabase);
```

### 4.3 Tool annotations

The MCP SDK supports annotations that hint the tool's behavior to the calling agent. ECBRAIN uses two presets:

```ts
// lib/annotations.ts
export const READ_ONLY = {
  readOnlyHint:  true,
  openWorldHint: false,
};

export const WRITE_APPEND = {
  readOnlyHint:    false,
  destructiveHint: false,    // append-only; no destructive mutation
  openWorldHint:   false,
};

export const WRITE_TRANSACTIONAL = {
  readOnlyHint:    false,
  destructiveHint: false,    // flips is_current but does not delete
  openWorldHint:   false,
};
```

Per-tool assignment is in Section 4.6.

### 4.4 Existing tools (preserved)

| Tool | Status | Notes |
|---|---|---|
| `capture_thought` | Preserved | OB1 ingestion path. No change. |
| `search_thoughts` | Preserved | Semantic search over `thoughts`. No change. |
| `list_thoughts` | Preserved | Recency-sorted listing. No change. |
| `thought_stats` | Preserved | Corpus statistics. No change. |
| `search` (alias) | **Preserved if present** | ChatGPT-compatibility alias. Verification step in work order confirms presence. |
| `fetch` (alias) | **Preserved if present** | ChatGPT-compatibility alias. Verification step in work order confirms presence. |

ECBRAIN tools register alongside these. The OB1 surface is not forked or sidelined.

### 4.5 V1 ECBRAIN tools

All seven tools below land in V1. Embedding policy: synchronous inside the tool transaction.

#### `log_pulse`

- **Purpose:** Record one pulse event. The capture path for in-session state.
- **Inputs:** `{session_id, surface, pulse_type, content, metadata?, client_ts?, occurred_at?}`
- **Output:** `{id, occurred_at, created_at}`
- **R/W:** Write, append-only.
- **Embedding:** Synchronous. Embedding is computed before insert. If the embedding service fails, the tool returns an error; the row is not inserted.
- **Failure modes:** Network failure (to MCP) → client outbox. Embedding service failure → tool error → client outbox. Both are retried later.
- **occurred_at semantics:** `occurred_at = inputs.occurred_at ?? inputs.client_ts ?? now()`.
- **Annotations:** `WRITE_APPEND`.

#### `list_recent_pulse`

- **Purpose:** Read the last N pulse entries, ordered by `occurred_at`.
- **Inputs:** `{limit?: number = 20, session_id?: string, surface?: string, since?: timestamp}`
- **Output:** `{entries: PulseEntry[]}`
- **R/W:** Read.
- **Embedding:** Not used.
- **Failure modes:** Empty result is not a failure. DB unreachable → MCP error; client falls through to local projection.
- **Annotations:** `READ_ONLY`.

#### `append_handoff_event`

- **Purpose:** Append a single handoff event.
- **Inputs:** `{session_id, surface, event_type, content, refs?, metadata?, client_ts?, occurred_at?}`
- **Output:** `{id, event_seq, occurred_at, created_at}`
- **R/W:** Write, append-only.
- **Embedding:** None.
- **Failure modes:** Network failure → outbox.
- **occurred_at semantics:** Same as `log_pulse`.
- **Annotations:** `WRITE_APPEND`.

#### `list_handoff_events`

- **Purpose:** Read handoff events. Used for snapshot compilation, inspection, and debugging.
- **Inputs:** `{session_id?, event_type?, since?, until?, since_event_seq?, limit?: number = 100}`
- **Output:** `{events: HandoffEvent[]}`
- **R/W:** Read.
- **Embedding:** Not used.
- **Failure modes:** Empty result is not a failure.
- **Note:** `since_event_seq` is the cursor used by client-side compilation: pass the prior snapshot's `watermark_event_seq` to get only new events.
- **Annotations:** `READ_ONLY`.

#### `save_handoff_snapshot`

- **Purpose:** Persist a client-compiled handoff snapshot. Server stores, embeds, links, versions; does not compile.
- **Inputs:** `{session_id, content, source_event_ids, metadata?}`
- **Output:** `{id, compiled_at, watermark_event_seq, watermark_occurred_at, is_current: true}`
- **R/W:** Write, transactional with advisory lock.
- **Embedding:** Synchronous.
- **Transaction shape:**
  1. `BEGIN`
  2. `SELECT pg_advisory_xact_lock(hashtext('ecbrain.handoff_snapshot_save'))`
  3. Compute embedding (synchronous; if it fails, ROLLBACK and return error).
  4. Look up `MAX(event_seq)` over `source_event_ids` → `watermark_event_seq`.
  5. Look up `MAX(occurred_at)` over the same → `watermark_occurred_at`.
  6. `UPDATE handoff_snapshots SET is_current = FALSE WHERE is_current = TRUE`.
  7. `INSERT INTO handoff_snapshots (...) VALUES (..., is_current = TRUE)`.
  8. `COMMIT`.
- **Failure modes:** Empty `source_event_ids` allowed (manual override) but emits a warning in metadata. Embedding service failure → transaction rolls back, no state change. Lock acquisition failure → tool error, client retries.
- **Annotations:** `WRITE_TRANSACTIONAL`.

#### `get_latest_handoff_snapshot`

- **Purpose:** Read the current handoff snapshot.
- **Inputs:** `{}`
- **Output:** `{snapshot: HandoffSnapshot | null}`
- **R/W:** Read.
- **Embedding:** N/A.
- **Failure modes:** No current snapshot → `null`. Client treats as cold-start.
- **Annotations:** `READ_ONLY`.

#### `get_boot_context`

- **Purpose:** One bundled read returning everything desktop and mobile need to boot. The shared boot contract.
- **Inputs:** `{surface, session_id?, since?: timestamp}`
- **Output:**
  ```
  {
    handoff_snapshot:    HandoffSnapshot | null,
    recent_pulse:        PulseEntry[],          // last 20 by default, ordered by occurred_at DESC
    derived_orientation: {
      mode: string | null,
      focus: string | null,
      open_loops: OpenLoop[],
      highest_leverage: string | null,
      constraints: string | null,
      content_md: string                        // rendered ORIENT view
    },
    boot_artifacts: Artifact[],                 // CLAUDE.md and any other artifacts tagged "boot:true"
    server_time: timestamp,
    degraded_hints: { pulse_lag_count?, snapshot_age_s?, recent_event_count? }
  }
  ```
- **R/W:** Read.
- **Embedding:** N/A.
- **Failure modes:** Any sub-fetch failing degrades the payload (the field becomes `null` or `[]`) but the call succeeds. The client decides what's enough to boot.
- **Note:** With synchronous embeddings, there is no `embedding_lag_ms` to surface. Removed from `degraded_hints`.
- **Annotations:** `READ_ONLY`.

### 4.6 V1.5 deferrals

| Tool | Deferred because |
|---|---|
| `search_pulse` | Semantic search over pulses pays off after enough data accumulates. V1 retrieval needs are met by `list_recent_pulse`. |
| `search_handoff_events` | Same logic. Most handoff-event reads are recency- or session-scoped. |
| `compile_handoff_snapshot` | Server-side compilation hides reasoning. V1 keeps compilation visible in the AI client. Promote to server only after the manual save loop has stabilized snapshot format, compilation rules, and trust boundaries. |

### 4.7 Tool surface summary

| Tool | V1 | R/W | Embedding | Annotation |
|---|---|---|---|---|
| `capture_thought` | preserved | W | sync | WRITE_APPEND |
| `search_thoughts` | preserved | R | uses | READ_ONLY |
| `list_thoughts` | preserved | R | no | READ_ONLY |
| `thought_stats` | preserved | R | no | READ_ONLY |
| `search` (alias) | preserved if present | R | uses | READ_ONLY |
| `fetch` (alias) | preserved if present | R | no | READ_ONLY |
| `log_pulse` | new | W | sync | WRITE_APPEND |
| `list_recent_pulse` | new | R | no | READ_ONLY |
| `append_handoff_event` | new | W | no | WRITE_APPEND |
| `list_handoff_events` | new | R | no | READ_ONLY |
| `save_handoff_snapshot` | new | W | sync | WRITE_TRANSACTIONAL |
| `get_latest_handoff_snapshot` | new | R | no | READ_ONLY |
| `get_boot_context` | new | R | no | READ_ONLY |
| `search_pulse` | V1.5 | — | — | — |
| `search_handoff_events` | V1.5 | — | — | — |
| `compile_handoff_snapshot` | V1.5 | — | — | — |

---

## 5. Boot Protocol

Shared between desktop and mobile. Identical contract; surface-specific implementations.

### 5.1 Normal online boot

1. Read local projection. Render initial UI from projection so the user sees state immediately.
2. Call `get_boot_context({surface, session_id, since: boot.meta.last_sync})`.
3. On success: overwrite projection from response. Update `boot.meta.last_sync`. Emit a `state_change` pulse with `pulse_type='boot'` so the boot itself is recorded.
4. Render final UI from refreshed state. State is `ACTIVE`.

### 5.2 Degraded boot (MCP unreachable)

1. Read local projection. Render UI from projection.
2. Attempt `get_boot_context`. On error, abandon refresh.
3. Surface explicit `DEGRADED` state to the user. Show projection age.
4. Allow new pulses and handoff events to write to a local outbox (`outbox/*.jsonl`). Each outbox line is the full append payload for replay, including a stable client-generated `occurred_at`.
5. On next successful MCP contact, replay outbox in `occurred_at` order, then run a normal refresh.

### 5.3 Slow MCP (Supabase reachable but slow)

1. Render projection immediately.
2. Issue `get_boot_context` with a soft timeout (e.g., 3 s) for the boot UI; longer hard timeout (e.g., 15 s) for the background refresh.
3. If soft timeout fires, render `DEGRADED-PROBE` state.

### 5.4 Stale projection

`boot.meta.last_sync` older than threshold (e.g., 24 h):
1. Continue with degraded UX while refreshing.
2. Flag `STALE` in the UI.
3. Drop the flag on successful refresh.

### 5.5 Cross-surface conflict avoidance

- Each session opens a new `session_id` (UUIDv7). Mobile and desktop never share a session_id.
- All writes are append-only.
- Snapshot saves are serialized by the advisory lock (Section 3.6).
- Concurrent saves from different surfaces serialize cleanly: second write wins on `compiled_at`; both rows retained in history.

### 5.6 Boot states

| State | Meaning |
|---|---|
| `COLD` | No projection on disk; first boot or cache cleared. |
| `ACTIVE` | Projection refreshed from BRAIN; everything live. |
| `DEGRADED` | MCP unreachable; running on projection; outbox accepting writes. |
| `DEGRADED-PROBE` | MCP slow but reachable; background refresh in flight. |
| `STALE` | Projection older than threshold; refresh recommended. |

---

## 6. Local Projection / Cache Design

Path: `~/ecos/.cache/` on desktop. iOS-equivalent on mobile.

| File | Source | Write frequency | Stale tolerance | Recovery on loss | Human-editable |
|---|---|---|---|---|---|
| `handoff.snapshot.md` | `get_latest_handoff_snapshot.content` | On boot refresh and after `save_handoff_snapshot` | 24 h soft / no hard limit | Re-fetched on next boot | No |
| `pulse.recent.json` | `list_recent_pulse` (last 20) | On boot refresh and after each `log_pulse` | 1 h soft | Re-fetched on next boot | No |
| `orient.derived.md` | `get_boot_context.derived_orientation.content_md` | On boot refresh | Same as parents | Re-derived on next boot | No |
| `boot.meta.json` | Local; updated by client | On every successful refresh and write | N/A | Recreated empty; first boot is COLD | No |
| `outbox/*.jsonl` | Local; one file per pending write | On every offline write | Until successfully replayed | If lost, the writes are lost — flag prominently in DEGRADED UI | No |
| `artifacts/*.md` (Obsidian-rendered) | Selected `artifacts` rows | On boot refresh; selective | 24 h soft | Re-rendered on next boot | No |

**Recovery behavior:** All projections are recoverable from BRAIN except outbox writes that haven't been replayed. The outbox is the only data at risk on cache loss; the UI must surface its size and last-replay status.

**Outbox payload shape:** Each line is `{tool_name, inputs, occurred_at, queued_at}`. On replay, `occurred_at` is preserved as input to the tool so chronology survives offline gaps.

**No human edits:** The cache directory is not for human authoring. If a user edits a projection file, the next refresh overwrites it.

---

## 7. Concurrency Model

The shape is "many writers, one truth, automatic merge." Append-only events plus watermarked snapshots make this almost mechanical.

**Append-only event safety:** Two surfaces appending pulses or handoff events at the same time produce two rows. No conflict. No locking. Pulse ordering is by `occurred_at`; handoff event ordering is by `event_seq` (gap-free monotonic).

**Session ownership:** `session_id` is per-surface-per-session. A "joint session" is not modeled — mobile and desktop are always different sessions. Cross-surface state is reconstructed at compile/derive time from events with different session_ids in the same time window.

**Snapshot ownership:** Any surface can save. The advisory lock serializes saves. The partial unique index on `is_current` is a safety net behind the lock.

**Snapshot watermarks:** Each snapshot records `watermark_event_seq`. The next compile reads only events with `event_seq > watermark_event_seq`. This is robust to offline replay because `event_seq` is server-assigned at insert time, not derived from client clocks.

**Mobile pulse during desktop session:** Mobile pulse → BRAIN. Desktop sees it on next refresh or via background polling. No merge required.

**Cross-surface merge:** Automatic. Compilation reads events regardless of which session_id produced them.

**Avoiding latest-file-wins:** No file is ever the source of truth. Every projection is rebuilt from BRAIN.

---

## 8. Migration Sequence

Lowest-risk-first. Each phase has a goal, a done-when checkpoint, the risks it carries, and a rollback path.

### Phase 1 — Define boot contract

- **Goal:** Approved spec for `get_boot_context` payload and the boot states.
- **Done-when:** This document approved and Section 5 frozen.
- **Risk:** Boot contract changes mid-build force client and server rework.
- **Rollback:** Trivial — no code yet.

### Phase 2 — Verify environment and design schema

- **Goal:** Verification of `pulse_log` and `artifacts` tables in production; SQL migration files for `pulse_entries`, `handoff_events`, `handoff_snapshots` written but not run.
- **Done-when:** Migration files committed; verification report from work order Phase 0 attached.
- **Risk:** Schema mismatch with existing `pulse_log`; missing or differently-shaped `artifacts`. Resolve before running.
- **Rollback:** Revert migration files.

### Phase 3 — Add MCP read tools

- **Goal:** `list_recent_pulse`, `list_handoff_events`, `get_latest_handoff_snapshot`, `get_boot_context` deployed to a Supabase branch of `open-brain-mcp`.
- **Done-when:** All four tools return data (empty results valid) from a branch endpoint. No write tools yet. Tool annotations applied.
- **Risk:** Reads against empty tables produce a useless boot payload, hiding logic bugs. Test with seeded data.
- **Rollback:** Revert the branch; production endpoint untouched.

### Phase 4 — Add MCP write tools

- **Goal:** `log_pulse`, `append_handoff_event`, `save_handoff_snapshot` deployed to the same branch.
- **Done-when:** End-to-end test succeeds: log_pulse → list_recent_pulse returns it; append_handoff_event → list_handoff_events returns it; save_handoff_snapshot → get_latest_handoff_snapshot returns it; advisory lock and partial unique index verified under simulated concurrent save. Synchronous embedding verified by inserting a write and confirming `embedding IS NOT NULL` immediately on read.
- **Risk:** Embedding service failure mode confused with DB error. Test both cases explicitly.
- **Rollback:** Revert the branch.

### Phase 5 — Local projection cache

- **Goal:** Desktop client reads projections on boot. Implements all five boot states. Outbox functional.
- **Done-when:** Cold boot, normal boot, degraded boot, slow boot, stale projection, and outbox replay all pass manual integration tests. Mobile equivalent stubbed but not blocking desktop cutover.
- **Risk:** Outbox replay edge cases. Mitigated by `event_seq` (server-assigned, immune to client-clock drift) and by append-only safety.
- **Rollback:** Disable cache reads; client falls back to direct MCP calls (slow but correct).

### Phase 6 — Dual-write period

- **Goal:** Sessions write to both vault files and BRAIN. Boot still reads vault files; BRAIN writes are observed for parity.
- **Done-when:** Two consecutive weeks of clean parity.
- **Risk:** Maintenance burden on sessions. Mitigated by automating dual-write in the close protocol.
- **Rollback:** Drop BRAIN writes; vault remains canonical.

### Phase 7 — Cutover

- **Goal:** BRAIN becomes canonical. Vault files become projections. Close protocol writes BRAIN only.
- **Done-when:** A session opens, runs, and closes without writing the canonical vault files. The local projection still renders correctly. No data loss observed.
- **Risk:** Hidden dependencies on vault-file mtime or path conventions break. Mitigated by audit of all current consumers before cutover.
- **Rollback:** Re-enable dual-write.

### Phase 8 — Archive old vault

- **Goal:** Existing vault files moved to a read-only archive location. Governance docs migrated to artifacts.
- **Done-when:** Vault files no longer in their original active paths. Artifacts table contains all governance and session-management docs. Obsidian renders from artifacts.
- **Risk:** Archived content is needed and isn't in BRAIN. Mitigated by selective backfill (Phase 9) and reversibility.
- **Rollback:** Restore vault files from archive.

### Phase 9 — Optional historical backfill

- **Goal:** Historical PULSE_LOG.md and HANDOFF.md content imported into BRAIN as backdated rows.
- **Done-when:** Backfilled rows verifiable; `occurred_at` set to original timestamps; metadata flagged `backfilled=true`.
- **Risk:** Backfill quality matters less than going-forward quality.
- **Rollback:** Delete rows where `metadata->>'backfilled' = 'true'`.

---

## 9. Open Decisions

MCP location is decided: extend `open-brain-mcp`. See Section 11 for split criteria.

### 9.1 `pulse_log` reconciliation

- **Question:** A `pulse_log` table already exists. Same as `pulse_entries`, different, or overlapping?
- **Recommended default:** Inspect existing `pulse_log` schema and current usage in Phase 0 of the work order. If empty/unused, rename to `pulse_log_legacy` and create `pulse_entries`. If in active use for life_engine state, leave it alone and create `pulse_entries` as a sibling. Do not collapse without explicit reason.
- **Action:** Resolved by work order verification step.

### 9.2 Obsidian role

- **Decision:** Read-only projection in V1.
- **Why:** Bidirectional sync introduces conflict semantics that don't pay for themselves at this scale.

### 9.3 ORIENT modeling

- **Decision:** Derived inline by `get_boot_context`. No persisted ORIENT table in V1.
- **Why:** Reconstructible from handoff snapshot + recent pulses + session metadata. Persisting adds dual-maintenance.

### 9.4 Offline policy

- **Decision:** Proceed degraded with explicit `DEGRADED` state. Outbox accepts writes.
- **Why:** Failing loudly at boot is friction without payoff for personal infrastructure.

### 9.5 Historical migration policy

- **Decision:** Forward-only first. Backfill optional, opt-in, per-table.
- **Why:** Lift-and-shift is the named failure mode. Forward-only proves the architecture in three weeks rather than three months.

### 9.6 Snapshot save ownership

- **Decision:** Any surface can save. Saves carry `source_event_ids` and a `watermark_event_seq`. Advisory lock serializes; latest `compiled_at` wins.

---

## 10. Implementation Boundary

### 10.1 Implement first

Per the work order (separate document), the first wave is:

- Verify `pulse_log` and `artifacts` tables; report.
- Write SQL migration files including RLS, GRANTs, indexes (HNSW), and `event_seq`.
- Refactor `open-brain-mcp` to the modular layout, preserving all existing tools and aliases.
- Implement V1 read tools.
- Apply migration to branch database.
- Implement V1 write tools with synchronous embedding and advisory-lock save.
- Smoke test including concurrency and embedding-failure paths.

### 10.2 Explicitly NOT yet

- No production cutover until the boot contract is live and the dual-write phase has run for at least two weeks.
- No `compile_handoff_snapshot`. Compilation stays in the AI client.
- No `search_pulse` or `search_handoff_events`. Wait for corpus and query-pattern signal.
- No backfill of historical PULSE_LOG.md or HANDOFF.md content.
- No deprecation of Obsidian.
- No changes to existing OB1 tools beyond modular reorganization.
- No new Edge Function.

### 10.3 Hand-off to Claude Code

Use the implementation work order document as the work order. Do not authorize client-side projection work, dual-write, or cutover until the server-side phases of that work order are verified complete.

---

## 11. Future Split Criteria

ECBRAIN extensions live inside `open-brain-mcp` until one of the following pressures is real and observed:

| Pressure | What "real" looks like |
|---|---|
| Different security boundary | A class of operations needs an auth model the rest of `open-brain-mcp` does not, and forcing them to coexist creates leakage risk. |
| Different auth model | Multi-user emerges; one tool family needs OAuth-scoped access while another uses service-role only. |
| Serious tool bloat | Tool count exceeds a threshold where agent tool-selection accuracy degrades measurably (heuristic: 25–30 tools in one server). |
| Separate failure domain | A new tool family causes incidents that take down the whole memory gateway. Isolation becomes a reliability requirement. |
| Non-MCP-shaped requirements | A dashboard or service needs REST or GraphQL on the same data, and serving it from an MCP function distorts shape. |
| Experimental tools destabilizing main | A new ECOS module is in active prototyping and its instability is bleeding into BRAIN reliability. |
| Tiny boot-specific REST endpoint | After the MCP boot contract is proven, a minimal HTTPS endpoint for a single use case is justified outside the MCP gateway. |

Splitting before any of these is real is premature complexity. The pattern when a split happens:

1. Identify the tool family to extract.
2. Stand up a new Edge Function alongside `open-brain-mcp`. Same Supabase project; same database; different MCP endpoint.
3. Move the tool file from `tools/` to the new function.
4. Update client MCP configurations.
5. Decommission the moved tools from `open-brain-mcp` only after clients are migrated.

---

*End of architecture document v3.*
