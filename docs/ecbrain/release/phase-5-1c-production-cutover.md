# Phase 5.1c — Production Cutover Audit

Final audit report for the ECBRAIN V1 production cutover.

---

## Final verdict

**PASS.**

Production was cut over to ECBRAIN V1 at release tag `ecbrain-v1-rc2`,
release commit `79b824e2e01aeddebc115354895727e7d0c26c3f`. All seven
new tools are reachable; the three new tables are present; the
hardened RPC is callable; the legacy `pulse_log` is preserved as
`pulse_log_legacy`. Smoke evidence is retained.

## RC1 failure summary

RC1 failed at the migration apply step due to **unqualified pgvector
references** in the V1 migration files. The migrations referenced
`vector(1536)` and `vector_cosine_ops` without the `extensions.`
schema prefix. pgvector is installed in the `extensions` schema, and
the production search path did not place `extensions` ahead of
`public` for the affected statements. The result was a migration
that could not resolve the type and operator class, leaving the
schema in an incomplete state.

RC1 was not rolled back into production. The failure was caught at
the dry-run / apply boundary before partial state could persist
beyond what was reversible.

## RC2 remediation summary

RC2 fixed the failure by **schema-qualifying every pgvector
reference** in the affected migrations:

- `vector(1536)` → `extensions.vector(1536)`
- `vector_cosine_ops` → `extensions.vector_cosine_ops`

The change was scoped to type declarations and index operator class
references. No semantic change to the schema; only the resolution
path was made explicit. The fix is committed at
`79b824e2e01aeddebc115354895727e7d0c26c3f` and tagged
`ecbrain-v1-rc2`.

## Preflight results

Preflight checks against production before apply:

| Check                                          | Result |
|------------------------------------------------|--------|
| Working tree clean                             | PASS   |
| Branch matches `ecbrain-v1`                    | PASS   |
| Release tag points at expected commit          | PASS   |
| Pending migration list matches expected set    | PASS   |
| Each pending migration inspected by hand       | PASS   |
| All pgvector references schema-qualified       | PASS   |
| No DROP / no unguarded UPDATE in pending set   | PASS   |
| Production ref differs from staging ref        | PASS   |

## Temporary linked worktree result

Because the installed Supabase CLI version (v2.75.0) did not cleanly
support running migration apply against a project other than the
currently linked one, a temporary linked-worktree pattern was used:

| Step                                            | Result |
|-------------------------------------------------|--------|
| Created fresh git worktree at release tag       | PASS   |
| Linked worktree to production project           | PASS   |
| Verified `supabase status` showed production ref| PASS   |
| Primary checkout retained no link to production | PASS   |
| Worktree unlinked after use                     | PASS   |
| Worktree removed after use                      | PASS   |

The pattern is documented in `docs/ecbrain/operations-runbook.md`.
It is a workaround for the CLI limitation, not a permanent pattern.

## Migration dry-run / apply results

| Migration                                              | Dry-run | Apply |
|--------------------------------------------------------|---------|-------|
| `20260507000001_create_pulse_entries.sql`              | PASS    | PASS  |
| `20260507000002_create_handoff_events.sql`             | PASS    | PASS  |
| `20260507000003_create_handoff_snapshots.sql`          | PASS    | PASS  |
| `20260507000004_create_save_handoff_snapshot_tx.sql`   | PASS    | PASS  |
| `20260507000005_rename_pulse_log_legacy.sql`           | PASS    | PASS  |

(Includes RC1's pgvector qualification fix as part of the included
migration set; no separate fix migration was required.)

## Post-migration verification

| Verification                                                | Result |
|-------------------------------------------------------------|--------|
| `public.pulse_entries` exists with expected columns         | PASS   |
| `public.handoff_events` exists with expected columns        | PASS   |
| `public.handoff_snapshots` exists with expected columns     | PASS   |
| `public.save_handoff_snapshot_tx` exists and is hardened    | PASS   |
| `public.pulse_log` no longer exists under that name         | PASS   |
| `public.pulse_log_legacy` exists and is empty               | PASS   |
| All pgvector columns resolve to `extensions.vector(1536)`   | PASS   |
| HNSW indexes resolve to `extensions.vector_cosine_ops`      | PASS   |

## Unlink cleanup

| Step                                            | Result |
|-------------------------------------------------|--------|
| Worktree unlinked from production               | PASS   |
| Worktree directory removed                      | PASS   |
| Primary checkout `supabase status` confirms no production link | PASS |

## Deploy result

| Check                                           | Result |
|-------------------------------------------------|--------|
| Function `ecb-mcp` deploy from release commit   | PASS   |
| Post-deploy production tool count = 48          | PASS   |
| Edge function logs show no startup errors       | PASS   |

## Smoke A–F results

| Smoke | Description                                                            | Result |
|-------|------------------------------------------------------------------------|--------|
| A     | `log_pulse` writes a row to `pulse_entries`                            | PASS   |
| B     | `list_recent_pulse` reads back the smoke row                           | PASS   |
| C     | `append_handoff_event` writes an event with monotonic `event_seq`      | PASS   |
| D     | `list_handoff_events` reads back the smoke event in order              | PASS   |
| E     | `save_handoff_snapshot` compiles and persists a snapshot transactionally | PASS |
| F     | `get_latest_handoff_snapshot` returns the smoke snapshot as current    | PASS   |

Each smoke run used `test_run_id: phase_5_1c_prod_smoke_20260508`.
Header-based auth was used for every smoke call. No smoke call used
the `?key=` query-string fallback.

## Production final state

| Field                 | Value                                                       |
|-----------------------|-------------------------------------------------------------|
| Project               | open-brain (`lqbrzoicorehwidkdhoi`)                         |
| MCP function          | ecb-mcp                                                     |
| MCP URL               | `https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp` |
| Tool count            | 48                                                          |
| Release tag           | ecbrain-v1-rc2                                              |
| Release commit        | `79b824e2e01aeddebc115354895727e7d0c26c3f`                  |
| New tables            | pulse_entries, handoff_events, handoff_snapshots            |
| Renamed table         | pulse_log → pulse_log_legacy                                |
| New RPC               | save_handoff_snapshot_tx (hardened)                         |

## Connector follow-up

| Client      | Connector | Auth                  | Status     |
|-------------|-----------|-----------------------|------------|
| Claude Code | ecb       | x-brain-key header    | Connected  |
| Claude.ai   | (web)     | ?key= query-string    | Connected  |

The Claude.ai web connector uses the query-string fallback because
the UI did not support custom request headers at the time of cutover.
This is documented in `docs/ecbrain/connectors.md` and is a known
caveat, not a defect. If a future Claude.ai release supports custom
headers, the web connector should be migrated and the key rotated.

## Smoke row IDs

| Object                                        | ID                                       |
|-----------------------------------------------|------------------------------------------|
| `test_run_id`                                 | phase_5_1c_prod_smoke_20260508           |
| `pulse_entries` smoke row                     | 906bac6f-f2a8-45d5-807a-e167533bd855     |
| `handoff_events` smoke row                    | e8b5863e-404e-47d5-81c9-88130333aced     |
| `handoff_snapshots` smoke row                 | 7c57094d-1203-4a5d-aaa2-486bcfc11822     |

These rows are retained as audit evidence. Cleanup, if desired, is a
separate bounded work order.

## Safety statement

No secrets are recorded in this report. No `?key=...` URL with a
real value appears in this report. No raw embedding vectors appear
in this report. No smoke call used `?key=` auth — every smoke call
used the `x-brain-key` header path so that the production auth
shape was the one being exercised.
