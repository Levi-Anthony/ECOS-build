# ECBRAIN V1 — Architecture

A plain-language reference. The goal here is to keep the *responsibilities*
clear so future changes route to the right place without re-litigating
shape decisions.

---

## Base: the Open Brain pattern

The Open Brain pattern, as designed by Nate B. Jones, is:

- A Supabase project as the storage substrate.
- pgvector for semantic retrieval.
- A single MCP Edge Function as the agent door.
- Embeddings computed at write time and stored alongside content.

Open Brain is the memory substrate: store and retrieve. Everything that
uses memory to *do something else* is application logic on top.

## ECBRAIN extension model

ECBRAIN sits on top of Open Brain inside the same Supabase project and
the same MCP function. It does not introduce a new server. It adds:

- Tables for responsibilities Open Brain did not house (pulse stream,
  handoff event stream, compiled handoff snapshots).
- Tools that read and write those tables.
- A small library layer in the Edge Function for embedding,
  formatting, and target-environment helpers.

The extension model means: when a new responsibility appears, the
question is "what storage shape does this responsibility want?"
Not "which existing table can we squeeze it into?"

## Source of truth

The MCP function is the agent door. The database is the substrate.
Neither is the canonical source of truth on its own:

- **Database state** is what is materially true right now. It can be
  inspected and is authoritative for "does this row exist."
- **Source code state** is what the function will do on its next run.
  It is authoritative for "what behavior is currently deployed,"
  *only after* a successful deploy.

Database state and source code state can disagree. A migration in the
repo that has not been applied is a source-code change with no
database effect. A function commit that has not been deployed is
source-code change with no behavioral effect.

## Database state vs source code state

| Concept              | Lives in       | Becomes real via         |
|----------------------|----------------|--------------------------|
| Schema, tables, RPCs | Database       | Migration apply          |
| Tool behavior        | Edge Function  | Deploy                   |
| Tool surface         | Edge Function  | Deploy + connector reload |

Changing the migration file does not change the database. Changing
function code does not change runtime behavior. A `git commit` is
neither of those events. Treat commit messages as a record, not as
proof of state.

## MCP tool surface vs database schema

These are two different surfaces:

- **Database schema** — the set of tables, columns, indexes, and RPCs.
- **MCP tool surface** — the set of named tools the function exposes.

A tool may read or write any subset of the schema. The tool surface
can grow without schema changes (new behavior on existing tables) and
the schema can grow without tool changes (new tables not yet wired up).
"How many tools" and "how many tables" are independent questions.

## Storage-shape model

| Responsibility                  | Shape                | Why                                          |
|---------------------------------|----------------------|----------------------------------------------|
| Low-churn canonical documents   | `canonical_artifacts`| Versioned, approvable, retrievable by tag    |
| Operational pulse stream        | `pulse_entries`      | High-churn append; per-row, time-ordered     |
| Append-only handoff event log   | `handoff_events`     | Monotonic event_seq cursor, gaps allowed     |
| Compiled current handoff state  | `handoff_snapshots`  | One current row at a time; transactional flip |
| BOOT context                    | derived              | Computed at boot from tools and tagged artifacts |
| ORIENT                          | derived              | Computed on demand                           |

Use `canonical_artifacts`. There is no `artifacts` table.

Boot artifacts are selected with the convention:

```
tags && ARRAY['boot']
```

There is no `metadata` column on `canonical_artifacts`; tags carry the
selection signal.

## BOOT and ORIENT

BOOT and ORIENT are *derived* views of state, not stored documents.

- **BOOT** is computed at session start by `get_boot_context`. It draws
  from boot-tagged canonical artifacts plus recent pulse, handoff
  events, and the current handoff snapshot.
- **ORIENT** is computed on demand. It is short-lived and visible to
  the operator; it does not need a permanent home in the database.

Treating these as derived means they cannot drift from the underlying
state. There is no "ORIENT row" to fall behind.

## Auth model

| Form                | Where it travels                    | Use                              |
|---------------------|-------------------------------------|----------------------------------|
| `x-brain-key` header | Request header                     | Preferred wherever supported     |
| `?key=` query string | URL query                          | Fallback only; secret-bearing    |

Headers are preferred. Query-string keys are still secret-bearing —
the URL itself is then secret. Treat any URL containing `?key=` as
sensitive: do not log it, do not paste it into chat, do not share it
in screenshots.

## Embeddings

- Model: `openai/text-embedding-3-small`.
- Dimensions: 1536.
- Computed in TypeScript before the database write.
- Stored as `extensions.vector(1536)` in the database.
- Indexed with HNSW for cosine similarity using
  `extensions.vector_cosine_ops`.

Schema-qualifying the pgvector type and operator class is required.
pgvector is installed in the `extensions` schema. Without
qualification, migrations fail or behave inconsistently depending on
the search path. RC1 failed for exactly this reason.

## Why `pulse_log` became `pulse_log_legacy`

The pre-existing `pulse_log` table was empty and life-engine-shaped —
a different schema for a different purpose than the operational pulse
stream ECBRAIN needed. Reusing the name would have implied continuity
that does not exist. Two options:

1. Drop `pulse_log` and create `pulse_entries`.
2. Rename `pulse_log` to `pulse_log_legacy` and create `pulse_entries`.

We took option 2. Renaming preserves the empty legacy state as a
visible artifact — anyone inspecting the schema can see the rename
and follow the trail. Dropping would have erased that history.
The cost is one extra table sitting empty; the benefit is provenance.
