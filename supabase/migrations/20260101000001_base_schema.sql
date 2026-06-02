-- search_path fix (backfilled): pgvector lives in `extensions`; this migration
-- references vector(1536) unqualified, which a clean `supabase db reset` runs
-- public-only. Matches the convention in fix_thought_history / canonical_artifacts.
SET search_path = public, extensions;

-- Base schema — must run before all other migrations.
-- Creates the thoughts and thought_history tables from scratch.
-- Subsequent migrations ALTER these tables; this is the cold-start foundation.

-- pgvector extension (required for vector(1536) columns and <=> operator)
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Core memory table
CREATE TABLE IF NOT EXISTS thoughts (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  content     TEXT        NOT NULL,
  embedding   vector(1536),
  metadata    JSONB       DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Archive table — written by archiveToHistory() in brain-middleware and open-brain-mcp
-- before any update or delete. Preserves the pre-change state of each thought.
-- Column names match what the code actually writes (not the v2 migration assumption).
CREATE TABLE IF NOT EXISTS thought_history (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  original_thought_id  UUID        NOT NULL,
  content              TEXT        NOT NULL,
  embedding            vector(1536),
  type                 TEXT,
  topics               TEXT[]      DEFAULT '{}',
  people               TEXT[]      DEFAULT '{}',
  actions              TEXT[]      DEFAULT '{}',
  archived_reason      TEXT,
  archived_by          TEXT,
  archived_at          TIMESTAMPTZ DEFAULT now()
);
