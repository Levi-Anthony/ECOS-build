# TASTE — Canonical Pattern
*Decided 2026-05-04. Resolves the prior schema-vs-prefix-vs-helper-tables ambiguity.*

## Decision

The `taste_preferences` extension table is the **system of record** for taste signals. Every preference is a structured row with a parallel mirror in `thoughts` for semantic-search discoverability.

## Schema (post 2026-05-04 merge)

Branch A's runtime-tracking columns and Branch B's capture-shape columns are merged into a single richer schema:

```
taste_preferences
├── id UUID PK
├── user_id TEXT NOT NULL                 -- ECOS_USER_ID
├── preference_name TEXT                  -- short name, harvest-protocol output
├── domain TEXT                           -- where the preference applies
├── reject TEXT                           -- specific and observable
├── want TEXT                             -- specific and observable
├── type_label TEXT                       -- free-form, slash-format ("X / Y")
├── constraint_type TEXT                  -- legacy coarse tag, nullable
├── constraint_text TEXT NOT NULL         -- full original Prompt-4 string
├── source TEXT                           -- 'mcp:capture_taste_preference', 'backfill_2026-05-04', etc.
├── contact_id UUID FK                    -- optional: scope to a specific contact
├── status TEXT                           -- 'active' | 'archived' | 'superseded'
├── invocation_count INTEGER              -- bumped manually via update_taste_preference
├── last_invoked_at TIMESTAMPTZ
├── user_responded BOOLEAN
├── thought_id UUID FK → thoughts(id)     -- back-link to the semantic mirror
├── created_at, updated_at TIMESTAMPTZ

taste_evolution
├── id UUID PK
├── taste_id UUID FK → taste_preferences(id)
├── change_type TEXT                      -- 'upgraded' | 'downgraded' | 'refined' | 'archived'
├── old_value TEXT                        -- JSON snapshot before change
├── new_value TEXT                        -- JSON snapshot after change
├── reason TEXT                           -- why the change is being made
├── approved BOOLEAN
├── applied_at TIMESTAMPTZ
└── created_at TIMESTAMPTZ
```

The `constraint_type` CHECK constraint was relaxed (made nullable, free text). Levi's actual TASTE entries use slash-format type labels like `"Session discipline / Process"` that don't fit the original `aesthetic|register|process|affirmation` taxonomy — `type_label` is the primary user-facing type field.

## Capture flow — promote on approval, write to both

The Taste Harvest Protocol (see `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/ECOS/ECOS-PROMPTS/brain-capture-protocol.md`) surfaces candidates at session close. On approval, a single MCP tool dual-writes:

1. `mcp__ecb__capture_taste_preference(preference_name, domain, reject, want, type_label, [contact_id], [source])`
2. The tool composes a canonical Prompt-4 string and:
   - Inserts a structured row in `taste_preferences`
   - Inserts a `thoughts` mirror with `metadata.signal_type='taste'`, `metadata.taste_preference_id=<row id>`
   - Updates the `taste_preferences` row with the mirror's `thought_id` (bidirectional link)

The thoughts mirror exists for one reason: cross-domain BRAIN search continues to surface taste preferences naturally. Without it, querying BRAIN with "what's my taste on session discipline?" would miss everything in `taste_preferences`.

The structured row is authoritative. Future updates go through `update_taste_preference`, which logs an audit row in `taste_evolution`. The thoughts mirror is read-only after creation — if a preference is refined, the mirror stays as the original capture.

## Update flow — every change logged

`mcp__ecb__update_taste_preference(id, changes, change_type, reason)` is the only path for modifying a taste preference. It:

1. Snapshots the current row (`old_value`)
2. Applies the patch (`new_value`)
3. Inserts a `taste_evolution` row with `change_type`, `old_value`, `new_value`, `reason`, `approved=true`
4. Then updates the `taste_preferences` row

Audit history is queryable via `taste_evolution` and visible in the dashboard at `/taste/<id>`.

## Why these patterns are deprecated

**`TASTE::` prefix in `thoughts.content`** — was a legibility convention from the harvest protocol. Never had server-side parsing. Continues to appear in mirror entries (composed by `capture_taste_preference`) for human readability when reading thoughts directly, but is **not authoritative** and should not be relied on for filtering/extraction. Search via `metadata.signal_type='taste'` or via `metadata.taste_preference_id` instead.

**Helper tables before the merge** — the original `taste_preferences` (Branch A, applied 2026-04-15 in `20260415000003_ecos_crm_extensions.sql`) was created but never wired. A second schema (Branch B) lived only in a local-only `migrations/taste-preferences/` folder with a 19-row seed that was never applied. As of 2026-05-04, Branch A is the live table (with Branch B columns merged in via `20260504120002_taste_preferences_merge.sql`); the local Branch B folder has been deleted.

**`signal_type='taste'` as the authoritative pattern** — was the working pattern before the merge. After the merge, `signal_type='taste'` continues to mark thoughts mirrors but is no longer authoritative for taste preferences. The `taste_preference_id` pointer in `thoughts.metadata` is the canonical link from a thoughts mirror back to its structured row.

## What this leaves out

**Auto-increment of `invocation_count` from BRAIN search hits** — not built. Today, `invocation_count` increments only via explicit calls to `update_taste_preference` with the new count. If usage telemetry becomes valuable enough to automate, a future enhancement could hook into `match_thoughts` or a search wrapper to bump counts when a taste mirror is returned.

**Original-text dual-embedding (3/15 spec)** — partially realized via the new `original_content` column on `thoughts` (separate from this taste decision; see Migration `20260504120001`). The fuller `embedding_source` + `raw_content` design is deferred until embedding quality drops or raw dictation chunking becomes a workflow.

**The Replicator Protocol** — referenced in the harvest protocol as the on-demand assembly of the full taste profile from the Pattern Buffer. Pre-merge, the Pattern Buffer was the set of TASTE-prefixed `thoughts` entries. Post-merge, the Pattern Buffer is the `taste_preferences` table itself, and replication is just a `list_taste_preferences()` call. The Replicator Protocol can be retired or simplified accordingly.

## Migration record

| Migration | Date | Effect |
|---|---|---|
| `20260415000003_ecos_crm_extensions.sql` | 2026-04-15 | Created `taste_preferences` (Branch A) and `taste_evolution`, never wired |
| `20260504120002_taste_preferences_merge.sql` | 2026-05-04 | Added `preference_name`, `reject`, `want`, `type_label`, `thought_id`; relaxed `constraint_type` CHECK; added indexes |
| Backfill script | 2026-05-04 | Promoted 38 of 63 existing `signal_type='taste'` thoughts into `taste_preferences` rows; the 25 remaining are pre-protocol free-form statements that stay in `thoughts` only |
