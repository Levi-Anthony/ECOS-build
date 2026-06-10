-- Migration: create_artifact authority defect fix — draft-always at birth.
--
-- DEFECT (see ECB fix spec /fix-spec-create-artifact-authority-defect): create_artifact_v2
-- gated to draft/human_gate ONLY for "sensitive" kinds/authority levels; every other
-- agent-created artifact was born status=active, review_policy=live_audit — immediately
-- live, default-searchable, and treated as governing. Authority intent declared in
-- metadata (e.g. review_policy=human_gate) was ignored. Observed: the eval-suite artifact
-- (kind=eval_plan) landed active/live_audit despite human_gate metadata.
--
-- FIX: server-side default flip. The agent create path always inserts status=draft,
-- review_policy=human_gate. Promotion to active flows exclusively through the gated patch
-- path (patch_artifact set_artifact_status / set_review_policy, which auto-routes to human
-- review for human_gate artifacts). The input schema exposes no status/review_policy params,
-- so callers cannot self-promote. No privileged bootstrap bypass is implemented (the spec's
-- T5 path is optional); if one is ever needed it must be server-verified, not caller-asserted.
--
-- Only the status / review_policy decision changes vs the prior definition (was applied in
-- 20260605010000_artifact_v3_human_door.sql). The v_sensitive computation is retained because
-- it still drives the approved_instruction/policy authority_level downgrade.

CREATE OR REPLACE FUNCTION public.create_artifact_v2(
  p_key text,
  p_title text,
  p_kind text DEFAULT 'document'::text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_blocks jsonb DEFAULT '[]'::jsonb,
  p_actor text DEFAULT 'mcp'::text,
  p_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_id UUID;
  v_version INTEGER;
  v_block JSONB;
  v_path TEXT;
  v_content TEXT;
  v_hash TEXT;
  v_block_id UUID;
  v_created JSONB := '[]'::jsonb;
  v_ops JSONB := '[]'::jsonb;
  v_sensitive BOOLEAN;
  v_metadata JSONB;
  v_actor_type TEXT;
  v_actor_id TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM artifacts WHERE key = p_key) THEN
    RAISE EXCEPTION 'KEY_EXISTS: artifact key % already exists', p_key;
  END IF;

  v_sensitive := COALESCE(p_kind, 'document') IN ('policy', 'agent_instruction', 'prompt', 'sop', 'protocol')
    OR COALESCE(p_metadata->>'authority_level', '') IN ('approved_instruction', 'policy')
    OR COALESCE(p_metadata->'tags', '[]'::jsonb) @> '["boot"]'::jsonb;
  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  IF v_sensitive AND v_metadata->>'authority_level' IN ('approved_instruction', 'policy') THEN
    v_metadata := jsonb_set(v_metadata, '{requested_authority_level}', to_jsonb(v_metadata->>'authority_level'), true);
    v_metadata := jsonb_set(v_metadata, '{authority_level}', '"proposed_instruction"'::jsonb, true);
  END IF;

  -- The service-role create path is always an agent path. A caller cannot
  -- self-assert human identity by changing p_actor.
  v_actor_type := 'agent';
  v_actor_id := CASE WHEN position(':' IN p_actor) > 0 THEN split_part(p_actor, ':', 2) ELSE p_actor END;
  v_version := CASE
    WHEN p_blocks IS NOT NULL AND jsonb_typeof(p_blocks) = 'array' AND jsonb_array_length(p_blocks) > 0 THEN 1
    ELSE 0
  END;
  v_id := COALESCE(p_id, gen_random_uuid());

  -- AUTHORITY DEFECT FIX: draft-always at birth. Every agent-created artifact begins
  -- status=draft / review_policy=human_gate, regardless of kind or declared authority.
  INSERT INTO artifacts (id, key, title, kind, status, review_policy, current_version, metadata)
  VALUES (
    v_id, p_key, p_title, COALESCE(p_kind, 'document'),
    'draft',
    'human_gate',
    v_version, v_metadata
  );

  IF v_version = 1 THEN
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
      v_path := v_block->>'path';
      v_content := COALESCE(v_block->>'content', '');
      IF v_path IS NULL OR left(v_path, 1) <> '/' THEN
        RAISE EXCEPTION 'BAD_PATH: block path must start with "/" (got %)', v_path;
      END IF;
      v_hash := encode(digest(v_content, 'sha256'), 'hex');
      INSERT INTO artifact_blocks (artifact_id, path, title, content, content_hash, version, sort_order, metadata)
      VALUES (
        v_id, v_path, v_block->>'title', v_content, v_hash, 1,
        COALESCE((v_block->>'sort_order')::int, 0), COALESCE(v_block->'metadata', '{}'::jsonb)
      )
      RETURNING id INTO v_block_id;
      v_created := v_created || jsonb_build_object(
        'block_id', v_block_id, 'path', v_path, 'content', v_content, 'content_hash', v_hash
      );
      v_ops := v_ops || jsonb_build_object(
        'op', 'create_block', 'path', v_path, 'title', v_block->>'title',
        'content', v_content, 'sort_order', COALESCE((v_block->>'sort_order')::int, 0)
      );
    END LOOP;
  ELSE
    v_ops := jsonb_build_array(jsonb_build_object('op', 'create_artifact'));
  END IF;

  INSERT INTO artifact_revisions (
    artifact_id, version, base_version, ops, summary, actor, actor_type, actor_id, metadata
  )
  VALUES (
    v_id, v_version, 0, v_ops, 'Initial create', p_actor, v_actor_type, v_actor_id,
    jsonb_build_object('review_policy', 'human_gate')
  );

  PERFORM write_artifact_snapshot(
    v_id, v_version,
    jsonb_build_object('source', 'initial_create', 'actor_type', v_actor_type, 'actor_id', v_actor_id)
  );

  RETURN jsonb_build_object(
    'artifact_id', v_id,
    'key', p_key,
    'version', v_version,
    'status', 'draft',
    'review_policy', 'human_gate',
    'blocks', v_created
  );
END;
$function$;
