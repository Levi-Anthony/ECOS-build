-- 1. Edge table: first-class, typed, multi-valued event relationships (replaces the scalar-column idea)
create table if not exists public.handoff_event_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.handoff_events(id) on delete cascade,
  relationship_type text not null,            -- the refs key / role (supersedes_event_seq, artifact, flagged_artifact, derived_from, ...)
  linked_kind text not null default 'text',   -- shape: 'event_seq' | 'uuid' | 'text'
  linked_uuid uuid,                            -- populated when target is a uuid
  linked_seq bigint,                           -- populated when target is an event_seq
  linked_value jsonb not null,                 -- lossless original value
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_hel_event_id on public.handoff_event_links(event_id);
create index if not exists idx_hel_linked_uuid on public.handoff_event_links(linked_uuid) where linked_uuid is not null;
create index if not exists idx_hel_linked_seq on public.handoff_event_links(linked_seq) where linked_seq is not null;
create index if not exists idx_hel_relationship_type on public.handoff_event_links(relationship_type);

alter table public.handoff_event_links enable row level security;
create policy "Service role full access on handoff_event_links"
  on public.handoff_event_links for all to public
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- 2. Tamper-evident hash chain on the event ledger
alter table public.handoff_events add column if not exists content_hash text;
alter table public.handoff_events add column if not exists prev_content_hash text;

-- 3. Self-maintaining triggers (no edge-function change needed)

-- 3a. BEFORE INSERT: stamp content hash + link to prior event's hash (the chain)
create or replace function public.handoff_events_set_hash()
returns trigger language plpgsql as $$
begin
  new.content_hash := encode(sha256(coalesce(new.content,'')::bytea),'hex');
  select he.content_hash into new.prev_content_hash
    from public.handoff_events he
    where he.event_seq < new.event_seq
    order by he.event_seq desc
    limit 1;
  return new;
end;
$$;

-- 3b. AFTER INSERT: explode refs jsonb into first-class link rows; guarded so it can NEVER block an append
create or replace function public.handoff_events_explode_refs()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  begin
    insert into public.handoff_event_links (event_id, relationship_type, linked_kind, linked_uuid, linked_seq, linked_value)
    select
      new.id,
      kv.key,
      case
        when jsonb_typeof(elem.v) = 'number' then 'event_seq'
        when jsonb_typeof(elem.v) = 'string'
             and (elem.v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'uuid'
        else 'text'
      end,
      case when jsonb_typeof(elem.v) = 'string'
                and (elem.v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (elem.v #>> '{}')::uuid else null end,
      case when jsonb_typeof(elem.v) = 'number' then (elem.v #>> '{}')::bigint else null end,
      elem.v
    from jsonb_each(coalesce(new.refs,'{}'::jsonb)) as kv(key, value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(kv.value) = 'array' then kv.value else jsonb_build_array(kv.value) end
    ) as elem(v);
  exception when others then
    raise warning 'handoff_events_explode_refs failed for event %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_handoff_events_set_hash on public.handoff_events;
create trigger trg_handoff_events_set_hash
  before insert on public.handoff_events
  for each row execute function public.handoff_events_set_hash();

drop trigger if exists trg_handoff_events_explode_refs on public.handoff_events;
create trigger trg_handoff_events_explode_refs
  after insert on public.handoff_events
  for each row execute function public.handoff_events_explode_refs()
;
