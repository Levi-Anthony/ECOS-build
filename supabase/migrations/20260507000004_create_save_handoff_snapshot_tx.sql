-- Migration: save_handoff_snapshot_tx RPC
-- ECBRAIN V1 — transactional snapshot save. Called by the TypeScript MCP tool
-- after computing the embedding. Receives the precomputed embedding as a parameter
-- to keep the advisory lock window minimal.
-- Architecture ref: §3.6 (advisory lock, partial unique index). Errata ref: §2, §3, §4.
--
-- Errata §2: embedding is computed in TypeScript BEFORE this RPC is called.
-- Errata §3: multi-statement transaction lives here, not in separate Supabase client calls.
--
-- SECURITY DEFINER hardening (v3.2 pre-Phase-2 patch):
--   search_path: SET search_path = public, pg_temp (prevents search_path hijack).
--   All table references schema-qualified (public.handoff_events, public.handoff_snapshots).
--   REVOKE ALL from PUBLIC, anon, authenticated before service_role GRANT.
--   No dynamic SQL anywhere in the function body.
--
-- Advisory lock key: hashtext('ecbrain.handoff_snapshot_save')
-- Lock scope: transaction (released automatically at commit or rollback).
-- Single-user operational state machine; lock contention cost is negligible.
--
-- source_event_ids resolution policy:
--   EMPTY array or NULL → allowed. Watermark falls back to prior snapshot watermark (or 0).
--     Metadata warning: {"warning": "empty_source_event_ids"}.
--   NON-EMPTY array with ALL IDs found → normal path.
--   NON-EMPTY array with ANY ID not found in handoff_events → RAISE EXCEPTION.
--     Rationale: a typo in source_event_ids must not silently produce a misleading watermark.
--     Fix: either correct the IDs, or pass an empty array to trigger the manual-override path.

CREATE OR REPLACE FUNCTION public.save_handoff_snapshot_tx(
  p_compiled_by        text,
  p_source_session_id  text,
  p_source_event_ids   uuid[],
  p_content            text,
  p_embedding          extensions.vector(1536),
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
  -- Serialize all snapshot saves cluster-wide.
  -- Lock is transaction-scoped; released at COMMIT or ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtext('ecbrain.handoff_snapshot_save'));

  -- Resolve watermark from source_event_ids.
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

    -- Reject if any provided IDs were not found. A partial or total miss is most
    -- likely a client bug (stale IDs, typo). Client must correct IDs or use empty
    -- array for an explicit manual-override snapshot.
    IF v_found_count <> v_provided_count THEN
      RAISE EXCEPTION
        'save_handoff_snapshot_tx: % of % source_event_ids not found in handoff_events. '
        'Correct the IDs or pass an empty array to use the prior watermark (manual override).',
        (v_provided_count - v_found_count), v_provided_count;
    END IF;

    v_metadata := p_metadata;

  ELSE
    -- Empty or NULL source_event_ids: manual-override path.
    -- Watermark falls back to the current snapshot's watermark, or 0 if none exists.
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

  -- Flip the previous current snapshot.
  -- Table alias required: RETURNS TABLE declares is_current as an output variable,
  -- making unqualified WHERE is_current = TRUE ambiguous in PL/pgSQL.
  UPDATE public.handoff_snapshots AS hs
  SET is_current = FALSE
  WHERE hs.is_current = TRUE;

  -- Insert the new current snapshot.
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

-- Explicit permission lockdown for SECURITY DEFINER function.
-- REVOKE from PUBLIC first (Postgres grants EXECUTE to PUBLIC by default),
-- then from Supabase roles that must not call this directly.
REVOKE ALL ON FUNCTION public.save_handoff_snapshot_tx(
  text, text, uuid[], text, extensions.vector(1536), jsonb, text
) FROM PUBLIC
;

REVOKE ALL ON FUNCTION public.save_handoff_snapshot_tx(
  text, text, uuid[], text, extensions.vector(1536), jsonb, text
) FROM anon
;

REVOKE ALL ON FUNCTION public.save_handoff_snapshot_tx(
  text, text, uuid[], text, extensions.vector(1536), jsonb, text
) FROM authenticated
;

GRANT EXECUTE ON FUNCTION public.save_handoff_snapshot_tx(
  text, text, uuid[], text, extensions.vector(1536), jsonb, text
) TO service_role
;
