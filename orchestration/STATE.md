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
