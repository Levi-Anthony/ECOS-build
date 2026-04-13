-- Create the taste_preferences table
create table taste_preferences (
  id uuid default gen_random_uuid() primary key,
  preference_name text not null,
  domain text not null default 'general',
  reject text not null,
  want text not null,
  constraint_type text not null default 'quality standard'
    check (constraint_type in ('domain rule', 'quality standard', 'business logic', 'formatting')),
  created_at timestamptz default now()
);

-- Index for filtering by domain
create index on taste_preferences (domain);

-- Index for filtering by constraint type
create index on taste_preferences (constraint_type);

-- Lock it down (same policy as thoughts table)
alter table taste_preferences enable row level security;

create policy "Service role full access"
  on taste_preferences
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
