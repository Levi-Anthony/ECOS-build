-- BRAIN original-text invariant: original_content as a first-class column.
-- Paired with edge function updates that write to this column.
-- DEFAULT '' present during deploy gap; tightened in 20260504120003.

ALTER TABLE thoughts
  ADD COLUMN IF NOT EXISTS original_content TEXT NOT NULL DEFAULT '';

ALTER TABLE thought_history
  ADD COLUMN IF NOT EXISTS original_content TEXT NOT NULL DEFAULT '';

-- Backfill: promote stored originals from metadata where present.
-- Best-effort: rows previously edited via update_thought lost the original-original
-- to a metadata wipe (the prior implementation overwrote metadata wholesale).
-- For those rows, content is the most recent representation and is the best
-- recoverable approximation.
UPDATE thoughts
SET original_content = COALESCE(NULLIF(metadata->>'original_content', ''), content)
WHERE original_content = '';

UPDATE thought_history
SET original_content = content
WHERE original_content = '';

DO $$
DECLARE
  empty_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO empty_count FROM thoughts
    WHERE original_content IS NULL OR original_content = '';
  IF empty_count > 0 THEN
    RAISE WARNING 'thoughts has % rows with empty original_content after backfill', empty_count;
  END IF;
END $$;
