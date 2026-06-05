# ECOS Secrets Next-Steps Instruction Book
*Created 2026-06-04. Do not add secret values to this file.*

## What This Is

This is the operator runbook for the current ECOS security closeout. It separates
work an agent can do from work only Levi should do, because the human boundary is
the security boundary.

Primary objective:

1. Rotate the exposed BRAIN/MCP access key.
2. Finish the Supabase legacy service-role closeout.
3. Leave a consumer ledger that prevents future archaeology.

Official references:

- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase Edge Function secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase legacy key rotation/troubleshooting: https://supabase.com/docs/guides/troubleshooting/rotating-anon-service-and-jwt-secrets-1Jq6yd
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel CLI env: https://vercel.com/docs/cli/env
- Vercel redeploy: https://vercel.com/docs/cli/redeploy

## Hard Rules

- Levi never pastes secret values into chat.
- Agents use placeholder commands only.
- Levi enters actual values only in provider dashboards, password manager fields,
  local ignored env files, or a terminal command he controls.
- Any key that appeared in chat, committed files, screenshots, or logs is treated
  as compromised.
- Vercel env var changes require a new deployment before production uses them.
- Supabase `sb_secret_...` keys are for trusted backends only; never browser code.

## Role Split

### Agent / Assistant Can Do

- Search repo for consumers.
- Maintain `docs/security/ecos-secrets-inventory.md`.
- Produce exact placeholder commands.
- Inspect code for server/client exposure mistakes.
- Run non-secret tests and static scans.
- Update docs after Levi reports non-secret results.
- Verify ECB through already-configured MCP tools if the active connector works.

### Only Levi Can Do

- Generate, view, copy, paste, or store real secret values.
- Edit provider dashboards where values are shown or entered.
- Update password manager entries.
- Update MCP connector URLs or client configs containing real keys.
- Run terminal commands containing actual secret values unless the command is
  written with placeholders and Levi fills them locally.
- Delete/revoke old provider keys after confirming cutover.

## Phase 0 — Prepare

### Agent

1. Run repo consumer discovery:

   ```bash
   rg -n "Deno\\.env\\.get|process\\.env|SUPABASE_|MCP_ACCESS_KEY|ECB_KEY|BRAIN_KEY|OPENROUTER_API_KEY|SLACK_|SITE_PASSWORD|NEXT_PUBLIC_" \
     apps supabase scripts docs DEPLOY.md
   ```

2. Check for obvious literal key leakage:

   ```bash
   rg -n "BRAIN_KEY\\s*=\\s*[A-Za-z0-9][A-Za-z0-9_-]{20,}|ECB_KEY\\s*=\\s*[A-Za-z0-9][A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]|sk-or-[A-Za-z0-9]{10,}" \
     . --glob '!**/node_modules/**' --glob '!**/package-lock.json' --glob '!**/deno.lock'
   ```

3. Confirm this runbook and `ecos-secrets-inventory.md` are current.

### Levi

1. Open password manager.
2. Open Supabase project dashboard for ECOS production.
3. Open Vercel project dashboard for `apps/crm-dashboard`.
4. Open any active MCP connector/client settings:
   - Claude Code
   - Claude Desktop
   - ChatGPT / claude.ai connector
   - iOS Shortcut or other capture paths
5. Keep a scratch note outside chat with these headings:
   - New value stored
   - Supabase updated
   - Clients updated
   - Verified
   - Old value revoked

## Phase 1 — Rotate `MCP_ACCESS_KEY`

This is the immediate key exposed by the old backfill materials. It gates ECB
MCP/capture access.

### Agent

1. Confirm code consumers:
   - `supabase/functions/ecb-mcp/index.ts`
   - `supabase/functions/brain-middleware/index.ts`
   - scripts that accept `ECB_KEY` or `BRAIN_KEY`
2. Give Levi placeholder commands only.
3. After Levi updates providers, run non-secret repo scans and update docs.

### Levi

1. Generate a new high-entropy random value in the password manager.
2. Save it as `MCP_ACCESS_KEY` or `ECOS MCP access key`.
3. In Supabase Edge Function secrets, update `MCP_ACCESS_KEY` to the new value.
4. Ensure the affected functions are redeployed or restarted if needed:

   ```bash
   supabase functions deploy ecb-mcp --no-verify-jwt --project-ref <prod-project-ref>
   supabase functions deploy brain-middleware --no-verify-jwt --project-ref <prod-project-ref>
   ```

5. Update every active client that uses this key:
   - Claude Code header config: `x-brain-key: <new key>`
   - Connector URLs that use `?key=<new key>`
   - iOS Shortcut/capture paths if they include the key
   - local ignored env files that define `ECB_KEY` or `BRAIN_KEY`
6. Verify with the new key:

   ```bash
   ECB_KEY=<new key> python3 scripts/ecb-drift-check.py
   ```

7. Confirm ECB boot works from at least one active chat/client.
8. Confirm the old key no longer works. Use a local terminal or provider logs;
   do not paste either key into chat.
9. Tell the agent only the result:
   - "new key works"
   - "old key fails"
   - any non-secret error text

## Phase 2 — Close Supabase Service-Role Exposure

This closes the dashboard/service-role loop documented in
`apps/crm-dashboard/SECURITY_FOLLOWUP.md`.

### Agent

1. Confirm current code does not use a service-role key in `NEXT_PUBLIC_*`.
2. Confirm server-only usage:
   - CRM dashboard uses `SUPABASE_SERVICE_ROLE_KEY` only server-side.
   - Edge Functions prefer `SUPABASE_SECRET_KEYS.default`.
3. Produce placeholder Vercel/Supabase commands if Levi wants CLI workflow.
4. After Levi reports revocation complete, update `SECURITY_FOLLOWUP.md`.

### Levi

1. In Supabase Settings > API Keys, confirm there is a modern secret key suitable
   for trusted server use.
2. In Vercel env vars, confirm production has:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY`
   - `HUMAN_AUTH_EMAIL`
   - `HUMAN_AUTH_PASSWORD`
   - `SITE_PASSWORD`
3. Confirm production does **not** have a service-role value in:
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - any other `NEXT_PUBLIC_*` variable
4. If any Vercel env var changes, redeploy production. Vercel does not apply env
   changes to previous deployments.
5. In Supabase, confirm Edge Functions have modern server-only access through
   `SUPABASE_SECRET_KEYS.default`:
   - `ecb-mcp`
   - `brain-middleware`
   - `ingest-thought`
6. Smoke test:
   - Dashboard loads after Basic Auth.
   - An allowlisted human can review an artifact proposal.
   - The resulting review event records the mapped human principal.
   - A direct service-role review call is denied.
   - ECB boot works.
   - Slack capture works if currently active.
7. Revoke/delete the compromised legacy `service_role` key or complete the
   provider-supported legacy-key rotation path.
8. Smoke test again.
9. Tell the agent the non-secret outcome and date.

## Phase 3 — Local Machine Cleanup

### Agent

1. Search tracked files for secret-shaped literals.
2. Confirm `.env` files are ignored.
3. Identify tracked historical docs that still instruct unsafe behavior.

### Levi

1. Check local ignored env files:

   ```bash
   find . -name ".env*" -not -path "./.git/*" -not -name "*.example" -print
   ```

2. Open each found file locally.
3. Replace old values with new values.
4. Do not paste file contents into chat.
5. Clear shell history entries containing literal secrets if any were typed.

## Phase 4 — Documentation Closeout

### Agent

1. Update `docs/security/ecos-secrets-inventory.md`:
   - last checked date
   - consumers verified
   - rotation status
2. Update `apps/crm-dashboard/SECURITY_FOLLOWUP.md` after service-role closeout.
3. Append an ECB handoff event with:
   - what rotated
   - which consumers were updated
   - what remains open
   - no secret values
4. Save a handoff snapshot.

### Levi

1. Confirm whether any consumer is intentionally retired.
2. Confirm whether any client could not be updated.
3. Confirm the old keys fail before declaring complete.

## Completion Criteria

The current loop is closed only when all are true:

- New `MCP_ACCESS_KEY` works from active clients.
- Old `MCP_ACCESS_KEY` fails.
- Local script alias `ECB_KEY` / `BRAIN_KEY` works only with the new value.
- Dashboard still works behind `SITE_PASSWORD`.
- No service-role key is browser-exposed in `NEXT_PUBLIC_*`.
- Legacy Supabase service-role exposure is revoked or provider-rotated.
- `ecos-secrets-inventory.md` and `SECURITY_FOLLOWUP.md` reflect the result.
- ECB handoff has been updated without secret values.

## If Something Breaks

Do not rotate more keys while debugging. Stop and isolate:

1. Which consumer failed?
2. Is it reading from Supabase secrets, Vercel env, local `.env`, or connector UI?
3. Does it require redeploy/restart?
4. Is the failure auth (`401`/`403`) or runtime/config (`500`/missing env)?
5. Can one known-good consumer still boot ECB?

Then give the agent the failing consumer name and non-secret error text only.
