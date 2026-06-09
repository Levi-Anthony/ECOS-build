-- Migration: add notes column to artifacts + set_artifact_notes_tx RPC.
--
-- Context: agents submit proposals and humans approve them, but there is no
-- persistent free-text annotation channel on the artifact itself. If a human
-- wants to leave standing context ("always gate this; see 2026-05-15 incident"),
-- there is nowhere to put it that surfaces when agents fetch the artifact.
--
-- Changes:
--   1. artifacts.notes TEXT (nullable) — human-written standing annotation
--   2. set_artifact_notes_tx RPC — authenticated-only direct update (human door);
--      separate from apply_artifact_human_patch_tx so notes don't create
--      artifact_revisions rows (notes are out-of-band human commentary, not
--      versioned content)

-- 1. Add notes column.
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Create set_artifact_notes_tx.
CREATE OR REPLACE FUNCTION public.set_artifact_notes_tx(
  p_key   text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_artifact_id uuid;
BEGIN
  SELECT id INTO v_artifact_id FROM public.artifacts WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ARTIFACT_NOT_FOUND: %', p_key;
  END IF;

  UPDATE public.artifacts
  SET notes = NULLIF(TRIM(p_notes), '')
  WHERE id = v_artifact_id;

  RETURN jsonb_build_object('ok', true, 'key', p_key);
END;
$$;

REVOKE ALL ON FUNCTION public.set_artifact_notes_tx(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_artifact_notes_tx(text, text) TO authenticated;
