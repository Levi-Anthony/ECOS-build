# Secrets Operating Model
*Created 2026-06-04. Values never belong in this file.*

## Purpose

Secrets should be boring to use and bounded to rotate. The professional pattern is
not "remember where the keys went"; it is a small ledger that answers four
questions for every secret:

1. Who owns the secret?
2. Where is the secret stored?
3. Which consumers depend on it?
4. How is it rotated and verified?

If those four answers are current, rotation is a dependency update. If any answer
is missing, rotation becomes archaeology.

## Secret Classes

| Class | Examples | Storage rule | Rotation pressure |
|---|---|---|---|
| Public config | Supabase project URL, public site URL | Source/docs are fine | None; not secret |
| Server runtime secret | Supabase service key, site password | Platform env store or local ignored env file | Rotate after exposure or role change |
| Integration credential | OpenRouter, Slack bot token | Provider vault + platform env store | Rotate after exposure, provider warning, or scope change |
| Access-control secret | MCP access key, dashboard password | Password manager + platform/client config | Rotate after chat/file exposure or client loss |
| Operator token | Supabase PAT, one-off CLI token | Password manager or shell session only | Rotate after paste into chat/log/file |

## Rules

- Never put secret values in chat, committed files, screenshots, prompts, BRAIN
  captures, or docs.
- Never put server-power credentials in `NEXT_PUBLIC_*`; Next.js inlines those
  into the browser bundle.
- Store each secret where it is consumed: Vercel env vars for Vercel, Supabase
  Edge Function secrets for Edge Functions, local ignored env files for local
  development, password manager for human retrieval.
- Use names and placeholders in conversation: `SUPABASE_SERVICE_ROLE_KEY`,
  `MCP_ACCESS_KEY`, `<brain access key>`.
- Prefer provider-generated scoped keys over legacy all-powerful keys when the
  provider supports them.
- Keep coarse site-access credentials separate from human-authority credentials.
  `SITE_PASSWORD` may open the dashboard, but artifact approval requires a
  distinct allowlisted Supabase Auth principal.
- Treat query-string secrets as compatibility fallbacks. They work for clients
  that cannot send headers, but they are more likely to leak through logs,
  browser history, and screenshots.

## Consumer Ledger

Every secret gets one row in the inventory:

| Field | Meaning |
|---|---|
| Secret name | Stable env/config name, not the value |
| Class | One of the classes above |
| Owner | Human/provider responsible for issuing it |
| Storage locations | Password manager, Vercel env, Supabase secret store, local env |
| Consumers | Apps, functions, scripts, connectors, shortcuts, agents |
| Privilege | What the secret can do |
| Rotation steps | Exact cutover sequence |
| Verification | Command, page, or workflow proving the new value works |
| Last checked | Date the row was verified |

## Rotation Protocol

1. Identify the secret by name, not value.
2. Find every consumer from the inventory and a repo/env search.
3. Create the replacement secret in the provider.
4. Add the new value to every storage location that needs it.
5. Redeploy or restart consumers that load env vars at boot.
6. Verify each consumer against the new value.
7. Revoke the old value.
8. Search again for the old value locally before considering the loop closed.
9. Record the date, consumers touched, and verification result.

When a secret has already appeared in chat, source, logs, or committed history,
removing it from the current file is still necessary, but it is not sufficient.
The old value should be treated as compromised and rotated.

## Daily Working Ritual

Before asking an assistant for help with key-dependent work:

1. Say the secret name and storage location, never the value.
2. Ask for commands using placeholders.
3. Paste the real value only into the terminal, provider dashboard, or password
   manager field.
4. If a tool needs the value repeatedly, put it in an ignored local env file or
   platform env store and pass only the variable name in chat.

Good: `ECB_KEY=<brain access key> python3 scripts/ecb-drift-check.py`

Bad: pasting the literal key into chat, a markdown prompt, or a committed script.
