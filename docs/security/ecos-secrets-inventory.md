# ECOS Secrets Inventory
*Created 2026-06-04. Secret values are intentionally omitted.*

## Current Rotation Risk

The old BRAIN access key appeared in committed backfill materials and in agent
context during this security sprint. The literal value has been removed from the
current files, but because it was exposed in tracked history/chat context, it
should be rotated.

The existing carried closeout remains active: revoke the legacy Supabase
service-role key after confirming all consumers use server-only modern secrets.

Step-by-step execution now lives in `docs/security/next-steps-instruction-book.md`.

## Inventory

| Secret | Class | Storage locations | Known consumers | Privilege / effect | Rotation verification |
|---|---|---|---|---|---|
| `SUPABASE_SECRET_KEYS.default` | Server runtime secret | Supabase Edge Function secrets | `ecb-mcp`, `brain-middleware`, `ingest-thought` | Supabase admin access for server code | Boot ECB via MCP; run capture path smoke test; confirm Slack ingest if active |
| `SUPABASE_SERVICE_ROLE_KEY` | Server runtime secret / legacy fallback | Vercel env; local `.env.local`; legacy Supabase runtime fallback | CRM dashboard server components; local dashboard dev; older Edge Function fallback | Supabase service-role DB access | Load protected dashboard pages; confirm no `NEXT_PUBLIC_SUPABASE_ANON_KEY` service key exists |
| `SUPABASE_ANON_KEY` | Server runtime credential | Vercel env; local `.env.local` | CRM dashboard human-authority client | Authenticates a Supabase Auth user without service-role power | Human artifact review succeeds; direct service-role review remains denied |
| `HUMAN_AUTH_EMAIL` / `HUMAN_AUTH_PASSWORD` | Access-control secret | Vercel env; local `.env.local`; password manager | CRM dashboard human-authority client | Authenticates the allowlisted artifact reviewer principal | Review event records mapped `artifact_human_authorities.principal_id` |
| `NEXT_PUBLIC_SUPABASE_URL` | Public config | Vercel env; local `.env.local`; docs | CRM dashboard client/server config | Identifies Supabase project URL; not secret | Dashboard still reaches the intended project |
| `MCP_ACCESS_KEY` | Access-control secret | Supabase Edge Function secrets; MCP client configs; password manager | `ecb-mcp`, `brain-middleware`, Claude Code, Claude Desktop, ChatGPT/claude.ai connectors, iOS capture paths | Grants access to ECB MCP/capture endpoints | `get_boot_context` succeeds from each active client; old key fails after revoke |
| `ECB_KEY` / `BRAIN_KEY` | Operator alias for `MCP_ACCESS_KEY` | Shell env only; ignored local env file if needed | `scripts/ecb-drift-check.py`, `scripts/ecb-artifacts-v2-verify.py`, `scripts/ecb-reindex-embeddings.py`, old backfill workflow | Lets local scripts call ECB endpoints | Run read-only drift check with new value; confirm old value rejected |
| `OPENROUTER_API_KEY` | Integration credential | Supabase Edge Function secrets; shell env for scripts; password manager | `ecb-mcp`, `brain-middleware`, `ingest-thought`, `docs/backfill.py` | Embeddings and metadata/model calls | ECB semantic search/capture works; backfill script exits past env validation |
| `SLACK_BOT_TOKEN` | Integration credential | Supabase Edge Function secrets; Slack app config/password manager | `ingest-thought` | Posts capture confirmations and reads Slack event context | Send test capture in configured channel and confirm response |
| `SLACK_CAPTURE_CHANNEL` | App config | Supabase Edge Function secrets | `ingest-thought` | Restricts which Slack channel is captured | Non-target channels ignored; target channel captured |
| `SITE_PASSWORD` | Access-control secret | Vercel env; local `.env.local`; password manager | `apps/crm-dashboard/proxy.ts`, Playwright verification driver | Coarse dashboard access gate; not artifact reviewer identity | Unauthenticated request returns 401; authenticated request renders dashboard |
| `SUPABASE_ACCESS_TOKEN` | Operator token | Password manager or shell env only | `scripts/ecb-migration-drift.py`; Supabase Management API operations | Supabase management/project access | Migration drift script can read applied state; token removed from shell after use |

## Consumer Discovery Commands

Use these before rotating any secret:

```bash
rg -n "Deno\\.env\\.get|process\\.env|SUPABASE_|MCP_ACCESS_KEY|ECB_KEY|BRAIN_KEY|OPENROUTER_API_KEY|SLACK_|SITE_PASSWORD|NEXT_PUBLIC_" \
  apps supabase scripts docs DEPLOY.md
```

```bash
git grep -n "NEXT_PUBLIC_SUPABASE_ANON_KEY\\|SERVICE_ROLE\\|x-brain-key\\|BRAIN_KEY\\|ECB_KEY"
```

```bash
find . -name ".env*" -not -path "./.git/*" -not -name "*.example" -print
```

## Supabase Service-Key Closeout

1. Confirm Vercel production uses server-only `SUPABASE_SERVICE_ROLE_KEY` with a
   modern trusted-server key.
2. Confirm Vercel production does not define `NEXT_PUBLIC_SUPABASE_ANON_KEY` with
   service-role privileges.
3. Confirm Supabase Edge Functions prefer `SUPABASE_SECRET_KEYS.default`:
   `ecb-mcp`, `brain-middleware`, `ingest-thought`.
4. Smoke test dashboard and ECB boot.
5. Revoke/delete the old legacy `service_role` project API key in Supabase.
6. Smoke test again.
7. Update `apps/crm-dashboard/SECURITY_FOLLOWUP.md` with closeout date and result.

## BRAIN/MCP Access-Key Rotation

1. Generate a new `MCP_ACCESS_KEY`.
2. Set it in Supabase Edge Function secrets for `ecb-mcp` and `brain-middleware`.
3. Update active clients that use `x-brain-key` or `?key=`:
   Claude Code, Claude Desktop, ChatGPT/claude.ai connectors, iOS Shortcut paths,
   and any local ignored env files.
4. Redeploy/restart functions or clients if their runtime requires it.
5. Verify `get_boot_context` from this workspace.
6. Run one read-only script with `ECB_KEY=<new value>`.
7. Revoke the old value or replace it in the auth check so the old value fails.
8. Search local files for the old value without printing it back into chat.

## Working Rule

For future agent sessions: give agents secret names, storage locations, and
consumer lists. Do not give agents secret values. If a value is needed, ask the
agent for a placeholder command and paste the value into the terminal or provider
dashboard yourself.
