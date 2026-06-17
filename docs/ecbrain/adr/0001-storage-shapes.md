# ADR 0001 — Storage Shapes for ECBRAIN V1

**Status:** Accepted

---

## Context

Before ECBRAIN V1, three classes of state were either homeless or
wrongly housed in the ECOS BRAIN substrate:

- **Operational pulse stream** — high-churn, append-only check-ins
  that the existing `pulse_log` table was the wrong shape for. The
  `pulse_log` table was empty, life-engine-shaped, and unreferenced.
- **Handoff event stream** — append-only events emitted as a session
  progresses. There was no table for this, and capturing handoff
  events as BRAIN thoughts conflated event semantics with semantic
  memory.
- **Compiled handoff snapshot** — a single current-state snapshot
  per branch of work. There was no transactional shape for this, and
  rebuilding it from the event stream on every read was both slow
  and prone to inconsistent reads under concurrency.

The temptation in such cases is to "migrate files into Artifacts"
or to overload existing tables with new responsibilities. Both lead
to drift: tables that no longer have a single owning concept,
queries that sprawl across mismatched columns, and migrations that
bend a shape past what it was designed for.

## Decision

Each responsibility gets its own storage shape, sized to the access
pattern it actually has.

| Responsibility                  | Shape                | Access pattern                          |
|---------------------------------|----------------------|-----------------------------------------|
| Low-churn canonical documents   | `canonical_artifacts`| Versioned, approvable, retrievable by tag |
| Operational pulse stream        | `pulse_entries`      | Append; range read by recency           |
| Append-only handoff event log   | `handoff_events`     | Append; ordered scan; monotonic `event_seq` |
| Compiled current handoff state  | `handoff_snapshots`  | Single current row; transactional flip  |
| BOOT context                    | derived              | Computed at boot from tools and tags    |
| ORIENT                          | derived              | Computed on demand                      |

Use `canonical_artifacts`. Do not introduce an `artifacts` table.

Boot artifacts are selected by the convention `tags && ARRAY['boot']`.
There is no `metadata` column on `canonical_artifacts`; tags carry
the selection signal.

## Rationale

- **Different access patterns deserve different shapes.** A pulse
  stream is high-churn append; a snapshot is a single current row;
  a canonical document is versioned and approvable. Forcing them
  into one table loses indexing leverage and obscures intent.
- **Append-only event logs simplify reasoning.** Events are never
  updated or deleted; they accumulate. A `handoff_events` shape
  with a monotonic `event_seq` cursor (gaps allowed) gives readers
  a deterministic ordering without locking.
- **A compiled snapshot is not the event log.** The snapshot is the
  current rolled-up state. It is written by a transactional RPC
  that acquires an advisory lock, resolves the watermark, flips
  `is_current`, and inserts the new row. Rebuilding the snapshot
  on every read would either be wrong under concurrency or require
  the same locking on the read path.
- **BOOT and ORIENT are derived.** They are short-lived reads, not
  durable state. Storing them would create drift where the stored
  view falls behind the underlying tables. Derivation is cheap
  enough; consistency is worth more than speed here.
- **`canonical_artifacts` already exists** for low-churn versioned
  documents. Files do not migrate *into* artifacts as opaque blobs;
  the responsibility a file is doing migrates into the right
  shape, which sometimes is `canonical_artifacts` and sometimes
  is one of the new tables.

## Consequences

- The schema grows by three tables and one RPC. This is acceptable
  given the responsibilities those shapes house.
- `pulse_log` is renamed to `pulse_log_legacy` rather than dropped.
  The empty legacy table is preserved as a visible artifact of the
  rename, so future inspectors can follow the trail. See
  `docs/ecbrain/architecture.md` for the rationale.
- BOOT and ORIENT no longer have a "storage" question. New BOOT
  inputs are added by tagging artifacts with `boot` or by extending
  the derivation logic in `get_boot_context`. ORIENT is rendered on
  demand and not persisted.
- Future responsibilities should follow the same model: identify
  the access pattern first, choose the shape that fits it, and
  resist the urge to overload an existing table just because it is
  there.
