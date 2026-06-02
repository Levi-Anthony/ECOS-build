-- Migration: create pulse_entries
-- ECBRAIN V1 — append-only event stream for in-session pulse captures.
-- Architecture ref: §3.1, §3.7. Errata ref: §2 (sync embedding), §5 (client_request_id).
--
-- Embedding column is NOT NULL: synchronous embedding policy means the write
-- fails if embedding fails — no row is inserted. No backfill path.
--
-- client_request_id: nullable idempotency key for offline outbox replay.
-- Unique where not null so replayed writes are safe to retry.

CREATE TABLE pulse_entries (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         TEXT        NOT NULL,
  surface            TEXT        NOT NULL,
  pulse_type         TEXT        NOT NULL,
  content            TEXT        NOT NULL,
  embedding          extensions.vector(1536) NOT NULL,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_ts          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_request_id  TEXT
)
;

-- Ordering + session-scoped retrieval
CREATE INDEX pulse_entries_session_idx
  ON pulse_entries (session_id, occurred_at DESC)
;

-- Recency queries (list_recent_pulse)
CREATE INDEX pulse_entries_occurred_idx
  ON pulse_entries (occurred_at DESC)
;

-- Ingestion/debug ordering
CREATE INDEX pulse_entries_created_idx
  ON pulse_entries (created_at DESC)
;

-- Semantic recall
CREATE INDEX pulse_entries_embedding_idx
  ON pulse_entries USING hnsw (embedding extensions.vector_cosine_ops)
;

-- Idempotent replay: unique client_request_id where provided
CREATE UNIQUE INDEX pulse_entries_client_request_id_idx
  ON pulse_entries (client_request_id)
  WHERE client_request_id IS NOT NULL
;

-- RLS: service-role only at V1. No anonymous or authenticated access.
ALTER TABLE pulse_entries ENABLE ROW LEVEL SECURITY
;

CREATE POLICY "Service role full access on pulse_entries"
  ON pulse_entries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;

GRANT SELECT, INSERT, UPDATE, DELETE ON pulse_entries TO service_role
;
