# People-Intelligence Prompts
*Part 1: claude.ai extraction prompts · Part 2: Claude Code companion library*

---

## Part 1 — claude.ai Extraction Prompts

**Purpose:** Extract clean, atomic, typed intelligence from claude.ai memories before importing into person_observations. The core problem: claude.ai memories compress multiple claims into single entries, blur temporal scope, and accumulate stale entries without supercession markers. This prompt forces decomposition and classification before export.

**How to use:**
1. Run the template below in claude.ai (with [NAME] and [DOMAINS] filled in)
2. Paste the structured output into a Claude Code session
3. Use the "Seed from extraction output" prompt (Part 2) to ingest

---

### Extraction Template

> Run separately for each person. Do not batch.

---

I need you to extract everything you have in memory about **[NAME]** and output it in a strict structured format for import into a CRM system. I am NOT asking for a summary — I need atomic, decomposed items.

**Step 1 — Retrieve**
Search your memory for everything about [NAME]: relationship history, behavioral patterns, communication style, conflicts, decisions, domain-specific notes. Domains of interest: [DOMAINS].

**Step 2 — Decompose**
Before outputting, audit each memory item: if it contains more than one distinct claim (often signaled by "and," "also," "while," or a semicolon), split it into separate items. Do not merge observations from different time periods. Each output item must represent exactly one claim.

**Step 3 — Classify**
For each item, assign:
- **type**: `fact | observation | interpretation | hypothesis | strategy`
  - fact: verifiable, objective (e.g., role, credential, stated position)
  - observation: behavioral pattern you have seen, not yet interpreted
  - interpretation: your read of what the behavior means
  - hypothesis: plausible explanation not yet confirmed
  - strategy: recommended action in response
- **confidence**: 1–5 (1 = vague impression; 5 = directly stated or repeatedly confirmed)
- **domain**: which relational context this belongs to
- **temporal**: when this was true — be as specific as you can, or write "unclear"
- **current**: `yes | no | uncertain` — is this still your best understanding as of today?
- **supersedes**: if this item updates an earlier understanding, briefly describe what it replaces — otherwise write "none"

**Step 4 — Output**
Output ONLY the structured items below. No preamble. No summary. No prose.

For each item:
```
---
NAME: [NAME]
TYPE: [fact|observation|interpretation|hypothesis|strategy]
DOMAIN: [domain]
CONFIDENCE: [1-5]
TEMPORAL: [when / "unclear"]
CURRENT: [yes|no|uncertain]
SUPERSEDES: [what this updates, or "none"]
CONTENT: [standalone statement in third person — must make sense with no surrounding context]
```

---

### Per-Person Variants

**Victoria**
- DOMAINS: `tango, TTC board, professional`
- Extraction focus: leadership style, board dynamics behavior, communication patterns, decision-making patterns, any tensions or alliances, relationship trajectory.
- Reminder: keep `observation` (what you saw) and `interpretation` (what it means) as separate items.

**Kate**
- DOMAINS: `tango, TTC board, business partnership, personal/conflict`
- Extraction focus: partnership dissolution facts, behavioral conflict patterns, community calendar behavior, TTC board alignment behavior, re-engagement tactics, current administrative status.
- Critical: this person has multiple overlapping pattern entries at different confidence levels. Flag every temporal boundary you can identify. Keep facts, observations, and interpretations in separate items — do not merge a behavior with its cause in one entry.

**Richard**
- DOMAINS: `tango, professional, personal`
- Extraction focus: professional relationship facts, communication style, domain involvement, current relationship status, any notable patterns.

**Evelyn**
- DOMAINS: `personal, business partnership history`
- Extraction focus: relationship trajectory, disengagement pattern, boundary dynamics, wave-riding behavior, current status.
- Critical: Evelyn patterns changed significantly over time. Temporal separation is required — early-period and later-period observations must appear as distinct items. Do not merge observations from different phases of the relationship.

---

## Part 2 — Claude Code Companion Prompt Library

### Seed from extraction output
```
Here is the structured extraction output from claude.ai for [Name]:

[paste output]

Steps:
1. search_contacts to get contact_id for [Name]
2. For each CURRENT: yes item, draft add_person_observation calls
3. Surface any CURRENT: no items separately — I'll decide which to skip
4. Flag any items where SUPERSEDES is not "none" — I want to confirm before treating prior entries as outdated
5. After all observations are loaded, compile_person_snapshot
Confirm the full list before executing any writes.
```

### Pre-meeting prep
```
Prep for my [call/meeting] with [Name] [about topic if known].
1. get_person_card for [Name] (contact_id: [uuid or "look it up"])
2. search_brain_for_contact for [Name] with domain_context "[topic/domain]"
Summarize: (1) key patterns I should have in mind, (2) open items from prior interactions, (3) recommended posture.
```

### Post-conversation capture
```
I just spoke with [Name] about [topic]. Notes:
[your raw notes]

From this, draft the person_observation entries. One item per observation. Use correct types.
Flag any that might supersede existing observations before writing.
Confirm list, then execute add_person_observation calls.
```

### Supersession check before capture
```
Before I add this observation about [Name]:
"[content]"

Check BRAIN (search_brain_for_contact) and existing observations (get_person_observations).
Is there a prior entry this would conflict with or supersede? If yes, surface it — I'll decide whether to update the existing entry or add this as a newer interpretation.
```

### Compile snapshot
```
Compile a current person snapshot for [Name].
1. get_person_observations for [contact_id]
2. search_brain_for_contact for [Name]
3. Draft snapshot_content as readable prose covering: relationship status, key patterns, strategic posture, open items
4. List the source_observation_ids and source_thought_ids you'll use
Confirm draft before executing compile_person_snapshot.
```

### BRAIN dedup and staleness review
```
BRAIN cleanup review for [Name].
1. search_brain_for_contact for [Name] at threshold 0.30, limit 15
2. get_person_observations for [contact_id]

From the BRAIN results, identify:
(a) Near-duplicate entries (same claim, different wording)
(b) Entries that appear to be superseded by more recent observations or a newer BRAIN entry
(c) Entries where temporal context makes the claim ambiguous or possibly stale

Output a table: [ID | Content snippet | Issue | Recommended action: keep / update / delete]
I'll approve before any writes.
```

### Cross-person pattern audit
```
Cross-person pattern audit across [Name1], [Name2], [Name3].
1. get_person_card for each
2. get_person_observations for each (no type filter)
3. Synthesize:
   - What patterns appear across multiple people?
   - What distinguishes each person's behavior pattern?
   - Any interaction effects I should be aware of (e.g., how they relate to each other)?
Output as structured analysis, one section per person + one cross-person section.
```

### Full people-intelligence boot (session start)
```
People-intelligence session boot.
For each of: [Name1, Name2, Name3, Name4]
1. get_person_card
2. Surface any observations flagged as high-confidence interpretations or strategies

Synthesize: who has the most outdated profile (no recent observations, no snapshot)? Who should I prioritize seeding or updating this session?
```
