-- Fix 1: thought_history column mismatch
-- Code writes archived_reason + archived_by; schema only had action + version.
-- Adding the columns the code actually uses. Keeping action column for compatibility.
ALTER TABLE thought_history
ADD COLUMN IF NOT EXISTS archived_reason TEXT,
ADD COLUMN IF NOT EXISTS archived_by TEXT;

-- Fix 2: match_thoughts RPC definition
-- Called by open-brain-mcp and brain-middleware for semantic search.
-- Returns content, metadata, similarity, created_at — matching what both callers expect.
SET search_path = public, extensions;

-- Drop existing function first — required because we're adding created_at to the return type
DROP FUNCTION IF EXISTS match_thoughts(vector, float, int, jsonb);

CREATE FUNCTION match_thoughts(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  created_at timestamp
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) AS similarity,
    created_at
  FROM thoughts
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
