-- All writers confirmed deployed and populating original_content.
-- Drop the empty-string default so future bugs surface as constraint
-- violations instead of silent empty strings.

ALTER TABLE thoughts ALTER COLUMN original_content DROP DEFAULT;
ALTER TABLE thought_history ALTER COLUMN original_content DROP DEFAULT;
