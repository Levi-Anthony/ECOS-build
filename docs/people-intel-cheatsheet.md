# People-Intelligence Tools — Cheat Sheet
*Tools 18–22 · ecos-mcp · Deployed 2026-04-22 (server renamed from ecos-crm-mcp 2026-05-04)*

---

## Tool Map

| # | Tool | One-liner |
|---|---|---|
| 18 | `add_person_observation` | Write one atomic analytical insight about a contact |
| 19 | `get_person_observations` | Read observations, optionally filtered by type |
| 20 | `compile_person_snapshot` | Write versioned compiled person card (atomic) |
| 21 | `get_person_card` | Full composite card — primary pre-meeting entry point |
| 22 | `search_brain_for_contact` | Semantic BRAIN search by name at threshold 0.30 |

---

## Tool 18 — add_person_observation

**Required:**
- `contact_id` (uuid)
- `observation_type` — `fact | observation | interpretation | hypothesis | strategy`
- `content` — standalone statement; must make sense without context
- `confidence` — integer 1–5

**Optional:**
- `domain_context` — `"tango"`, `"ttc"`, `"business"`, etc.
- `observed_at` — ISO timestamp; defaults to now
- `source` — defaults to `"claude-code"`
- `linked_thought_id` — BRAIN thought UUID (provenance link)

### Observation Type Guide

| Type | Use when | Example |
|---|---|---|
| `fact` | Verifiable, objective | "Is a licensed massage therapist" |
| `observation` | Behavioral pattern seen, not yet interpreted | "Responds to written messages faster than calls" |
| `interpretation` | Your read of what the behavior means | "Uses reconciliation framing to reopen closed channels" |
| `hypothesis` | Plausible explanation, not yet confirmed | "May be responding to abandonment panic rather than strategic intent" |
| `strategy` | What to do in response | "Keep all contact in writing; do not meet in person" |

**Atomicity rule:** If content contains "and" joining two distinct claims → split into two calls.  
**Supercession:** When a new interpretation updates a prior one, note it explicitly in content: "Supersedes earlier reading that X — current read is Y."

---

## Tool 19 — get_person_observations

| Param | Required | Notes |
|---|---|---|
| `contact_id` | yes | |
| `observation_type` | no | Filter to one type |
| `limit` | no | Default 20 |

Returns observations grouped by type, newest first within each group.

---

## Tool 20 — compile_person_snapshot

**Required:** `contact_id`, `snapshot_content` (readable prose)  
**Optional:** `domains_covered` (string[]), `source_observation_ids` (uuid[]), `source_thought_ids` (uuid[])

Uses `compile_snapshot_tx` RPC — flips previous snapshot `is_current → false` atomically.  
**Never direct-insert into `person_snapshots`.** Mirrors `create_billing_entry_tx` pattern.

When to compile: after seeding 5+ observations, or before a high-stakes interaction.

---

## Tool 21 — get_person_card

**Required:** `contact_id` only.

Returns:
1. Contact header (name, company, role, admin status)
2. Latest compiled snapshot (if exists)
3. Recent observations grouped by type (up to 5 per type)
4. Linked BRAIN thoughts

**Primary pre-meeting entry point. Run this first.**

---

## Tool 22 — search_brain_for_contact

| Param | Required | Default | Notes |
|---|---|---|---|
| `contact_name` | yes | — | First name works; full name better |
| `domain_context` | no | — | Narrows query |
| `limit` | no | 10 | |
| `threshold` | no | **0.30** | Do not raise; lower threshold is intentional |

Constructs query internally: `[name] [domain?] person notes observations pattern behavior`

**Why 0.30:** Person/TASTE/framework entries use analytical language — they don't surface reliably at the standard 0.38 threshold. Validated decision; do not adjust.

---

## Workflow Patterns

### Seed a contact from a memory extraction
1. Run extraction prompt in claude.ai (see `people-intel-prompts.md`)
2. Paste structured output into Claude Code session
3. `search_contacts` → get contact_id
4. `add_person_observation` per atomic item (CURRENT: yes only)
5. `compile_person_snapshot` after 5+ observations loaded

### Pre-meeting prep
1. `get_person_card` → full context
2. `search_brain_for_contact` (domain = meeting topic) → BRAIN enrichment
3. Compile updated snapshot if observations have grown since last snapshot

### Post-conversation capture
1. `log_interaction` → the event
2. `add_person_observation` → new patterns noticed (type: observation or interpretation)
3. If a pattern changes a prior interpretation: new `interpretation` entry noting what it supersedes

### BRAIN dedup / staleness review
1. `search_brain_for_contact` at threshold 0.30
2. Compare results against `get_person_observations`
3. Flag duplicate BRAIN entries and entries superseded by newer observations
4. Update or delete via `mcp__open-brain__update_thought` / `mcp__open-brain__delete_thought`
