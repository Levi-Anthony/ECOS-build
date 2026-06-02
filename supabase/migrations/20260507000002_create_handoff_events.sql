-- Migration: create handoff_events
-- ECBRAIN V1 — append-only events that contribute to handoff snapshot compilation.
-- Architecture ref: §3.2, §3.7. Errata ref: §1 (event_seq is monotonic, not gap-free),
-- §5 (client_request_id).
--
-- event_seq: server-assigned monotonic cursor via IDENTITY. Gaps are allowed and expected
-- (INSERT failures, rolled-back transactions). Do not assume contiguous values.
-- Snapshot compilation uses: event_seq > watermark_event_seq.
--
-- No embedding column: handoff events are operational. The compiled snapshot is
-- what gets semantically searched (deferred to V1.5).
--
-- client_request_id: nullable idempotency key for offline outbox replay.

CREATE TABLE handoff_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_seq          BIGINT      GENERATED ALWAYS AS IDENTITY,
  session_id         TEXT        NOT NULL,
  surface            TEXT        NOT NULL,
  event_type         TEXT        NOT NULL,
  content            TEXT        NOT NULL,
  refs               JSONB       NOT NULL DEFAULT '{}'::jsonb,
  metadata           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_ts          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_request_id  TEXT
)
;

-- event_seq uniqueness (explicit enforcement; IDENTITY already sequences monotonically)
CREATE UNIQUE INDEX handoff_events_seq_idx
  ON handoff_events (event_seq)
;

-- Session-scoped reads
CREATE INDEX handoff_events_session_idx
  ON handoff_events (session_id, occurred_at DESC)
;

-- Type-scoped reads (e.g. list open_loop_added events)
CREATE INDEX handoff_events_type_idx
  ON handoff_events (event_type, occurred_at DESC)
;

-- Chronology queries
CREATE INDEX handoff_events_occurred_idx
  ON handoff_events (occurred_at DESC)
;

-- Cursor queries: event_seq > watermark_event_seq
CREATE INDEX handoff_events_seq_consumed_idx
  ON handoff_events (event_seq)
;

-- Idempotent replay
CREATE UNIQUE INDEX handoff_events_client_request_id_idx
  ON handoff_events (client_request_id)
  WHERE client_request_id IS NOT NULL
;

-- RLS: service-role only at V1.
ALTER TABLE handoff_events ENABLE ROW LEVEL SECURITY
;

CREATE POLICY "Service role full access on handoff_events"
  ON handoff_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role')
;

GRANT SELECT, INSERT, UPDATE, DELETE ON handoff_events TO service_role
;

-- Explicit sequence grant for IDENTITY column (required for service_role inserts).
-- Sequence name: handoff_events_event_seq_seq (Postgres auto-naming convention).
GRANT USAGE, SELECT ON SEQUENCE handoff_events_event_seq_seq TO service_role
;
