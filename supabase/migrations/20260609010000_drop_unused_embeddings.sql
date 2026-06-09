-- Migration: drop synchronous embedding requirement from pulse_entries and handoff_snapshots.
--
-- Context: pulse entries and handoff snapshots were embedded synchronously on every write
-- (blocking ~300ms per write on an OpenRouter call) but neither table has any semantic search
-- RPC — list_recent_pulse is purely temporal, get_latest_handoff_snapshot is a single
-- is_current=TRUE lookup. The embedding columns exist but are never queried semantically.
--
-- Changes:
--   1. pulse_entries.embedding  — DROP NOT NULL (column retained for future use)
--   2. handoff_snapshots.embedding — DROP NOT NULL (column retained for future use)
--   3. save_handoff_snapshot_tx RPC — make p_embedding optional (DEFAULT NULL)
--
-- The MCP tools log_pulse and save_handoff_snapshot will stop passing embeddings after
-- the corresponding TypeScript change lands. No data migration needed (existing rows
-- keep their embeddings; future rows will have NULL).

-- 1. Make pulse_entries.embedding nullable.
ALTER TABLE public.pulse_entries
  ALTER COLUMN embedding DROP NOT NULL;

-- 2. Make handoff_snapshots.embedding nullable.
ALTER TABLE public.handoff_snapshots
  ALTER COLUMN embedding DROP NOT NULL;

-- 3. Replace save_handoff_snapshot_tx with a version that accepts NULL embedding.
--    Signature is unchanged (same parameter types), only the DEFAULT is added.
--    The REVOKE/GRANT below match the original signature and remain valid.

CREATE OR REPLACE FUNCTION public.save_handoff_snapshot_tx(
  p_compiled_by        text,
  p_source_session_id  text,
  p_source_event_ids   uuid[],
  p_content            text,
  p_embedding          extensions.vector(1536) DEFAULT NULL,
  p_metadata           jsonb,
  p_client_request_id  text DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  compiled_at           timestamptz,
  watermark_event_seq   bigint,
  watermark_occurred_at timestamptz,
  is_current            boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_watermark_event_seq   bigint;
  v_watermark_occurred_at timestamptz;
  v_metadata              jsonb;
  v_new_id                uuid;
  v_compiled_at           timestamptz;
  v_provided_count        int;
  v_found_count           int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ecbrain.handoff_snapshot_save'));

  IF p_source_event_ids IS NOT NULL AND array_length(p_source_event_ids, 1) > 0 THEN

    v_provided_count := array_length(p_source_event_ids, 1);

    SELECT
      COUNT(*)::int,
      MAX(he.event_seq),
      MAX(he.occurred_at)
    INTO
      v_found_count,
      v_watermark_event_seq,
      v_watermark_occurred_at
    FROM public.handoff_events he
    WHERE he.id = ANY(p_source_event_ids);

    IF v_found_count <> v_provided_count THEN
      RAISE EXCEPTION
        'save_handoff_snapshot_tx: % of % source_event_ids not found in handoff_events. '
        'Correct the IDs or pass an empty array to use the prior watermark (manual override).',
        (v_provided_count - v_found_count), v_provided_count;
    END IF;

    v_metadata := p_metadata;

  ELSE
    v_watermark_event_seq := COALESCE(
      (SELECT hs.watermark_event_seq
       FROM public.handoff_snapshots hs
       WHERE hs.is_current = TRUE
       LIMIT 1),
      0
    );
    v_watermark_occurred_at := NULL;
    v_metadata := p_metadata || '{"warning": "empty_source_event_ids"}'::jsonb;

  END IF;

  UPDATE public.handoff_snapshots AS hs
  SET is_current = FALSE
  WHERE hs.is_current = TRUE;

  INSERT INTO public.handoff_snapshots (
    compiled_by,
    source_session_id,
    source_event_ids,
    watermark_event_seq,
    watermark_occurred_at,
    content,
    embedding,
    metadata,
    is_current,
    client_request_id
  )
  VALUES (
    p_compiled_by,
    p_source_session_id,
    COALESCE(p_source_event_ids, ARRAY[]::uuid[]),
    v_watermark_event_seq,
    v_watermark_occurred_at,
    p_content,
    p_embedding,
    v_metadata,
    TRUE,
    p_client_request_id
  )
  RETURNING
    public.handoff_snapshots.id,
    public.handoff_snapshots.compiled_at
  INTO
    v_new_id,
    v_compiled_at;

  RETURN QUERY
  SELECT
    v_new_id,
    v_compiled_at,
    v_watermark_event_seq,
    v_watermark_occurred_at,
    TRUE::boolean;
END;
$$
;
