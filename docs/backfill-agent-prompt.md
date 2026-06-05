# BRAIN Corpus Backfill — Agent Prompt
*Paste this into ChatGPT Agent (or any capable autonomous agent). Fill in the two credential placeholders before running.*

---

## CREDENTIALS (fill these in before running)

```
MIDDLEWARE_URL = https://lqbrzoicorehwidkdhoi.supabase.co/functions/v1/brain-middleware
BRAIN_KEY      = <brain access key from your password manager or local env>
```

All requests require the header: `x-brain-key: [BRAIN_KEY]`. Do not paste the key
into chat or commit it to a file; provide it only to the runtime that will make
the requests.

---

## OBJECTIVE

You are enriching an existing semantic memory corpus. The corpus contains approximately 1,400+ entries ("thoughts") captured before a schema upgrade. Those entries are missing four metadata fields that were added to the schema:

- `domain` — which life/work domain this entry belongs to
- `horizon` — how time-sensitive this entry is
- `signal_type` — what kind of semantic signal this entry carries
- `confidence` — the epistemic status of the content

Your job: fetch all entries missing these fields, classify each one, and write the classifications back. You do NOT modify the content or the embedding — only the metadata.

**This is a one-time corpus cleanup. Run to completion.**

---

## API REFERENCE

### GET /backfill/next

Fetch the next batch of unprocessed entries (missing `domain` field).

```
GET {MIDDLEWARE_URL}/backfill/next?limit=50
Headers: x-brain-key: {BRAIN_KEY}
```

Response:
```json
{
  "entries": [
    {
      "id": "uuid",
      "content": "the thought text",
      "metadata": { "type": "observation", "topics": ["..."], "source": "mcp" },
      "created_at": "2026-03-15T..."
    }
  ],
  "remaining": 1342
}
```

- `entries`: this batch (up to 50)
- `remaining`: total entries still needing backfill (including this batch)
- When `entries` is empty, you are done.

---

### PATCH /backfill/apply

Write your classifications back to the corpus.

```
PATCH {MIDDLEWARE_URL}/backfill/apply
Headers: x-brain-key: {BRAIN_KEY}, Content-Type: application/json
Body:
{
  "updates": [
    {
      "id": "uuid",
      "domain": "ecos-architecture",
      "horizon": "evergreen",
      "signal_type": "decision",
      "confidence": "observed"
    }
  ]
}
```

Response:
```json
{ "applied": 48, "errors": [] }
```

- `applied`: how many entries were successfully updated
- `errors`: any individual failures with their IDs — retry these
- You must include all four fields for each entry. Omitting a field leaves it unset.

---

## CLASSIFICATION TAXONOMY

Classify every entry on all four dimensions. Choose exactly one value per dimension.

---

### DOMAIN — Which area of life/work does this belong to?

| Value | What belongs here |
|---|---|
| `ecos-architecture` | ECOS system design, BRAIN infrastructure, Supabase, MCP, edge functions, middleware, pgvector, embedding pipelines, technical architecture of this operating system |
| `tango-pedagogy` | Argentine tango instruction, ECTango, class design, milonga, dance technique, musicality, student dynamics, workshop content |
| `ttc-board` | Tucson Tango Club board governance, festival planning, FSP (Festival de Salsa y Pueblo?), board decisions, community politics |
| `neil-outreach` | Neil outreach campaign, book contacts, Wave structure, MFA connections, author relationships, publishing strategy |
| `it-consulting` | Client tech support, networking, systems administration, IT business operations |
| `music-production` | DAW work, recording, mixing, arrangement, production decisions, musical ideas |
| `brain-protocol` | How to use BRAIN, retrieval patterns, capture workflows, ECOS operating procedures, session protocols, boot/close rituals |
| `personal` | Personal reflections, life observations, relationships, health, energy, identity, anything that doesn't fit a work domain |

**When two domains compete:** choose the one where this entry would be most useful if retrieved in a domain-specific search. If genuinely split, use the one that appears earlier in the table above (more specific domains beat `personal`).

---

### HORIZON — How time-sensitive is this entry?

| Value | Meaning | Signals |
|---|---|---|
| `immediate` | Time-sensitive; actionable now or tied to a near-term deadline | Mentions a date, "this week", "before the meeting", named people waiting, an action item with urgency |
| `project` | Relevant to an active project but not urgent; matters over weeks/months | Part of ongoing work, references a project in progress, useful context but no deadline pressure |
| `evergreen` | Durable knowledge; doesn't expire | Principles, preferences, frameworks, architectural decisions, reference material, things that will still be true in a year |

**Default lean:** When uncertain between `project` and `evergreen`, use `project` for anything that sounds situational, `evergreen` for anything that sounds like a settled pattern or principle.

---

### SIGNAL_TYPE — What kind of semantic signal does this entry carry?

| Value | Meaning | Ask yourself |
|---|---|---|
| `taste` | Aesthetic preference, style constraint, "I prefer X over Y" | Does this express how something *should feel* or *look*? |
| `voice` | Tone, phrasing, communication style — how to write or speak | Does this capture a pattern of *expression*, not just content? |
| `struct` | Structural pattern, architectural schema, organizational framework | Does this describe how pieces *fit together*? |
| `decision` | A committed choice or resolution that was made | Did something get *decided* here? Is there a "we chose X" or "the answer is Y"? |
| `framework` | Conceptual model, mental model, heuristic for thinking | Does this provide a *lens* for understanding something, not just a fact? |
| `content` | Factual, narrative, or descriptive — doesn't fit the above categories | Is this primarily *information* rather than a pattern, preference, or decision? |

**Priority order when multiple apply:** taste > voice > decision > struct > framework > content. Use the first match.

---

### CONFIDENCE — What is the epistemic status of this content?

| Value | Meaning | Signals |
|---|---|---|
| `observed` | Directly witnessed, stated as fact, definitively happened | Declarative statements, past tense facts, confirmed outcomes |
| `inferred` | Reasoned from evidence; likely true but not directly stated | "This probably means...", "suggests", "seems like", deductions |
| `hypothetical` | Speculative, conditional, future-oriented | "If X then Y", "might", "considering", "what if", proposals |

**Default:** When a thought is a plain statement of fact or a direct capture of what someone said/did/decided, use `observed`.

---

## WORKFLOW ALGORITHM

```
loop:
  1. GET /backfill/next?limit=50
  2. If entries is empty → DONE. Report final count.
  3. For each entry in the batch:
     a. Read the content and existing metadata
     b. Assign domain, horizon, signal_type, confidence
  4. PATCH /backfill/apply with all classifications from this batch
  5. Check response:
     - If errors exist, retry each failed ID individually
     - Log: "Batch complete. Applied: N. Remaining: ~X."
  6. Go to step 1.
```

**Important:** The `remaining` count in step 1 includes the current batch. After applying the batch, fetch again — the new batch will be different entries. You are done when `entries` is empty.

---

## BATCHING STRATEGY

- Fetch batches of 50 (the default). You can go up to 100 with `?limit=100`.
- Classify the full batch before calling `/backfill/apply`. Do not interleave.
- If you need to pause mid-corpus, the endpoint is resumable — it always returns the oldest unprocessed entries first. Restart with the same workflow and it picks up where you left off.

---

## CLASSIFICATION GUIDELINES

**Read the full content before classifying.** The metadata fields (`type`, `topics`) give useful hints but can be wrong — go from the content.

**Domain is usually obvious.** Most entries clearly belong to one area. When genuinely ambiguous (e.g., a tango business entry), ask: "where would I want this to surface in a domain-filtered search?"

**Horizon follows function, not age.** An old entry about a recurring principle is `evergreen`. A recent entry about a one-time meeting is `immediate` or `project`.

**Signal_type is about form, not subject.** A tango preference is `taste` (domain: `tango-pedagogy`, signal_type: `taste`). A tango architectural decision is `decision`. A tango teaching framework is `framework`.

**When in doubt on confidence:** most spontaneous captures are `observed`. Use `inferred` only if the entry contains reasoning or interpretation. Use `hypothetical` only if it's clearly speculative.

---

## PROGRESS REPORTING

After each batch, output one line:
```
Batch N complete. Applied: X. Remaining: ~Y. [any errors noted]
```

After all batches:
```
Backfill complete. Total applied: N. Errors (if any): [list].
```

---

## ERROR HANDLING

- **Network error on GET:** wait 10 seconds, retry once. If it fails again, stop and report.
- **PATCH returns errors for specific IDs:** retry those IDs individually in the next round.
- **PATCH returns an HTTP error (5xx):** wait 10 seconds, retry the whole batch once.
- **Entry with no classifiable content (empty string, corrupted):** use `personal`, `evergreen`, `content`, `observed` as safe defaults. Note the ID in your final report.

---

## DONE CONDITION

You are finished when `GET /backfill/next` returns `"entries": []`.

Report: total entries processed, any IDs that failed after retries, and the final `remaining` count (should be 0).
