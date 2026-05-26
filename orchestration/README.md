# orchestration/ — Code Orchestrator working state

*State-schema spec (first-session mandate item 4). Created 2026-05-26.*

This directory is the **Code Orchestrator's working state** for ECOS/TTC architecture coordination. **ECB is canonical**; these files are working copies, derived from ECB at session start and pushed back at session boundaries. The driving constraint: the **Babysitter has no filesystem** — it reads ECB only — so anything the Babysitter must see lives in ECB, mirrored here for the Code Orchestrator's own use.

## Read order (every Code Orchestrator session)
1. `get_boot_context` (ECB) — warm-start picture.
2. **`STATE.md`** — live queues; reconcile against ECB before acting.
3. `orchestration-contract.md` — the inter-agent contract (parties, boundaries, handshake, sandbox).
4. `code-orchestrator.md` — own operating discipline + interaction protocol, as needed.
5. `specialist-roster.md` / `analyses.md` — when briefing a specialist or considering parallel/determinative work.

## Files
| File | Holds | Mandate item |
|---|---|---|
| `STATE.md` | Live queues (priority / decision / review / drift) — **read first** | 4 (instance) |
| `orchestration-contract.md` | Canonical inter-agent contract | 7, 8 resolved |
| `code-orchestrator.md` | Operating discipline + interaction protocol | 1, 2 |
| `specialist-roster.md` | Specialist roster + brief template | 3 |
| `analyses.md` | Parallelization + determinative-work candidates | 5, 6 |
| `README.md` | This spec | 4 (schema) |

## Naming convention
Lowercase-kebab `.md`. `STATE.md` and `README.md` are uppercased to signal "read-first / start-here" — mirrors the repo's existing `HANDOFF.md` convention.

## Git workflow
- Lives **off `ecbrain-v1`** (a feature branch carrying unmerged ECBRAIN V1 work). Orchestrator state is orthogonal and must not entangle that line.
- Commits at **session boundaries** (per contract), not mid-work.
- Working tree is the source for the next commit; ECB is canonical for cross-session continuity.

## Local ↔ ECB mapping (ECB canonical)
| Local | ECB canonical | Babysitter reads via |
|---|---|---|
| `orchestration-contract.md` | Artifact: `agent_instruction`, global | `get_artifact` / `search_artifacts` |
| `STATE.md` | **Orchestration State Ledger** artifact + handoff snapshot | `get_latest_handoff_snapshot` + ledger artifact |
| `specialist-roster.md` | Folded into contract artifact | same artifact |
| `analyses.md` | BRAIN thoughts (linked to `0fa31215`, `124e933d`) | `search_thoughts` |

**Sync points.** Session start: read ECB → reconcile into local. Session boundary: propose local → ECB writes (propose-before-execute) → on approval, write → commit files. Divergence resolves toward ECB; unrecoverable divergence escalates to Levi.
