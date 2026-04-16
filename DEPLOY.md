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

STEP 2 — CONFIGURE OPEN BRAIN MCP
Ask me for my Supabase URL and access key. Then run:
  claude mcp add --transport http open-brain \
    [SUPABASE_URL]/functions/v1/open-brain-mcp \
    --header "x-brain-key: [ACCESS_KEY]"
Verify with:
  claude mcp list
Confirm open-brain appears as active before continuing.

If this fails: the most common cause is a key mismatch or cold function startup.
Ask me to open Supabase dashboard → Edge Functions → open-brain-mcp → Logs
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

| Variable | Used by | Description |
|---|---|---|
| `SUPABASE_URL` | both functions | Your project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | both functions | Service role key (bypasses RLS) — Dashboard → API → service_role |
| `OPENROUTER_API_KEY` | both functions | OpenRouter API key — used for embeddings (`text-embedding-3-small`) and metadata extraction (`gpt-4o-mini`) |
| `MCP_ACCESS_KEY` | both functions | Shared secret for all clients — passed as `x-brain-key` header or `?key=` query param |

**Deploy commands:**
```bash
cd ~/ecos
supabase functions deploy open-brain-mcp --no-verify-jwt
supabase functions deploy brain-middleware --no-verify-jwt
```

Note: `--no-verify-jwt` is required for both functions. Auth is handled by `MCP_ACCESS_KEY`, not Supabase JWTs.
