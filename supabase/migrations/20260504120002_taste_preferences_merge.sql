-- Merge Branch B (capture-shape) columns into Branch A (runtime-tracking) table.
-- The new write flow (capture_taste_preference MCP tool) populates the merged
-- columns; type_label is the primary user-facing type field.
-- constraint_type is relaxed to free text + nullable; the original CHECK
-- (aesthetic|register|process|affirmation) doesn't fit Levi's actual usage,
-- which uses slash-format labels like "Session discipline / Process".

ALTER TABLE taste_preferences
  ADD COLUMN IF NOT EXISTS preference_name TEXT,
  ADD COLUMN IF NOT EXISTS reject TEXT,
  ADD COLUMN IF NOT EXISTS want TEXT,
  ADD COLUMN IF NOT EXISTS type_label TEXT,
  ADD COLUMN IF NOT EXISTS thought_id UUID REFERENCES thoughts(id) ON DELETE SET NULL;

ALTER TABLE taste_preferences DROP CONSTRAINT IF EXISTS taste_preferences_constraint_type_check;
ALTER TABLE taste_preferences ALTER COLUMN constraint_type DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_taste_preferences_thought_id ON taste_preferences(thought_id);
CREATE INDEX IF NOT EXISTS idx_taste_preferences_status_domain ON taste_preferences(status, domain);
CREATE INDEX IF NOT EXISTS idx_taste_evolution_taste_id ON taste_evolution(taste_id);
