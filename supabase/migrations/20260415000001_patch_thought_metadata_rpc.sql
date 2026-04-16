-- patch_thought_metadata: merge a JSONB patch into an existing thought's metadata
-- without touching content or embedding. Used by the backfill agent workflow.
-- The || operator merges JSONB objects; right-side keys win on collision.

CREATE OR REPLACE FUNCTION patch_thought_metadata(
  thought_id uuid,
  patch jsonb
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE thoughts
  SET metadata = metadata || patch
  WHERE id = thought_id;
$$;
