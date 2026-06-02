DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'retrieval_sessions','thought_history','pulse_log_legacy','taste_preferences',
    'taste_evolution','it_service_logs','life_engine_habits','life_engine_habit_log',
    'life_engine_checkins','life_engine_briefings','life_engine_evolution','life_engine_state'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON public.%I;', t);
    EXECUTE format($p$CREATE POLICY "Service role full access" ON public.%I AS PERMISSIVE FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');$p$, t);
  END LOOP;
END $$
;
