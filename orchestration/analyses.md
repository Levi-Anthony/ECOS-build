# Analyses — Parallelization & Determinative Work

*First-session mandate items 5 and 6. Created 2026-05-26. Candidate lists, not commitments. Read-only verification subagents spawn at the orchestrator's discretion (parallelization is its call, not Levi's to request); scripts get built when their leverage is confirmed.*

## Item 5 — Scope analysis: parallelizable Task subagents
Bounded, **read-only verification** workflows only (per contract: subagents for verification, never specialist work). Each is independent and fans out cleanly.

| Candidate | What it does | Parallel unit |
|---|---|---|
| **Drift audit** | Diff `STATE.md` queues vs ECB (snapshot watermark + events + ledger); emit divergence list | one agent |
| **Draft-artifact triage** | Read each unreviewed draft → review summary | one agent per artifact: `7e0952c9`, `d32a5aca`, `4bfdd6a4`, `4ec3fb2a` (#10 addendum) |
| **Source-verification sweep** | Strength-test claims vs ECB / primary sources (proven TTC babysitter pattern) | one agent per claim cluster |
| **Stale-instruction scan** | Find approved artifacts referencing superseded structures (`open-brain-mcp`/`ecos-mcp` names; old "multi-babysitter" wording) | one agent |
| **MECE / decomposition check** | Test a proposed structure for gaps/overlaps | one agent |

## Item 6 — Determinative / code-work analysis
Where deterministic scripts displace LLM orchestration. Precedent for repo utility scripts: `docs/backfill.py`.

| Candidate | Displaces | Leverage |
|---|---|---|
| **★ State↔ECB drift check** | The manual diff the orchestrator runs every session start | **Game-changer** — automates Item-1's core drift discipline; pull snapshot watermark + events, diff vs `STATE.md`, emit delta/hash |
| **★ Artifact inventory diff** | Manual tracking of what's unreviewed | **Game-changer** — list ECB artifacts by authority/review state, diff vs roster/queue, auto-flag drafts (would have surfaced `7e0952c9` et al. unprompted) |
| **Handshake validator** | Eyeballing handshake blocks | Parse a block, resolve its `state-ref` against ECB, return match/mismatch — turns the handshake from prose into a checked gate |
| **Queue linter** | Manual queue hygiene | Assert every queue item has owner + state + date |
| **State-file integrity hash** | Trust that nobody hand-edited state | Checksum `STATE.md` sections; detect unrecorded manual edits |
| **Sandbox search-time tag-exclusion** | (Conditional) sandbox-thought noise in `search_thoughts` | Only if the named residual risk in the contract's ECB Sandbox section materializes |

**The two ★ items are the highest leverage:** they automate exactly what an orchestrator otherwise burns tokens re-deriving each session, and they make drift a *detected* event rather than a *noticed* one.
