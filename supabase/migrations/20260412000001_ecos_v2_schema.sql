-- ECOS v2.0 Schema Migration
-- Additive only — no existing data affected
-- Applies to: thoughts table (already exists with content, embedding, metadata, created_at)
-- Adds: canonicality controls, source tracking, momentum groundwork

-- Canonicality controls
ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'current'
  CHECK (status IN ('current', 'superseded', 'archived')),
ADD COLUMN IF NOT EXISTS source_id TEXT;

-- Momentum groundwork — node level
ALTER TABLE thoughts
ADD COLUMN IF NOT EXISTS retrieval_count INTEGER DEFAULT 0;

-- Momentum groundwork — co-retrieval log
CREATE TABLE IF NOT EXISTS retrieval_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query TEXT,
  retrieved_thought_ids UUID[],
  retrieved_at TIMESTAMP DEFAULT now()
);

-- Thought history table — required for F2 edit/delete tools
CREATE TABLE IF NOT EXISTS thought_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original_thought_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  version INTEGER DEFAULT 1,
  action TEXT CHECK (action IN ('updated', 'deleted')),
  archived_at TIMESTAMP DEFAULT now()
);
