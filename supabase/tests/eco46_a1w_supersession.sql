-- ECO-46 A1.W — supersession write-path DB behavior (pgTAP).
-- Owner map (Q2 hybrid): this file owns tests 3, 4, 7 (transactional DB behavior).
-- Tests 1/2/5/6/8/9/10/13 (+11/12 proxy) live in the deno integration harness.
--
-- Test 3: declaring a predecessor sets superseded_by/superseded_at in the SAME
--         transaction as the write (lineage becomes computed-superseded).
-- Test 4: declaring an ALREADY-superseded predecessor fails the WHOLE write
--         (RAISE + full rollback; no partial stamp) — guardrail 3.
-- Test 7: self-supersession trips artifacts_no_self_supersession_chk (DB backstop).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions, pg_temp;

SELECT plan(6);

-- ── Fixtures (torn down by ROLLBACK; never touch real rows) ───────────────────
-- Predecessor P declares nothing.
SELECT create_artifact_v2(
  p_key   := 'eco46_a1w_pred',
  p_title := 'A1.W Predecessor',
  p_id    := '20000000-0000-0000-0000-000000000001'::uuid,
  p_supersede_ids := NULL,
  p_supersession_receipt := '{"declares":"nothing","op_class":"content"}'::jsonb
);

-- Successor S declares P → stamps P in the same transaction.
SELECT create_artifact_v2(
  p_key   := 'eco46_a1w_succ',
  p_title := 'A1.W Successor',
  p_id    := '20000000-0000-0000-0000-000000000002'::uuid,
  p_supersede_ids := ARRAY['20000000-0000-0000-0000-000000000001']::uuid[],
  p_supersession_receipt := '{"declares":["eco46_a1w_pred"],"op_class":"content","ids":["20000000-0000-0000-0000-000000000001"]}'::jsonb
);

-- ── Test 3 — same-transaction stamp lands ─────────────────────────────────────
SELECT is(
  (SELECT superseded_by FROM artifacts WHERE id = '20000000-0000-0000-0000-000000000001'),
  '20000000-0000-0000-0000-000000000002'::uuid,
  'Test 3a: predecessor.superseded_by = successor id (same transaction)'
);
SELECT ok(
  (SELECT superseded_at IS NOT NULL FROM artifacts WHERE id = '20000000-0000-0000-0000-000000000001'),
  'Test 3b: predecessor.superseded_at stamped'
);
SELECT ok(
  (SELECT superseded_by IS NOT NULL FROM artifacts WHERE id = '20000000-0000-0000-0000-000000000001'),
  'Test 3c: lineage_state computes to SUPERSEDED'
);

-- ── Test 4 — declaring an already-superseded predecessor fails the whole write ─
-- P is already superseded (by S). Declaring it again stamps 0 rows ≠ 1 declared → RAISE.
SELECT throws_ok(
  $$ SELECT create_artifact_v2(
       p_key   := 'eco46_a1w_succ2',
       p_title := 'A1.W Successor 2',
       p_id    := '20000000-0000-0000-0000-000000000003'::uuid,
       p_supersede_ids := ARRAY['20000000-0000-0000-0000-000000000001']::uuid[],
       p_supersession_receipt := '{"declares":["eco46_a1w_pred"],"op_class":"content"}'::jsonb
     ) $$,
  'P0001', NULL,
  'Test 4a: declaring an already-superseded predecessor raises (SUPERSESSION_PREDECESSOR_NOT_CURRENT)'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM artifacts WHERE key = 'eco46_a1w_succ2'),
  'Test 4b: the failed write rolled back — successor 2 was never created'
);

-- ── Test 7 — self-supersession trips the DB CHECK ─────────────────────────────
SELECT create_artifact_v2(
  p_key   := 'eco46_a1w_selftest',
  p_title := 'A1.W Self Test',
  p_id    := '20000000-0000-0000-0000-000000000004'::uuid,
  p_supersede_ids := NULL,
  p_supersession_receipt := '{"declares":"nothing"}'::jsonb
);
SELECT throws_ok(
  $$ UPDATE artifacts
       SET superseded_by = id, superseded_at = now()
       WHERE id = '20000000-0000-0000-0000-000000000004' $$,
  '23514', NULL,
  'Test 7: self-supersession violates artifacts_no_self_supersession_chk'
);

SELECT * FROM finish();
ROLLBACK;
