begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select has_table('ssmm_spike1', 'sessions', 'sessions projection exists');
select has_table('ssmm_spike1', 'events', 'append-only events exist');
select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ssmm_spike1' and c.relname = 'sessions'
  ),
  'sessions has RLS enabled'
);
select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ssmm_spike1' and c.relname = 'events'
  ),
  'events has RLS enabled'
);

create temporary table test_result as
select ssmm_spike1.apply_runtime_event(
  null,
  'test-request-0001',
  jsonb_build_array(
    jsonb_build_object(
      'event_type', 'sense_answered',
      'actor', 'levi',
      'perspective', 'ul_levi_report',
      'payload', jsonb_build_object('answer', 'The draft is due')
    ),
    jsonb_build_object(
      'event_type', 'field_reflected',
      'actor', 'runtime',
      'perspective', 'proposal',
      'payload', jsonb_build_object('reflection', 'The draft appears salient')
    )
  ),
  'spike1-0.1',
  'spike1-0.1',
  'direct_test',
  'active',
  'field_reflection',
  '{}'::jsonb,
  '{"id":"purpose","label":"Purpose"}'::jsonb,
  '{"id":"orientation","label":"Orientation"}'::jsonb,
  null,
  null,
  null,
  false
) as result;

select is(
  (select jsonb_array_length(result->'events') from test_result),
  2,
  'one request atomically persists two authority-separated events'
);
select is(
  (
    select count(*)::integer
    from ssmm_spike1.events
    where session_id = ((select result->'session'->>'id' from test_result))::uuid
  ),
  2,
  'two event rows exist'
);
select results_eq(
  $$
    select event_type
    from ssmm_spike1.events
    where session_id = ((select result->'session'->>'id' from test_result))::uuid
    order by sequence_number
  $$,
  $$ values ('sense_answered'::text), ('field_reflected'::text) $$,
  'event order preserves Levi report before runtime proposal'
);

create temporary table replay_result as
select ssmm_spike1.apply_runtime_event(
  null,
  'test-request-0001',
  jsonb_build_array(
    jsonb_build_object(
      'event_type', 'runtime_error',
      'actor', 'system',
      'perspective', 'defect',
      'payload', '{}'::jsonb
    )
  ),
  'spike1-0.1',
  'spike1-0.1',
  'direct_test',
  'blocked',
  'wrong',
  '{}'::jsonb,
  '{"id":"wrong","label":"Wrong"}'::jsonb,
  '{"id":"wrong","label":"Wrong"}'::jsonb,
  null,
  null,
  null,
  false
) as result;

select ok(
  (select (result->>'idempotent_replay')::boolean from replay_result),
  'same client event id returns an idempotent replay'
);
select is(
  (
    select count(*)::integer
    from ssmm_spike1.events
    where session_id = ((select result->'session'->>'id' from test_result))::uuid
  ),
  2,
  'replay creates no extra events'
);

update ssmm_spike1.sessions
set closed_at = '2026-01-01T00:00:00Z'::timestamptz
where id = ((select result->'session'->>'id' from test_result))::uuid;

select lives_ok(
  format(
    $sql$
      select ssmm_spike1.apply_runtime_event(
        %L::uuid, 'test-request-0002',
        '[{"event_type":"condition_changed","actor":"levi","perspective":"ul_levi_report","payload":{}}]'::jsonb,
        'spike1-0.1', 'spike1-0.1', 'direct_test', 'active', 'return',
        '{}'::jsonb, '{"id":"purpose","label":"Purpose"}'::jsonb,
        '{"id":"orientation","label":"Orientation"}'::jsonb,
        null, null, null, false
      )
    $sql$,
    (select result->'session'->>'id' from test_result)
  ),
  'non-closing write succeeds'
);
select is(
  (
    select closed_at
    from ssmm_spike1.sessions
    where id = ((select result->'session'->>'id' from test_result))::uuid
  ),
  '2026-01-01T00:00:00Z'::timestamptz,
  'non-closing write preserves closed_at'
);

update ssmm_spike1.sessions
set status = 'completed'
where id = ((select result->'session'->>'id' from test_result))::uuid;

select throws_ok(
  format(
    $sql$
      select ssmm_spike1.apply_runtime_event(
        %L::uuid, 'test-request-0003',
        '[{"event_type":"session_resumed","actor":"system","perspective":"lr_system_evidence","payload":{}}]'::jsonb,
        'spike1-0.1', 'spike1-0.1', 'direct_test', 'active', 'return',
        '{}'::jsonb, '{"id":"purpose","label":"Purpose"}'::jsonb,
        '{"id":"orientation","label":"Orientation"}'::jsonb,
        null, null, null, false
      )
    $sql$,
    (select result->'session'->>'id' from test_result)
  ),
  '55000',
  'terminal_session',
  'terminal sessions cannot be reopened implicitly'
);

select is(
  has_table_privilege('anon', 'ssmm_spike1.sessions', 'select'),
  false,
  'anon has no session read grant'
);
select is(
  has_table_privilege('authenticated', 'ssmm_spike1.events', 'insert'),
  false,
  'authenticated has no event write grant'
);
select is(
  has_table_privilege('service_role', 'ssmm_spike1.sessions', 'select'),
  true,
  'service role has the intended read grant'
);

select * from finish();
rollback;
