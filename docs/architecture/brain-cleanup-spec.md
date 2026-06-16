# BRAIN Corpus Cleanup — Build Spec
*Mirrored from the Obsidian vault (`ECOS-PROJECTS/BRAIN_Cleanup_SPEC.md`) into version control on 2026-06-15. This repo copy is now canonical; the vault file is a read-only mirror.*

**Version:** 1.1
**Date:** 2026-04-03
**Status:** Approved, ready to implement
**Environment:** Claude Code (judgment layer) + Codex (mechanical layer)

---

## Problem Statement

Bundled BRAIN entries produce compromise embeddings that sit between two semantic centers. LLM mediation handles retrieval imprecision — that is not the risk. The risk is **missed retrieval**: the compromise embedding falls below threshold on queries where either half is genuinely relevant. The failure mode is silence, not noise. This project remediates existing corpus entries below the baseline ID. All entries above the baseline are governed by the amended ecos-close atomization protocol and are out of scope.

---

## Definitions

| Term | Definition |
|---|---|
| **Bundle** | Entry with two or more semantic centers whose compromise embedding costs meaningful recall on at least one retrieval query |
| **Synthesis** | Entry with multiple components that are geometrically close enough that the compromise embedding costs negligible recall — pass-through, no split |
| **Pass-through** | Entry already atomic; no action required |
| **Fragment** | Properly atomic entry produced by splitting a bundle; does not exist until split operation completes and C3 is verified |
| **Scaffold** | Original bundle entry, retained in thought_history during fragment drafting as repair material for C3 reconstruction; archived only after fragments are verified and written |
| **Cursor** | Persistent marker tracking last successfully processed entry ID plus running batch statistics |
| **Batch** | Fixed-size processing unit of 10–15 entries; the unit of cursor advancement and exception review |
| **Baseline Timestamp** | `MAX(created_at)` from the thoughts table at project initiation; defines the in-scope population. All entries with `created_at` ≤ this value are in scope. UUID v4 IDs have no temporal ordering and cannot serve as a scope boundary. |
| **Threshold** | The cosine distance between candidate fragment embeddings above which a split is warranted; calibrated empirically before batch execution begins |
| **C3** | Semantic completeness in isolation — the fragment is fully intelligible without any session context, prior entries, or implicit references |

---

## Scope

**In scope:**

- All thoughts table entries with `created_at` ≤ baseline timestamp
- Atomicity audit via geometric split test per entry
- Fragment drafting, C3 verification, and metadata re-derivation per fragment
- Scaffold archival to thought_history with archived_reason: 'split'
- Cursor management and resumable batch execution
- Exception queue for near-threshold ambiguity
- Threshold calibration run (pre-batch)

**Out of scope:**

- Entries with ID > baseline ID (governed by amended ecos-close protocol)
- Tag schema redesign (downstream of atomicity; cleaned corpus reveals correct vocabulary)
- Semantic deduplication (separate project)
- PULSE, CRM, or any non-thoughts table
- New capture protocol (already implemented in ecos-close)

---

## Architecture

### Two-Layer Execution

**Codex — mechanical layer**

- Fetches batches from Supabase via REST
- Drafts candidate fragments
- Calls embedding API to get F1, F2
- Measures cosine distance F1↔F2 against threshold
- Executes split, C3 verification, metadata re-derivation, write-back, scaffold archival, cursor advancement
- Flags near-threshold cases to exception queue
- Loads ECOS protocol context via GitMCP at initialization — canonical source, no copied prompts

**Claude Code — judgment layer**

- Threshold calibration
- Exception queue review
- Batch summary review
- Protocol governance
- Any decision requiring semantic judgment outside the geometric test

**BRAIN (Supabase) — shared persistent state**

- Both layers read and write
- The memory is owned; execution is rented and replaceable
- thought_history table is the canonical archive target

### GitMCP Context Loading

Codex loads ECOS protocol context from the canonical repo at batch initialization. No system prompt copies. Protocol updates version in git and propagate automatically at next batch start. This is the single-source solution to multi-agent context coherence.

---

## Decision Tree (per entry)

```
Read entry
    ↓
Draft candidate fragments F1, F2
Embed F1, F2
Compute cosine distance(F1, F2)
    ↓
distance < threshold
    → Pass-through. Log. Advance cursor.

distance ≈ threshold (within margin)
    → Flag to exception queue. Log. Advance cursor.

distance > threshold — split confirmed
    ↓
Verify C3 per fragment
    Cold-read test: fragment intelligible with no session context?
    Scaffold in view as repair source
    Repair by pulling implicit context up from scaffold into explicit standalone language
    ↓
Re-derive metadata per fragment independently
    type: re-assessed, not inherited
    topics: re-assessed, not inherited
    ↓
Write fragments to BRAIN (thoughts table)
Archive scaffold to thought_history
    archived_reason: 'split'
    original_thought_id: [ID]
    archived_at: now()
Advance cursor
```

---

## Cursor Atomicity — Write Order

**This order is load-bearing. Do not change it.**

1. Write fragment 1 to thoughts table — confirm
2. Write fragment 2 to thoughts table — confirm
3. Archive scaffold to thought_history — confirm
4. Advance cursor

If any step fails, the run halts. On resume, check thought_history for an existing split record on the entry before processing. If found, skip — already processed.

**Idempotency gap:** because thought_history is written in step 3 (after the fragments in steps 1–2), a crash between steps 1–2 and step 3 leaves orphaned fragments with no split record. To prevent duplicate fragments on re-run, either: (a) execute steps 1–3 as a single atomic database transaction, or (b) before re-processing any entry, query thoughts for existing fragments referencing this scaffold and delete them before writing fresh ones.

**Cursor advances only after all writes are confirmed.**

---

## Threshold Calibration (Pre-Batch Task)

Before batch execution begins:

1. Pull a stratified sample of 30 entries: 10 early, 10 mid, 10 recent
2. For each entry, manually assess: atomic, probable bundle, clear bundle
3. Draft candidate fragments for the probable and clear bundle entries
4. Embed fragments and measure cosine distances
5. Plot distance distribution against manual assessment
6. Set threshold at the distance that cleanly separates atomic from bundle in the sample
7. Record threshold value in HANDOFF.md and in project log
8. Record baseline ID in HANDOFF.md

This step produces the threshold and validates the geometric test before it runs at scale.

---

## Cursor Storage

Store in HANDOFF.md under a dedicated section:

```markdown
## BRAIN Cleanup Cursor
- Baseline Timestamp: [MAX(created_at) recorded at project initiation]
- Last processed created_at: [updated after each batch]
- Threshold: [set after calibration]
- Protocol version: [git commit hash of ECOS repo at last batch start]
- Running totals: split: N | pass-through: N | exception: N | error: N
```

---

## Batch Summary (per batch close)

After each batch, Codex produces a human-readable summary before the next batch runs:

```
Batch [N] complete
Entries processed: N
Split: N | Pass-through: N | Near-threshold (exception): N | Error: N
Exception queue entries: [list of IDs with distance values and entry content]
Cursor advanced to: [ID]
```

Claude Code reviews exception queue before next batch runs. Exceptions are either manually classified and processed, or deferred to end-of-project review.

---

## Legibility Requirements

These are non-negotiable output constraints for every batch run:

- **Batch summary is human-readable** — plain language, no raw JSON, produced before the next batch starts. Claude Code must be able to assess the run without parsing.
- **Exception queue entries surface with distance values AND entry content** — not just IDs. Judgment requires seeing what was flagged.
- **Errors halt the batch and report the failure point explicitly** — which step failed, which entry ID, what the error was. No silent degradation.
- **The only silent outcome is a clean pass-through.** Everything else makes noise.

---

## No Silent Failures

Any of the following must produce an explicit log entry — not a pass-through, not a skip:

- Write failure (fragments, scaffold archival, cursor)
- Threshold ambiguity (near-threshold flagging)
- C3 verification failure (fragment fails cold-read test)
- Embedding API error
- Any step in the atomic write sequence that does not confirm

Silence means success. Noise means something happened. This is the invariant that makes the audit trail trustworthy.

---

## Red Team — Mitigations Built In

| Attack | Mitigation |
|---|---|
| Over-splitting syntheses | Geometric test — low F1↔F2 distance means pass-through regardless of linguistic appearance |
| C3 repair failure (fragments implicitly reference each other) | Cold-read test with scaffold visible as repair source; explicit C3 standard |
| Metadata inheritance | Metadata re-derivation is a mandatory step; original tags are input to re-derivation, not defaults |
| Silent pass-through on ambiguous bundle | Near-threshold goes to exception queue, not pass-through |
| Cursor failure / partial write | Atomic write order; cursor advances only after all writes confirmed |
| Context window degradation mid-batch | Batch size bounded at 10–15 |
| Synthesis over-classification | Exception queue entries require distance value logged; reviewable; high exception rate is a signal |
| Protocol drift mid-project | GitMCP loads canonical context at each batch start; protocol version logged with cursor |
| Scope creep from growing corpus | Baseline ID established at initiation; entries above it are out of scope |
| Double-processing from partial write | Check thought_history for existing split record before processing any entry |

---

## Implementation Sequence

1. **Establish baseline timestamp** — query `SELECT MAX(created_at) FROM thoughts` and record in HANDOFF.md under BRAIN Cleanup Cursor. This timestamp is the scope boundary — all entries with `created_at` ≤ this value are in scope.
2. **Run threshold calibration** — 30-entry sample, embed, measure, set threshold
3. **Build Codex batch agent** — fetches from Supabase, runs decision tree, writes back, manages cursor
4. **Configure GitMCP context loading** — Codex loads ECOS cleanup protocol from canonical repo at init
5. **Run batch 1 (10 entries)** — review output in Claude Code before continuing
6. **Iterate** — run batches, review exception queue at each close, advance cursor
7. **Project close** — all entries ≤ baseline ID processed; log final stats; update HANDOFF.md

---

## Open Decisions (resolve before build)

| Decision | Options | Notes |
|---|---|---|
| Embedding API for Codex | **RESOLVED: `openai/text-embedding-3-small` via OpenRouter** | Confirmed 2026-04-05 from Open Brain MCP source (`supabase/functions/open-brain-mcp/index.ts` line 23). All existing BRAIN entries were embedded with this model. Codex must use the same model and endpoint. Cross-model cosine distances are not comparable — do not substitute ada-002 or 3-large. |
| Exception queue mechanism | HANDOFF.md section vs. Supabase status field on thoughts | **BLOCKER: resolve before step 3.** Codex batch agent cannot be built until this is decided — write behavior, resume logic, and Claude Code review interface all depend on this choice. HANDOFF.md is simpler; Supabase field is queryable across sessions. |
| Batch review interface | CLI output vs. structured JSON vs. markdown table | Needs to be readable in Claude Code at batch close |

---

## Success Criteria

- All entries ≤ baseline ID have been processed (split, pass-through, or exception-reviewed)
- No orphaned scaffolds in thoughts table (all split originals in thought_history)
- No double-processed entries (thought_history has clean audit trail)
- Exception queue fully reviewed by project close
- Final stats logged in HANDOFF.md
- Corpus is ready for tag schema derivation from observed cluster structure
