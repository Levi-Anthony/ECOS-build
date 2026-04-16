-- ECOS relationship intelligence extensions
-- Additive only — no existing data affected.
-- taste_preferences: Branch A (table did not exist in Supabase).

-- ─── CRM extensions ───────────────────────────────────────────────────────────

ALTER TABLE professional_contacts
  ADD COLUMN IF NOT EXISTS relationship_domain TEXT NOT NULL DEFAULT 'general'
    CHECK (relationship_domain IN ('tango','ttc','outreach','it','music','personal','general')),
  ADD COLUMN IF NOT EXISTS administrative_status TEXT NOT NULL DEFAULT 'active'
    CHECK (administrative_status IN ('active','passive','administrative_closed','community')),
  ADD COLUMN IF NOT EXISTS thought_links JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_contacts_domain
  ON professional_contacts(user_id, relationship_domain);
CREATE INDEX IF NOT EXISTS idx_contacts_admin_status
  ON professional_contacts(user_id, administrative_status);

-- ─── TASTE persistence layer (Branch A — new table) ──────────────────────────

CREATE TABLE IF NOT EXISTS taste_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  constraint_type TEXT NOT NULL
    CHECK (constraint_type IN ('aesthetic','register','process','affirmation')),
  domain TEXT,
  constraint_text TEXT NOT NULL,
  source TEXT,
  contact_id UUID REFERENCES professional_contacts(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived','superseded')),
  invocation_count INTEGER DEFAULT 0,
  last_invoked_at TIMESTAMP,
  user_responded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taste_user_type
  ON taste_preferences(user_id, constraint_type);
CREATE INDEX IF NOT EXISTS idx_taste_domain
  ON taste_preferences(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_taste_status
  ON taste_preferences(user_id, status);

-- ─── TASTE evolution audit trail ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS taste_evolution (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  taste_id UUID NOT NULL REFERENCES taste_preferences(id),
  change_type TEXT NOT NULL
    CHECK (change_type IN ('upgraded','downgraded','refined','archived')),
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  approved BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);
