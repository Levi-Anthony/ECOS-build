
-- 20260506_taste_evidence_confidence.sql
alter table public.taste_preferences
  add column if not exists evidence text,
  add column if not exists confidence text;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'taste_preferences_confidence_check'
      and conrelid = 'public.taste_preferences'::regclass
  ) then
    alter table public.taste_preferences
      add constraint taste_preferences_confidence_check
      check (
        confidence is null
        or confidence in ('low', 'medium', 'high')
      );
  end if;
end $$;
comment on column public.taste_preferences.evidence is
  'Brief human-readable reason this preference exists. Points to the source reaction, pattern, or explicit statement.';
comment on column public.taste_preferences.confidence is
  'low, medium, or high. How durable the preference appears — not how strongly worded it is.'
;
