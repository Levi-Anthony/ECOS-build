SET search_path = public, extensions;

-- Artifact v2 cleanup / v1 retirement Phase A.
--
-- Goal:
--   Remove active runtime dependency on the v1 artifact engine while keeping v1
--   rows readable for rollback inspection. This is intentionally not the final
--   destructive cleanup; do not drop canonical_artifacts, artifact_versions, or
--   artifact_chunks in this phase.
--
-- Rollback, if a missed runtime dependency surfaces:
--   GRANT INSERT, UPDATE, DELETE ON canonical_artifacts, artifact_versions, artifact_chunks TO service_role;
--   GRANT EXECUTE ON FUNCTION match_artifact_chunks(vector(1536), float, int, text, text, text, boolean) TO service_role;
--
-- Final v1 table/function drops belong in a later explicitly gated migration.

-- ─── Preflight: v2 exists, v1 exists, and v1 rows were backfilled by reused IDs.
DO $$
DECLARE
  missing_count int;
BEGIN
  IF to_regclass('public.artifacts') IS NULL THEN
    RAISE EXCEPTION 'Artifact v2 table public.artifacts is missing; apply 20260602100000_artifacts_v2 first.';
  END IF;

  IF to_regclass('public.canonical_artifacts') IS NULL
     OR to_regclass('public.artifact_versions') IS NULL
     OR to_regclass('public.artifact_chunks') IS NULL THEN
    RAISE EXCEPTION 'Legacy artifact tables are missing; Phase A expects them to remain available for rollback inspection.';
  END IF;

  SELECT count(*) INTO missing_count
  FROM canonical_artifacts ca
  LEFT JOIN artifacts a ON a.id = ca.id
  WHERE a.id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Artifact v2 backfill is incomplete: % canonical_artifacts row(s) are missing from artifacts.', missing_count;
  END IF;
END
$$;

-- ─── Preflight: no unexpected deployed runtime objects still reference v1.
DO $$
DECLARE
  offenders text;
BEGIN
  WITH function_refs AS (
    SELECT format('function %I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS object_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND p.proname <> 'match_artifact_chunks'
      AND pg_get_functiondef(p.oid) ~ '\m(canonical_artifacts|artifact_versions|artifact_chunks|match_artifact_chunks)\M'
  ),
  view_refs AS (
    SELECT format('view %I.%I', schemaname, viewname) AS object_name
    FROM pg_views
    WHERE schemaname = 'public'
      AND definition ~ '\m(canonical_artifacts|artifact_versions|artifact_chunks|match_artifact_chunks)\M'
  ),
  external_fk_refs AS (
    SELECT format('constraint %I on %s -> %s', c.conname, c.conrelid::regclass, c.confrelid::regclass) AS object_name
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid IN ('canonical_artifacts'::regclass, 'artifact_versions'::regclass, 'artifact_chunks'::regclass)
      AND c.conrelid NOT IN ('canonical_artifacts'::regclass, 'artifact_versions'::regclass, 'artifact_chunks'::regclass)
      AND c.conrelid <> 'handoff_snapshots'::regclass
  )
  SELECT string_agg(object_name, E'\n')
  INTO offenders
  FROM (
    SELECT object_name FROM function_refs
    UNION ALL
    SELECT object_name FROM view_refs
    UNION ALL
    SELECT object_name FROM external_fk_refs
  ) all_refs;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected deployed dependency on legacy artifact engine:%', E'\n' || offenders;
  END IF;
END
$$;

-- ─── Preflight: snapshot artifact refs can survive the FK target switch.
DO $$
DECLARE
  missing_snapshot_refs int;
BEGIN
  SELECT count(*) INTO missing_snapshot_refs
  FROM handoff_snapshots hs
  LEFT JOIN artifacts a ON a.id = hs.artifact_id
  WHERE hs.artifact_id IS NOT NULL
    AND a.id IS NULL;

  IF missing_snapshot_refs > 0 THEN
    RAISE EXCEPTION 'Cannot repoint handoff_snapshots.artifact_id: % row(s) reference IDs absent from artifacts.', missing_snapshot_refs;
  END IF;
END
$$;

-- ─── Repoint handoff snapshot artifact refs from v1 identity to v2 identity.
DO $$
DECLARE
  legacy_fk_name text;
BEGIN
  SELECT c.conname INTO legacy_fk_name
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.conrelid = 'handoff_snapshots'::regclass
    AND c.confrelid = 'canonical_artifacts'::regclass
    AND c.conkey = ARRAY[
      (SELECT a.attnum FROM pg_attribute a
       WHERE a.attrelid = 'handoff_snapshots'::regclass AND a.attname = 'artifact_id')
    ]::smallint[]
  LIMIT 1;

  IF legacy_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE handoff_snapshots DROP CONSTRAINT %I', legacy_fk_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = 'handoff_snapshots'::regclass
      AND c.confrelid = 'artifacts'::regclass
      AND c.conkey = ARRAY[
        (SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid = 'handoff_snapshots'::regclass AND a.attname = 'artifact_id')
      ]::smallint[]
  ) THEN
    ALTER TABLE handoff_snapshots
      ADD CONSTRAINT handoff_snapshots_artifact_id_fkey
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ─── Retire active v1 mutation/search lanes. Keep SELECT for rollback inspection.
REVOKE INSERT, UPDATE, DELETE ON canonical_artifacts FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON artifact_versions FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON artifact_chunks FROM service_role;

REVOKE EXECUTE ON FUNCTION match_artifact_chunks(
  vector(1536), float, int, text, text, text, boolean
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION match_artifact_chunks(
  vector(1536), float, int, text, text, text, boolean
) FROM anon;
REVOKE EXECUTE ON FUNCTION match_artifact_chunks(
  vector(1536), float, int, text, text, text, boolean
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION match_artifact_chunks(
  vector(1536), float, int, text, text, text, boolean
) FROM service_role;

-- ─── Postflight: privilege assertions make the retirement observable.
DO $$
DECLARE
  offenders text;
BEGIN
  WITH privilege_checks AS (
    SELECT 'canonical_artifacts SELECT' AS check_name, has_table_privilege('service_role', 'canonical_artifacts', 'SELECT') AS ok
    UNION ALL SELECT 'artifact_versions SELECT', has_table_privilege('service_role', 'artifact_versions', 'SELECT')
    UNION ALL SELECT 'artifact_chunks SELECT', has_table_privilege('service_role', 'artifact_chunks', 'SELECT')
    UNION ALL SELECT 'canonical_artifacts INSERT', NOT has_table_privilege('service_role', 'canonical_artifacts', 'INSERT')
    UNION ALL SELECT 'canonical_artifacts UPDATE', NOT has_table_privilege('service_role', 'canonical_artifacts', 'UPDATE')
    UNION ALL SELECT 'canonical_artifacts DELETE', NOT has_table_privilege('service_role', 'canonical_artifacts', 'DELETE')
    UNION ALL SELECT 'artifact_versions INSERT', NOT has_table_privilege('service_role', 'artifact_versions', 'INSERT')
    UNION ALL SELECT 'artifact_versions UPDATE', NOT has_table_privilege('service_role', 'artifact_versions', 'UPDATE')
    UNION ALL SELECT 'artifact_versions DELETE', NOT has_table_privilege('service_role', 'artifact_versions', 'DELETE')
    UNION ALL SELECT 'artifact_chunks INSERT', NOT has_table_privilege('service_role', 'artifact_chunks', 'INSERT')
    UNION ALL SELECT 'artifact_chunks UPDATE', NOT has_table_privilege('service_role', 'artifact_chunks', 'UPDATE')
    UNION ALL SELECT 'artifact_chunks DELETE', NOT has_table_privilege('service_role', 'artifact_chunks', 'DELETE')
    UNION ALL SELECT 'match_artifact_chunks EXECUTE',
      NOT has_function_privilege(
        'service_role',
        'match_artifact_chunks(vector(1536), float, int, text, text, text, boolean)',
        'EXECUTE'
      )
  )
  SELECT string_agg(check_name, ', ')
  INTO offenders
  FROM privilege_checks
  WHERE NOT ok;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'Artifact v1 retirement privilege assertion failed: %', offenders;
  END IF;
END
$$;
