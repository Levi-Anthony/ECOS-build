-- Prelude: enable extensions before any migration uses them. Sorts first.
-- NOTE: search_path is NOT fixed here — `supabase db reset` resets search_path
-- per migration (dedicated login role), so a SET/ALTER DATABASE in this prelude
-- does not carry. Each early migration that references unqualified vector(1536)
-- sets its own `search_path = public, extensions` (the repo's later convention).
CREATE EXTENSION IF NOT EXISTS vector       WITH SCHEMA extensions;  -- pgvector (required)
CREATE EXTENSION IF NOT EXISTS pgcrypto     WITH SCHEMA extensions;  -- parity w/ prod
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"  WITH SCHEMA extensions;  -- parity w/ prod
