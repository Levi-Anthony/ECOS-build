# ECO-46 A1 W+R — function rollback dumps (guardrail 2)

The `eco46_a1w_*` migration `CREATE OR REPLACE`s these write-path RPCs. Their
pre-change definitions are the rollback base. Per amendment A2 the live
`pg_get_functiondef` output was dumped **first** and used as the edit base;
these functions do not change until the gated deploy, so the authoritative
rollback dump is captured **fresh at pre-deploy assembly** (Step 8), immediately
before the atomic deploy, and saved here as `<function>.sql`.

Touched functions (rollback set):
- `apply_artifact_patch(text,integer,jsonb,text,text,jsonb,boolean)` — core (NOT modified; listed for completeness)
- `create_artifact_v2(text,text,text,jsonb,jsonb,text,uuid)`
- `apply_artifact_agent_patch_tx(text,integer,jsonb,text,text,jsonb,boolean)`
- `propose_artifact_patch_tx(text,integer,jsonb,text,text,text,jsonb,uuid,jsonb)`
- `review_artifact_change_tx(uuid,text,text,jsonb)` — approval RPC (guardrail 5)
- `apply_artifact_proposal_agent_tx(uuid,text)` — agent-relay approval

Regenerate the dumps with:

```sql
SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS def
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'apply_artifact_patch','create_artifact_v2','apply_artifact_agent_patch_tx',
  'propose_artifact_patch_tx','review_artifact_change_tx','apply_artifact_proposal_agent_tx');
```

Restore path on deploy failure: re-run the saved `CREATE OR REPLACE FUNCTION`
statements (they fully replace the modified versions), then redeploy the
`ecb-mcp-source/` edge snapshot.
