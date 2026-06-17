# ECBRAIN V1

Top-level orientation for the ECBRAIN V1 release. Production is live.
This folder is the canonical documentation pack for the system.

---

## What ECBRAIN V1 is

ECBRAIN V1 is the first production release of the ECOS BRAIN extension
on top of the Open Brain pattern. It is a Supabase-hosted MCP service
that exposes a small, opinionated set of tools for capturing operational
state — pulse entries, handoff events, and compiled handoff snapshots —
alongside the existing BRAIN, CRM, TASTE, and artifact surfaces.

ECBRAIN extends the ecb-mcp Edge Function. It does not replace it.
It does not introduce a new server, a new endpoint, or a new auth model.
It adds storage shapes and tools for responsibilities that were
previously homeless or wrongly housed.

## What ECBRAIN V1 is not

- Not a file migration system. Files are not copied into Artifacts.
- Not a second MCP server. ecb-mcp remains the single MCP surface.
- Not a CRM rewrite. CRM tables and tools are untouched.
- Not a vault sync. The Obsidian vault and Git repo retain their roles.
- Not a replacement for canonical_artifacts. It complements them.

## Governing principle

> Do not migrate files into Artifacts. Migrate responsibilities into the
> right storage shapes.

Each kind of state has a shape that fits it: low-churn canonical
documents go into canonical_artifacts; an operational pulse stream
goes into pulse_entries; an append-only event log goes into
handoff_events; a compiled current state goes into handoff_snapshots.
BOOT context is derived from those tables on demand. ORIENT is derived
on demand. Neither is stored as a file.

## Production and staging

| Environment | Project name      | Project ref            |
|-------------|-------------------|------------------------|
| Production  | open-brain        | lqbrzoicorehwidkdhoi   |
| Staging     | open-brain-staging| gfqumzumfdeeojuwwvbu   |

Production MCP URL:

```
https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/ecb-mcp
```

## Current release

- Release tag: `ecbrain-v1-rc2`
- Release commit: `79b824e2e01aeddebc115354895727e7d0c26c3f`
- Final verdict: **PASS**
- RC1 failed (unqualified pgvector references). RC2 fixed by
  schema-qualifying as `extensions.vector(1536)` and
  `extensions.vector_cosine_ops`.

Current production tool count: **48**.

## Seven ECBRAIN tools added over baseline

| Tool                          | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `log_pulse`                   | Append a single entry to the pulse stream            |
| `list_recent_pulse`           | Read recent pulse entries                            |
| `append_handoff_event`        | Append a single handoff event with monotonic seq     |
| `list_handoff_events`         | List handoff events in order                         |
| `save_handoff_snapshot`       | Compile and persist a current-state handoff snapshot |
| `get_latest_handoff_snapshot` | Read the current snapshot                            |
| `get_boot_context`            | Derive BOOT context from tools and tagged artifacts  |

## Other documents in this folder

- `current-state.md` — accepted production and staging state
- `architecture.md` — plain-language architecture reference
- `operations-runbook.md` — safe operating guide
- `connectors.md` — connector setup and recovery
- `interaction-model.md` — preferred collaboration style
- `release/phase-5-1c-production-cutover.md` — cutover audit
- `adr/0001-storage-shapes.md` — storage-shape decisions
- `adr/0002-production-release-safety.md` — release safety
- `adr/0003-plan-probe-report-collaboration.md` — collaboration model

## Reminder

Production is live. Future changes require:

1. An explicit target proof (TARGET CHECK block).
2. An explicit approval phrase from the operator.
3. A bounded work order, not a "go build everything" prompt.

The collaboration model is documented in `interaction-model.md` and
`adr/0003-plan-probe-report-collaboration.md`. Future assistants should
read those before proposing work against this system.
