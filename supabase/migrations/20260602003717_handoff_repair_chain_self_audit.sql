-- Return type changes (integer -> table), so drop then recreate. Function is new this session, no dependents.
drop function if exists public.handoff_repair_chain();

-- Repair the chain projection AND leave an audit breadcrumb in the ledger. Self-evidencing: cannot repair without recording it.
create or replace function public.handoff_repair_chain(
  p_session_id text default 'system-maintenance',
  p_surface    text default 'maintenance'
)
returns table(rows_repaired integer, content_mismatches integer, breadcrumb_event_seq bigint)
language plpgsql as $$
declare
  v_repaired   integer;
  v_mismatches integer;
  v_seq        bigint;
begin
  -- count content_hash mismatches at repair time (these are NOT touched — surfaced for the breadcrumb)
  select count(*) into v_mismatches
    from public.handoff_events he
    where he.content_hash is distinct from
          public.handoff_event_hash(he.event_seq, he.event_type, he.content, he.refs, he.session_id, he.surface, he.occurred_at);

  -- repair ONLY the prev_content_hash projection, from canonical event_seq order
  with p as (select event_seq, lag(content_hash) over (order by event_seq) as expected_prev from public.handoff_events)
  update public.handoff_events e
     set prev_content_hash = p.expected_prev
    from p
   where e.event_seq = p.event_seq
     and e.prev_content_hash is distinct from p.expected_prev;
  get diagnostics v_repaired = row_count;

  -- audit breadcrumb: counts go in metadata (operational), and in content (hash-covered authoritative record). refs stays {} so no spurious links.
  insert into public.handoff_events (session_id, surface, event_type, content, metadata)
  values (
    p_session_id, p_surface, 'integrity_repair',
    format('handoff_repair_chain() run: %s prev_content_hash projection row(s) repaired; %s content_hash mismatch(es) present at repair time (NOT modified — content mismatches require investigation, not repair).', v_repaired, v_mismatches),
    jsonb_build_object('rows_repaired', v_repaired, 'content_mismatches', v_mismatches, 'function', 'handoff_repair_chain')
  )
  returning event_seq into v_seq;

  return query select v_repaired, v_mismatches, v_seq;
end;
$$;
comment on function public.handoff_repair_chain(text, text) is
  'Repairs prev_content_hash projection from canonical event_seq order and appends a self-audit integrity_repair event (counts in content (hash-covered) + metadata). Never modifies content_hash. Run only after handoff_verify_chain() shows chain_break rows. content_mismatch rows are reported but require investigation, not repair.'
;
