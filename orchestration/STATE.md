# STATE — Code Orchestrator Live Working State

*Read first every session, after `get_boot_context`. Reconcile against ECB before acting. ECB is canonical; this is the working copy. Mirror = Orchestration State Ledger artifact (to be created).*

- **Last reconciled:** 2026-05-26 (first session)
- **Canonical state-ref:** `snapshot:6ad1f3b9-9e18-4773-92e5-0c8a8f563d01@126` (2026-05-25 TTC B2 brief; 0 events since)
- **Mode:** ACTIVE (first-session charter execution)
- **ECB mirrors:** Orchestration Agent Contract artifact `30430694-d25e-49fe-8850-c5580b96a437` (approved_instruction) · ECOS/TTC Orchestration State Ledger artifact `0628e4f0-0953-4022-99f8-4eb064f062c4` (evidence)

## Priority queue (work in flight · owner · state)
| # | Item | Owner | State |
|---|---|---|---|
| 1 | TTC §10-11430(B)(2) validity brief — routing decision (attorney / research agent / both) | **Levi** | Built, awaiting decision |
| 2 | Convention / established-practice brief | Specialist | Scoped, unwritten |
| 3 | Durable supersession structured-field (ECB MCP, spec `325b3183`) | Code/infra | Carried, unresolved |
| 4 | `ecbrain-v1` (7 commits ahead of `main`) — merge decision | **Levi** | Awaiting review/merge |
| 5 | Code Orchestrator first-session charter | CO | **In execution** — files written + corrected (Levi A/B); ECB writes in progress; commit + snapshot pending |

## Decision queue (awaiting Levi)
- Routing of the TTC (B)(2) brief (item 1 above).
- ~~Confirm ECB write payloads~~ → RESOLVED 2026-05-26: Levi chose write-all + activate contract.
- Optional propagation step: add an "instance-of-core-pair" cross-reference to the TTC-email artifacts `65ab2668` / `ecdc2117` (propose-before-edit).
- Git: direct-to-`main` vs short-lived `orchestration-setup` branch for `orchestration/`.
- Capture SIGMA Architect launch prompt + TTC workspace rubric (roster gaps) — when?

## Review queue (drafts / outputs pending review)
- #10 Connected Memory Operationalization Addendum — `4ec3fb2a` (parked mid-review).
- Unreviewed draft artifacts — `7e0952c9`, `d32a5aca`, `4bfdd6a4`.
- Operational Kernel — ECB-First Retrieval Amendment (proposed) — `0bd1e266` (unreviewed).

## Drift queue (detected divergences · reconciliation status)
- **Role model** — earlier framed as two separate pairs; per Levi (2026-05-26) they are ONE customizable-core orchestration/babysitter pair with two instances (TTC-email = `65ab2668` + `ecdc2117`; infrastructure = Code Orchestrator + Babysitter). *Status: RESOLVED — integrated in contract (Pair Pattern & Instances) + roster. Root cause: prior core not captured/compounded/propagated; switching cost too high.*
- **Branch hygiene** — orchestrator state must stay off `ecbrain-v1`. *Status: held; resolves at commit.*
- **Roster GAPs** — SIGMA Architect prompt + TTC workspace rubric not in ECB. *Status: flagged in decision queue.*

## Session log
- **2026-05-26 (first session):** Boot (warm, clean). Confirmed Code Orchestrator per BRAIN `f34a1c37`. Levi pasted authoritative `orchestration-contract.md`. Plan approved (full 8-item mandate). Created `orchestration/` (6 files); handshake + sandbox resolved from provisional. **Levi corrections:** (A) integrate the orchestration/babysitter pair as one customizable core with instances, not separate roles — applied to contract + roster; (B) Code Orchestrator spawns read-only subagents at its own discretion, no waiting to be asked — applied to contract, code-orchestrator, analyses. Executing ECB writes (write-all + activate contract). → next: commit off `ecbrain-v1`, snapshot at close.

---

# ════ TRACK A RUN — 2026-06-10 (SOLO / Claude Code only) ════

Work order: ECB `ecb-toolscape-drift-audit-eval-suite-2026-06-08` block `/track-a-work-order-2026-06-10` (v5) + addenda. Codex dropped by Levi at launch → this is a single-agent run; the two-agent protocol's inter-agent baton/division machinery is moot (one writer per every surface = me). Substantive invariants still bind: pre-deploy diff checkpoint, ECB propose-before-execute, secrets-as-names-only, escalate-don't-silent-proceed. **STATUS: PHASE 1 complete; PAUSED at pre-Step-0 escalation awaiting Levi.**

## [capabilities:claude-code] — probed 2026-06-10, not declared
| Capability | Result | Evidence |
|---|---|---|
| git read — ECOS-build @ `~/ecos` | ✅ VERIFIED | `ls-remote origin` exit 0, 5 heads |
| git push — ECOS-build @ `~/ecos` | ✅ VERIFIED | scratch branch pushed + deleted clean |
| ECOS vault repo (`Levi-Anthony/ECOS`) | ⚠️ NO LOCAL CHECKOUT | exists on GitHub; absent under `~` (depth-3 scan) |
| ECB MCP read | ✅ VERIFIED | manifest + block reads on work-order key |
| ECB MCP write | ◻️ UNTESTED | will use propose-first path only (governed); no probe write made |
| Supabase read | ✅ VERIFIED | `list_projects`: prod `lqbrzoicorehwidkdhoi` (open-brain) + staging `gfqumzumfdeeojuwwvbu` both ACTIVE_HEALTHY |
| Supabase deploy_edge_function | ◻️ UNTESTED | access present (read ok); deploy is gated anyway |
| Vercel **MCP** | ❌ FORBIDDEN | `get_project` crm-dashboard → 403; `list_teams` → [] |
| Vercel **CLI** | ✅ VERIFIED | `vercel whoami`=levi-anthony; `project ls` shows ecos + crm-dashboard. **All Vercel work routes through CLI/Bash, not MCP.** |
| filesystem — `~/ecos` | ✅ VERIFIED | full read; writes gated on Step 0 |

## [division] — SOLO
No counterpart. Claude Code holds every baton: sole committer (ECOS-build @ `~/ecos`), sole ECB-writer (propose-first), sole deployer (Supabase edge fn + Vercel CLI). No `[baton]` handoffs this run — single-writer invariant trivially held.

## FACTs — topology (Step 0 ADDITION: crm-dashboard location + repo reality)
- **FACT** crm-dashboard lives at one path: `~/ecos/apps/crm-dashboard` (inside the ECOS-build infra checkout). Not scattered.
- **FACT** `~/ecos` is a git checkout of `Levi-Anthony/ECOS-build` (infra repo), branch `main`, clean except `M .github/workflows/ci.yml`.
- **FACT** `~/ecos-build` does NOT exist on disk. The two-agent protocol's repo paths (`~/ecos`, `~/ecos-build`) and ledger path (`~/ecos-build/.orchestration/STATE.md`) are mislabels. Canonical ledger = this file (`~/ecos/orchestration/STATE.md`), per the Orchestration Agent Contract dir.
- **FACT** `Levi-Anthony/ECOS` (vault/"thinking" repo) exists on GitHub but has NO local working copy under `~`.
- **FACT (contradicts inherited claim)** Work order's June-9 diagnosis said "~/ecos unversioned outside both repos." As of 2026-06-10, `~/ecos` IS the versioned ECOS-build checkout. Inherited "unversioned" claim falsified — logged as evidence for the Step 2 topology memo.

## [escalation] — open for Levi before Step 0 (see chat)
1. Solo-run reframe — confirm single-agent interpretation (invariants kept, inter-agent ceremony dropped).
2. Vercel access is CLI-only (MCP 403) — confirm routing the crm-dashboard review-path fix through the `vercel` CLI is acceptable.
3. Ledger location — confirm this file is the canonical ledger (protocol's `~/ecos-build` path is dead).
4. Topology note: vault repo has no local checkout; Step 2 memo will treat from GitHub + filesystem evidence.

## [decisions:levi] — 2026-06-10, pre-Step-0
- **Start Step 0 now** under solo reframe.
- **Deploy gate = ONE combined checkpoint covers BOTH surfaces** (Supabase ecb-mcp edge fn + Vercel crm-dashboard redeploy). I prepare both diffs, present together once, deploy both on a single go.
- **Proceed on the ECB work order alone** (no separate launch prompt needed).
- Carried constraint: if crm-dashboard remediation requires secret env-var VALUES (e.g. `HUMAN_AUTH_PASSWORD`), Levi sets values; I never handle them.

## [run-log]
- 2026-06-10: PHASE 1 done. → STEP 0 starting (drift export, both directions).
- 2026-06-10 STEP 0 findings (branch `step0/export-apply-artifact-proposal-agent-tx`, PR #6):
  - **APPLIED-NOT-IN-REPO:** `20260609094504_add_apply_artifact_proposal_agent_tx` (Two-Door agent approval fn) was live in prod, uncommitted. Exported verbatim from `schema_migrations.statements`; replay-verified on staging — `pg_get_functiondef` md5 byte-identical to prod (`23dc3bf0…`, 2944). Committed.
  - **REVERSE-DRIFT / PRE-EXISTING BLOCKER (from #6):** `20260609010000_drop_unused_embeddings` shipped to main BROKEN — `save_handoff_snapshot_tx` had `p_embedding DEFAULT NULL` before non-defaulted `p_metadata` → **SQLSTATE 42P13**. `supabase db reset` (CI `database` job) has been **RED on main since #6 merged**. Git could NOT reproduce the live schema. Fixed in place (p_metadata DEFAULT '{}'::jsonb); never applied anywhere, so in-place edit is correct. Committed to same branch.
  - **#6 embeddings-removal is FULLY UNDEPLOYED:** prod still computes+passes embeddings (writes succeed, 0 null embeds, latest 21:15); repo `handoff.ts` already omits p_embedding + migration 010000 not applied. Deploying #6 needs the 42P13 fix first (else prod migration also fails). → feeds Step 1 / deploy planning.
  - **Pending-to-prod (reverse) still open, gated:** `20260609010000` (after fix) + `20260609020000_artifact_notes`. Apply under the single combined deploy checkpoint, coordinated with the matching edge-fn deploy.
  - **SECOND pre-existing breakage (test-suite drift), masked by the first:** once reset passed, `supabase test db` failed — pgTAP tests insert `auth.users.confirmed_at`, which newer Supabase Postgres makes a GENERATED column. Fixed `artifact_human_authority_self_status.sql` + `artifact_v3_human_door.sql` to use `email_confirmed_at` (matching the already-correct `artifact_dashboard_authorized_writes.sql`). Test-only.
  - **PR #6 now fully GREEN** (HEAD `7a880e2`): database (reset + test db), ecb-mcp, dashboard, secrets, Vercel all pass. Git reproduces the live schema. Net finding: **commit #6 had merged with the `database` CI job RED** (reset died at 42P13; the test drift was hidden behind it).
  - RESOLVED: Levi gave calibration guidance (→ [[feedback-decision-scaffolding-by-importance]]); merged PR #6 (rebase) — main green, git reproduces live schema. STEP 0 DONE.
- 2026-06-10 STEP 1 (create_artifact authority defect) — DONE repo-side (PR #7 merged, main green):
  - **Root cause (corrected from spec):** defect is in DB RPC `create_artifact_v2`, NOT the edge-fn handler (thin wrapper). Non-"sensitive" kinds were born active/live_audit. → deploy is `apply_migration`, NOT `deploy_edge_function`.
  - Fix: new migration `20260610223000_create_artifact_draft_always` — agent create path always draft/human_gate; promotion only via gated patch path; no caller self-promotion; no privileged bypass (spec T5 optional). Tool desc updated. Regression test added (document + eval_plan → draft/human_gate; snapshot on draft; revision records human_gate). CI database full-replay GREEN.
- **PENDING-TO-PROD deploy set (all repo-only, for the ONE combined checkpoint):**
  1. `20260609010000_drop_unused_embeddings` (fixed) — couples with the ecb-mcp edge-fn redeploy (#6 TS that omits p_embedding).
  2. `20260609020000_artifact_notes`.
  3. `20260610223000_create_artifact_draft_always` (Step 1).
  + ecb-mcp edge-fn deploy (embeddings-removal TS + create_artifact description).
  + crm-dashboard review-path fix + redeploy (NOT yet built).
- **REMAINING:** crm-dashboard review-path fix (Track A owns end-to-end, Addendum 2) · Step 2 topology memo (no deploy) · combined deploy checkpoint (THE gate) · live acceptance T1–T5 + defect-window backfill triage · close (handoff snapshot).
  - STATUS: Steps 0–1 done + deploy-ready. Next: crm-dashboard review-path investigation (read-only).
- 2026-06-10 CRM-DASHBOARD review-path investigation (read-only) — inherited hypothesis FALSIFIED:
  - **Env vars PRESENT in prod (4/4):** HUMAN_AUTH_EMAIL, HUMAN_AUTH_PASSWORD, SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL (created ~6d ago; all prod deployments since are newer). So NOT `missing_configuration` — the work order's leading hypothesis is wrong.
  - **DB side re-verified CORRECT:** `artifact_human_authorities` row → user_id `2c7e83e4` (auth user `artifact-reviewer@…`), principal_id=`levi`, display_name=`Levi Anthony`, active=true. RPC `get_current_artifact_human_authority_status` returns `ready` for that user. So NOT authority_missing/inactive, and the display_name validation passes.
  - **Auth audit log empty 7d** (`[]`) — consistent with sign-in never succeeding (GoTrue logs successful logins; failures don't).
  - **BY ELIMINATION → `authentication_failed`:** `signInWithPassword(HUMAN_AUTH_EMAIL, HUMAN_AUTH_PASSWORD)` fails. Root cause is a **secret VALUE mismatch** (wrong/stale email, password, or anon key) — Levi's domain; I never handle values.
  - **Legibility largely already present:** actions catch+redirect with feedback (actions.ts:85), page renders readiness message (page.tsx:205). Likely no swallowed-redirect code fix needed — confirm via the deliberate-failure legibility acceptance test. So the crm-dashboard "fix" may be config-only (no patch), contra the work order's patch+regression expectation.
  - **Flag:** the reviewer auth user is named `artifact-reviewer@…` (matches the test fixture name) — confirm that's the intended production reviewer account, not a leaked test user.
  - BLOCKED on Levi: reviewer-credential reconciliation (secret values). DEFERRED per Levi (deploy Steps 0/1 first). Reviewer acct `artifact-reviewer@…` = UNVETTED/open (Levi: agent-suggested, unsure) — give risk read on return.
- 2026-06-10 DEPLOY (Levi go: "Step 1 + notes") — prod `lqbrzoicorehwidkdhoi`:
  - Applied `20260609020000_artifact_notes` + `20260610223000_create_artifact_draft_always` via apply_migration, then **relabeled schema_migrations.version to exact repo filenames** (apply_migration auto-versions otherwise → would re-trip drift).
  - **Drift re-check: CLEAN on critical axis** (exit 0); only `20260609010000` (embeddings) pending-by-design.
  - **Live T1 PASSED:** deployed create_artifact_v2, non-sensitive `document` → draft/human_gate (rolled back, 0 residue). T2 routing + T4 snapshot covered by CI regression + existing human_gate tests; T3 structural (draft excluded from active-default search); T5 N/A (no privileged path).
  - **Backfill triage (read-only, delivered to Levi, NOT mutated):** 4 agent-created active/no-approval artifacts since 2026-06-05 — `ecb-toolscape-drift-audit-eval-suite-2026-06-08` (eval_plan/live_audit, the work order's own artifact), `claude-platform-bootloader-spec` (spec/live_audit; supposedly demoted via 2b247c0e but still active), `skill-n-agentic-harnesses` + `skill-panning-for-gold` (agent_instruction/human_gate but active — gated artifact reached active w/o approved event).
  - **RECONCILED 2026-06-10 (Levi): all 4 are INTENTIONAL captures Levi approved while working around the broken artifact system in another session — NOT create-defect victims to fix. Nothing to demote, nothing to reverse. The empty/odd review trails (incl. bootloader proposal 2b247c0e pending, skills active w/o approval event) are artifacts of that deliberate workaround. The create_artifact defect is FIXED going forward; these existing items stay as-is ON PURPOSE. A future session must NOT auto-demote or "correct" them.**
  - **STEP 0 + STEP 1: COMPLETE & DEPLOYED.**
- 2026-06-10 EMBEDDINGS DEPLOY (Levi go: "stage-first, then prod") — **DEFERRED after stage-first caught a boot crash:**
  - Edge-fn deploy blocked first by `deno.lock` v5 vs CLI 2.75.0 → fixed by deleting the gitignored local lock; staging deploy then succeeded.
  - `010000` applied to staging; **DB embedding-less write verified** (save_handoff_snapshot_tx with no p_embedding → NULL embedding row; rolled back).
  - **BUT staging endpoint returns 500 `WORKER_ERROR` (boot crash).** Ruled out: tool count (exactly 58 ✓), missing secrets (staging has all 9 ✓).
  - **ROOT CAUSE PINNED:** `helpers.ts:32-47 getSupabaseAdminKey()` runs `JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS"))` and reads `.default`, only falling back to `SUPABASE_SERVICE_ROLE_KEY` when SUPABASE_SECRET_KEYS is UNSET. Supabase auto-injects SUPABASE_SECRET_KEYS, so it's always set but not in the `{ "default": "<key>" }` shape this code assumes → throws at module load → WORKER_ERROR. A #5/#6 change never deployed (edge-fn not redeployed since pre-#5; CI only `deno check`s, never boots the worker). Local repro confirmed the throw is at that line.
  - **DECISION: do NOT deploy ecb-mcp to prod** — prod's SUPABASE_SECRET_KEYS is auto-injected the same way → it would crash the live ECB MCP. `010000` held too (coupled). Stage-first prevented a prod outage. Staging ecb-mcp is left crashing (v13) — fine (test project), fixed when the boot bug is.
  - **Unblock follow-up:** (1) fix `getSupabaseAdminKey` to tolerate the real injected SUPABASE_SECRET_KEYS format — wrap JSON.parse in try/catch and prefer/ fall back to SUPABASE_SERVICE_ROLE_KEY; (2) redeploy staging, curl with `x-brain-key`=MCP_ACCESS_KEY → expect tools/list 200; (3) then prod (apply 010000 → deploy edge-fn). Tooling: CLI 2.75.0 can't bundle lock v5 — delete the gitignored local `deno.lock` before deploy (worked) or upgrade CLI ≥2.105.0. Add a boot-smoke step to CI so this class is caught.
- 2026-06-10 STEP 2 topology memo: DELIVERED → `docs/architecture/topology-decision-memo-2026-06-10.md` (git-canonical ratify + automate drift gate; Obsidian=local scratch; ~/ecos=infra working tree; keep two-repo split; vault repo dormant). No structural changes made.
- **REMAINING:** diagnose+fix ecb-mcp boot crash (issue #9) → embeddings deploy · crm-dashboard creds (Levi) + verify · review/ratify topology memo PR #8 (merged as doc; recommendations not yet ratified).
- **FUTURE (Levi-flagged, future session):** artifact-governance schema is conceptually overloaded and Levi has no workable mental model of it. Three colliding fields — `status` (lifecycle: draft/active/archived/superseded) × `review_policy` (write-gate: live_audit vs human_gate) × `authority_level` (advisory weight: evidence…policy). Collisions: "draft" means different things on `status` vs `authority_level`; `authority_level` looks enforcement-bearing but is advisory-only; review_policy jargon is opaque. Needs a clarity/rename/redesign pass. This is "part of the broken artifact system" Levi referenced.
