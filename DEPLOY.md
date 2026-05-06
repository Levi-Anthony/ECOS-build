# ECOS Deployment Prompt
*v0.1 — 2026-03-30*

Paste this into a Claude Code session. Claude Code does the deployment.
You provide credentials when asked. That's it.

---

```
Deploy ECOS-v2 from the downloaded directory to a running system on this machine.

Your job is to execute all steps autonomously. Only pause to ask me for:
- My Supabase project URL
- My Open Brain MCP access key
- Confirmation that the final boot looks correct

Everything else you handle yourself.

WHAT YOU ARE DEPLOYING

ECOS-v2 is a personal operating system for Claude Code. It consists of:
- CLAUDE.md — always-loaded boot substrate (auto-loads when Claude Code opens
  in the ecos directory)
- HANDOFF.md — live state document
- .claude/skills/ — eight domain skill files

The ecos-v2 directory is in my downloads or current working directory.
Find it, verify its structure, and proceed.

DEPLOYMENT STEPS — execute in order:

STEP 1 — PLACE THE FILES
Find the ecos-v2 directory (check ~/Downloads, current directory, Desktop).
Copy it to ~/ecos:
  cp -r [path-to-ecos-v2] ~/ecos
Verify the structure is intact:
  ls ~/ecos should show: CLAUDE.md, HANDOFF.md, DEPLOY.md, .claude/
  ls -la ~/ecos/.claude/skills/ should show 8 skill directories

STEP 2 — CONFIGURE ECB MCP
Ask me for my Supabase URL and access key. Then run:
  claude mcp add --transport http ecb \
    [SUPABASE_URL]/functions/v1/ecb-mcp \
    --header "x-brain-key: [ACCESS_KEY]"
Verify with:
  claude mcp list
Confirm ecb appears as active before continuing.

If this fails: the most common cause is a key mismatch or cold function startup.
Ask me to open Supabase dashboard → Edge Functions → ecb-mcp → Logs
and paste what I see. Diagnose from there.

STEP 3 — OPEN ECOS
Run:
  cd ~/ecos && claude
CLAUDE.md loads automatically. A correct boot looks like:
1. Claude orients to ECOS context without being asked
2. Declares cold start (no HANDOFF.md exists yet) or reads HANDOFF.md
3. Queries BRAIN for active threads and open loops
4. Names the single highest-leverage action available
5. Names a concrete first executable step
6. Declares state → ACTIVE

STEP 4 — VERIFY BRAIN CONNECTION
Ask Claude to search BRAIN for "ECOS architecture."
A successful result returns entries from the March 30 design session.
A failed result means MCP isn't live inside the session — restart Claude Code
and recheck claude mcp list.

STEP 5 — FIRST SESSION CLOSE TEST
Ask Claude to write HANDOFF.md.
Verify ~/ecos/HANDOFF.md exists and contains structured content:
mode, open loops, decisions, next session primer.

DONE CONDITION
Report back with:
- Confirmation each step succeeded, or what failed and how you fixed it
- The content of the written HANDOFF.md
- One line: "ECOS is live." or "ECOS deployment failed at step N: [reason]."

If anything fails that you cannot fix autonomously, pause and describe exactly
what you see so I can unblock you.
```

---

*Paste once. Provide credentials when asked. Verify the final boot. Done.*

---

## Edge Function Environment Variables

Set in Supabase Dashboard → Project Settings → Edge Functions → Secrets, or via `supabase secrets set`.

| Variable | Description |
|---|---|
| `MCP_ACCESS_KEY` | Shared secret for all clients — passed as `x-brain-key` header or `?key=` query param. Required (user-set). |
| `OPENROUTER_API_KEY` | OpenRouter API key — used for embeddings (`text-embedding-3-small`) and metadata extraction (`gpt-4o-mini`). Required (user-set). |
| `SUPABASE_URL` | Auto-injected by Supabase Edge Functions runtime. Not user-set. |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase Edge Functions runtime. Not user-set. |

**Deploy commands:**
```bash
cd ~/ecos
supabase functions deploy ecb-mcp --no-verify-jwt
supabase functions deploy brain-middleware --no-verify-jwt
supabase functions deploy ingest-thought
```

Note: `--no-verify-jwt` is set on `ecb-mcp` and `brain-middleware`. Auth is handled by `MCP_ACCESS_KEY`, not Supabase JWTs.

---

## ecb-mcp — Effortless Connection Brain (the consolidated MCP server)

`ecb-mcp` is the single MCP server for ECOS::BRAIN. It hosts all 31 tools across BRAIN (semantic memory) and ECOS (action on memory) domains. Per OB1 canon, this is one logical Open Brain instance per user; the prior split into `open-brain-mcp` + `ecos-crm-mcp` (renamed `ecos-mcp`) was an unintentional drift consolidated back together on 2026-05-04. See `~/ecos/docs/architecture/mcp-boundary-decision.md` for the rationale.

**Tools (31 total)**, organized into per-domain modules:
- **BRAIN** (6): `search_thoughts`, `list_thoughts`, `thought_stats`, `capture_thought`, `update_thought`, `delete_thought`
- **Contacts** (8): `add_contact`, `search_contacts`, `log_interaction`, `get_contact_history`, `get_follow_ups_due`, `update_contact`, `get_contacts_by_domain`, `set_administrative_status`
- **Opportunities** (1): `create_opportunity`
- **Billing** (5): `log_service_call`, `get_client_service_history`, `get_unbilled_work`, `create_billing_entry`, `update_billing_status`
- **Observations** (4): `add_person_observation`, `get_person_observations`, `compile_person_snapshot`, `get_person_card`
- **Brain-bridge** (3): `link_thought_to_contact`, `get_linked_thoughts`, `search_brain_for_contact`
- **Briefing** (1): `get_briefing_context`
- **Taste** (3): `capture_taste_preference`, `update_taste_preference`, `list_taste_preferences`

Tool prefix is `mcp__ecb__*`.

### Connecting clients

The auth layer accepts BOTH a `x-brain-key` header AND a `?key=...` query parameter. Different clients use different patterns:

**Claude Code (terminal):**
```bash
claude mcp add --transport http ecb \
  [SUPABASE_URL]/functions/v1/ecb-mcp \
  --header "x-brain-key: [ACCESS_KEY]"
```

**Claude Desktop, ChatGPT, claude.ai (and any other client whose connector UI doesn't expose custom headers):**
Use the URL with the access key as a query parameter:
```
[SUPABASE_URL]/functions/v1/ecb-mcp?key=[ACCESS_KEY]
```

**Migrating from older configs (`open-brain` + `ecos-mcp` / `ecos-crm`):**
```bash
claude mcp remove open-brain
claude mcp remove ecos-mcp   # or ecos-crm if that's what's registered
# then add ecb (above), then restart Claude Code
```
