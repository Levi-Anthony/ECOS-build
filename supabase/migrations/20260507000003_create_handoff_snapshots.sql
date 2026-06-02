-- Migration: create handoff_snapshots
-- ECBRAIN V1 — compiled handoff state. Exactly one row is current at any time;
-- older rows retained as history.
-- Architecture ref: §3.3, §3.6, §3.7. Errata ref: §2 (sync embedding), §3 (advisory lock
-- lives in save_handoff_snapshot_tx RPC — see migration 20260507000004),
-- §5 (client_request_id).
--
-- Correction v3.2: FK references canonical_artifacts(id), not artifacts(id).
-- Phase 0 confirmed artifacts table does not exist; canonical_artifacts does.
--
-- is_current partial unique index + advisory lock (in save_handoff_snapshot_tx):
-- the index is the safety net; the lock is the coordination mechanism. Both required.
--
-- embedding NOT NULL: synchronous embedding policy. Write fails if embedding fails.

CREATE TABLE handoff_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  compiled_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  compiled_by           TEXT        NOT NULL,
  source_session_id     TEXT,
  source_event_ids      UUID[]      NOT NULL DEFAULT ARRAY[]::UUID[],
  watermark_event_seq   BIGINT      NOT NULL,
  watermark_occurred_at TIMESTAMPTZ,
  content               TEXT        NOT NULL,
  embedding             extensions.vector(1536) NOT NULL,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_current            BOOLEAN     NOT NULL DEFAULT TRUE,
  artifact_id           UUID        REFERENCES canonical_artifacts(id) ON DELETE SET NULL,
  client_request_id     TEXT
)
;

-- Exactly one current snapshot at a time. Racing transactions get a unique-violation;
-- the advisory lock in save_handoff_snapshot_tx prevents the race in normal operation.
CREATE UNIQUE INDEX handoff_snapshots_current_unique
  ON handoff_snapshots (is_current)
  WHERE is_current = TRUE
;

-- History traversal
CREATE INDEX handoff_snapshots_compiled_idx
  ON handoff_snapshots (compiled_at DESC)
;

-- Watermark cursor queries (find prior watermark, next compile reads events above it)
CREATE INDEX handoff_snapshots_watermark_idx
  ON handoff_snapshots (watermark_event_seq DESC)
;

-- Semantic recall over snapshot content
CREATE INDEX handoff_snapshots_embedding_idx
  ON handoff_snapshots USING hnsw (embedding extensions.vector_cosine_ops)
;

-- Idempotent replay
CREATE UNIQUE INDEX handoff_snapshots_client_request_id_idx
  ON handoff_snapshots (client_request_id)
  WHERE client_request_id IS NOT NULL
;

-- RLS: service-role only at V1.
ALTER TABLE handoff_snapshots ENABLE ROW LEVEL SECURITY
;

CREATE POLICY "Service role full access on handoff_snapshots"
  ON handoff_snapshots FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;

GRANT SELECT, INSERT, UPDATE, DELETE ON handoff_snapshots TO service_role
;
