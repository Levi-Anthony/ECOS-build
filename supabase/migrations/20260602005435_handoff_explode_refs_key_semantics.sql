-- DRY: one definition of the refs->links projection, shared by trigger + backfill.
-- Key-semantics: event_seq detection is by KEY NAME, not value shape, so a stray number can't mint a phantom edge.
create or replace function public.handoff_explode_refs(p_event_id uuid, p_refs jsonb)
returns table(event_id uuid, relationship_type text, linked_kind text, linked_uuid uuid, linked_seq bigint, linked_value jsonb)
language sql immutable as $$
  select
    p_event_id,
    kv.key,
    case
      when kv.key ~ '(^|_)event_seq$' and jsonb_typeof(elem.v) = 'number' then 'event_seq'
      when jsonb_typeof(elem.v) = 'string'
           and (elem.v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'uuid'
      else 'text'
    end,
    case when jsonb_typeof(elem.v) = 'string'
              and (elem.v #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (elem.v #>> '{}')::uuid else null end,
    case when kv.key ~ '(^|_)event_seq$' and jsonb_typeof(elem.v) = 'number'
         then (elem.v #>> '{}')::bigint else null end,
    elem.v
  from jsonb_each(coalesce(p_refs, '{}'::jsonb)) as kv(key, value)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(kv.value) = 'array' then kv.value else jsonb_build_array(kv.value) end
  ) as elem(v);
$$;
comment on function public.handoff_explode_refs is
  'Canonical refs->handoff_event_links projection (single source of truth: AFTER-insert trigger + backfill both call it). Key-semantics: keys matching (^|_)event_seq$ with numeric values -> event_seq link; uuid-shaped string values -> uuid link; everything else -> text link (lossless in linked_value). Convention: refs is references-only; non-reference numbers (counts/years/amounts) land as text, never phantom event_seq edges.';

-- Trigger now delegates to the canonical function.
create or replace function public.handoff_events_explode_refs()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  begin
    insert into public.handoff_event_links (event_id, relationship_type, linked_kind, linked_uuid, linked_seq, linked_value)
    select event_id, relationship_type, linked_kind, linked_uuid, linked_seq, linked_value
    from public.handoff_explode_refs(new.id, new.refs);
  exception when others then
    raise warning 'handoff_events_explode_refs failed for event %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$
;
