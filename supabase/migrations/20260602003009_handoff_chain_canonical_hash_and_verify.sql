-- Canonical hash: single source of truth, used by trigger + backfill + verify.
-- Input = authored fields only; excludes server/operational metadata (created_at, client_ts, metadata, client_request_id, id).
create or replace function public.handoff_event_hash(
  p_event_seq bigint, p_event_type text, p_content text, p_refs jsonb,
  p_session_id text, p_surface text, p_occurred_at timestamptz
) returns text language sql immutable as $$
  select encode(sha256(convert_to(
    jsonb_build_object(
      'event_seq',   p_event_seq,
      'event_type',  p_event_type,
      'content',     coalesce(p_content, ''),
      'refs',        coalesce(p_refs, '{}'::jsonb),
      'session_id',  p_session_id,
      'surface',     p_surface,
      'occurred_at', p_occurred_at
    )::text, 'UTF8')), 'hex');
$$;
comment on function public.handoff_event_hash is
  'Canonical content hash for a handoff_events row. Input = jsonb object of authored fields {event_seq,event_type,content,refs,session_id,surface,occurred_at}, jsonb-serialized (key-sorted) and sha256-hashed. EXCLUDES server/operational metadata (created_at, client_ts, metadata, client_request_id, id) so the same logical row always hashes the same way. To change the field set, recompute all rows + chain.';

-- BEFORE INSERT stamper now uses the canonical hash.
create or replace function public.handoff_events_set_hash()
returns trigger language plpgsql as $$
begin
  new.content_hash := public.handoff_event_hash(new.event_seq, new.event_type, new.content, new.refs, new.session_id, new.surface, new.occurred_at);
  select he.content_hash into new.prev_content_hash
    from public.handoff_events he
    where he.event_seq < new.event_seq
    order by he.event_seq desc
    limit 1;
  return new;
end;
$$;
comment on column public.handoff_events.prev_content_hash is
  'Best-effort chain cache: content_hash of the immediately-prior event by event_seq, stamped at insert. AUTHORITATIVE integrity = handoff_verify_chain()/handoff_repair_chain() over the canonical event_seq order. Under concurrent appends the write-time value can fork; repair reconciles it.';

-- Audit: detects tampering (recomputed-hash mismatch) AND chain forks/breaks (prev <> prior-by-seq). Empty = clean. Race-proof (computed over committed event_seq order).
create or replace function public.handoff_verify_chain()
returns table(issue text, event_seq bigint, detail text) language sql stable as $$
  with c as (
    select he.event_seq, he.content_hash, he.prev_content_hash,
           public.handoff_event_hash(he.event_seq, he.event_type, he.content, he.refs, he.session_id, he.surface, he.occurred_at) as recomputed,
           lag(he.content_hash) over (order by he.event_seq) as expected_prev
    from public.handoff_events he
  )
  select 'content_hash_mismatch'::text, c.event_seq, 'stored content_hash <> recomputed canonical hash (possible tamper / out-of-band edit)'::text
    from c where c.content_hash is distinct from c.recomputed
  union all
  select 'chain_break'::text, c.event_seq, 'prev_content_hash <> prior event hash by event_seq (fork/gap)'::text
    from c where c.prev_content_hash is distinct from c.expected_prev;
$$;

-- Repair ONLY the chain cache (prev_content_hash) from canonical event_seq order. Never touches content_hash (that's tamper evidence — flag, don't auto-fix). Returns rows repaired.
create or replace function public.handoff_repair_chain()
returns integer language plpgsql as $$
declare n integer;
begin
  with p as (select event_seq, lag(content_hash) over (order by event_seq) as expected_prev from public.handoff_events)
  update public.handoff_events e
     set prev_content_hash = p.expected_prev
    from p
   where e.event_seq = p.event_seq
     and e.prev_content_hash is distinct from p.expected_prev;
  get diagnostics n = row_count;
  return n;
end;
$$
;
