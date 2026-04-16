-- OB1 base CRM tables — cold-start snapshot
-- Idempotent: IF NOT EXISTS, no data affected.
-- Purpose: paper trail for tables already live in Supabase (professional_contacts,
-- contact_interactions, opportunities, pulse_log). Ensures a cold-start can
-- reconstruct the schema from migrations alone.

CREATE TABLE IF NOT EXISTS professional_contacts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  follow_up_date DATE,
  last_contacted DATE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contact_interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES professional_contacts(id),
  interaction_type TEXT NOT NULL,
  summary TEXT,
  notes TEXT,
  occurred_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES professional_contacts(id),
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'prospect'
    CHECK (stage IN ('prospect','qualified','proposal','closed_won','closed_lost')),
  value NUMERIC,
  close_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pulse_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  pulse_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT now()
);
