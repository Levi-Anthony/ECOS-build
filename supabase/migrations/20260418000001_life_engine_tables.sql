-- Life Engine tables for N2 Heartbeat (ECOS adaptation of OB1 Life Engine)
-- Single-user deployment — no user_id column; service_role handles auth

CREATE TABLE IF NOT EXISTS life_engine_habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT DEFAULT 'daily'
    CHECK (frequency IN ('daily', 'weekdays', 'weekends', 'weekly', 'custom')),
  time_of_day TEXT DEFAULT 'morning'
    CHECK (time_of_day IN ('morning', 'midday', 'evening', 'anytime')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_engine_habit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  habit_id UUID REFERENCES life_engine_habits(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS life_engine_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  checkin_type TEXT NOT NULL
    CHECK (checkin_type IN ('mood', 'energy', 'health', 'custom')),
  value TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_engine_briefings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_type TEXT NOT NULL
    CHECK (briefing_type IN ('morning', 'pre_meeting', 'checkin', 'evening', 'habit_reminder', 'weekly_review', 'custom')),
  content TEXT NOT NULL,
  delivered_via TEXT DEFAULT 'telegram',
  user_responded BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_engine_evolution (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  change_type TEXT NOT NULL
    CHECK (change_type IN ('added', 'removed', 'modified')),
  description TEXT NOT NULL,
  reason TEXT,
  approved BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS life_engine_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_le_habit_log_habit_date ON life_engine_habit_log(habit_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_checkins_date ON life_engine_checkins(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_briefings_type_date ON life_engine_briefings(briefing_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_evolution_date ON life_engine_evolution(created_at DESC);

-- Auto-update timestamp on habits
CREATE OR REPLACE FUNCTION update_life_engine_habits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER life_engine_habits_updated
  BEFORE UPDATE ON life_engine_habits
  FOR EACH ROW
  EXECUTE FUNCTION update_life_engine_habits_updated_at();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.life_engine_habits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.life_engine_habit_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.life_engine_checkins TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.life_engine_briefings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.life_engine_evolution TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.life_engine_state TO service_role;

-- Seed ECOS defaults
INSERT INTO life_engine_state (key, value) VALUES
  ('wake_time',  '06:00'),
  ('sleep_time', '22:00'),
  ('latitude',   '32.2226'),
  ('longitude',  '-110.9747')
ON CONFLICT (key) DO NOTHING;
