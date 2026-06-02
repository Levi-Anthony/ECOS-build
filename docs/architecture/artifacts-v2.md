# Artifact v2 — Patch-Based Canonical Artifacts

*Storage-engine refactor of the canonical-artifact lane inside ecb-mcp. Migration
`20260602100000_artifacts_v2.sql`; tools in `supabase/functions/ecb-mcp/tools/artifacts.ts`.*

## What problem it solves

The v1 engine versioned documents by **whole-body replacement** (`update_artifact(id, full_body)`):
every edit re-emitted the entire body, re-chunked/re-embedded the whole document, and risked the
model corrupting or accidentally rewriting unchanged sections. There was no concurrency protection
and no event history. That is wrong for the documents we actually maintain — active strategy/
situation trackers, living decision logs, project operating docs.

Artifact v2 makes artifacts **durable, addressable, versioned reference objects** edited by
**block-level patches** with optimistic concurrency, an immutable revision ledger, compiled
snapshots, and block-level semantic search.

## Artifact vs Thought

- **Thoughts** = atomic memory (one capture, one idea). Use the `*_thought*` tools.
- **Artifacts** = structured, evolving state with addressable sections. Use the artifact tools.

If you're appending a single observation, that's a thought. If you're maintaining a document whose
sections change over time, that's an artifact.

## Data model

| Table | Role |
|---|---|
| `artifacts` | stable identity (`key`), `title`, `kind`, `status`, `current_version`, `metadata` |
| `artifact_blocks` | current materialized blocks, addressable by `path`, each with a `content_hash` |
| `artifact_revisions` | immutable append-only ledger — one row per patch (the audit trail) |
| `artifact_snapshots` | compiled full-document checkpoints at a version |
| `artifact_block_embeddings` | one (or chunked, for >8k blocks) embedding per block for search |

The canonical current state is `artifact_blocks`; history is `artifact_revisions`; the full-document
view is a compiled `artifact_snapshot`.

**Governance is audit-only.** A patch applies live and is recorded as one immutable revision. There
is no draft/approve gate (the v1 `approve_artifact` flow is retired). The only gated operation is
full-body replacement (`replace_artifact_body`), which requires an explicit `mode`.

## Block paths

Blocks are addressed by path, e.g.:

```
/overview        /current_state     /objectives        /stakeholders
/risks           /risks/legal       /next_actions      /decision_log
/event_log       /unresolved_questions                 /source_references
```

### `strategy_tracker` template

When creating an active situation tracker (`kind: "strategy_tracker"`), seed these blocks:
`/overview, /current_state, /objectives, /stakeholders, /risks, /constraints, /assumptions,
/next_actions, /decision_log, /event_log, /unresolved_questions, /source_references`.

Conventions:
- `/event_log` and `/decision_log` are **append-mostly** (use `append_block`).
- `/current_state` is **replaceable synthesis** (use `replace_block`).
- Never mix raw event history and current synthesis without labeling them.
- Keep dates concrete, assumptions and unresolved questions explicit, and put links/refs in
  `/source_references` — not huge pasted sources.

## Normal agent workflow

> **Do not rewrite the whole body for normal updates. Use: manifest → block read → patch.**

1. `search_artifacts` or `list_artifacts` to find the artifact.
2. `get_artifact_manifest(key)` — identity, `current_version`, and the block index with hashes. No
   bodies.
3. `get_artifact_block(key, paths)` — exact content + `content_hash` for the blocks you'll touch.
4. Build patch ops. Include `base_version` (= the manifest's `current_version`) and, for each
   existing block you touch, its `expected_hash`.
5. `patch_artifact(...)`.
6. Report `changed_paths` and the new version.

### Patch operations

| op | required | notes |
|---|---|---|
| `create_block` | `path`, `content` | fails if `path` exists; `title`/`sort_order`/`metadata` optional |
| `replace_block` | `path`, `content` | `expected_hash` strongly recommended; fails if block missing |
| `append_block` | `path`, `content` | inserts `\n\n` separator; `create_if_missing` optional; for logs |
| `delete_block` | `path`, `expected_hash` | **soft delete** — archives the block (`metadata.status=archived`), content retained |
| `rename_block` | `from_path`, `to_path`, `expected_hash` | fails if `to_path` exists |
| `update_block_metadata` | `path`, `metadata_patch` | no content change → no embedding regeneration |

### Example patch payload

```json
{
  "key": "ttc_governance_strategy",
  "base_version": 17,
  "summary": "Added Jane's bylaws timing concern and updated current risk posture.",
  "ops": [
    { "op": "replace_block", "path": "/current_state",
      "expected_hash": "<hash from manifest/block read>",
      "content": "Current state as of 2026-06-01: ..." },
    { "op": "append_block", "path": "/decision_log",
      "expected_hash": "<hash>",
      "content": "2026-06-01 — Decision: separate legal verification from board-facing strategy." }
  ],
  "create_snapshot": false
}
```

## Concurrency & conflicts

Two layers of optimistic locking, both enforced atomically inside the `apply_artifact_patch` RPC
(`SELECT ... FOR UPDATE` on the artifact row). Any failing op rolls back the whole patch — **there is
never a partial patch.**

- **Version conflict** — `base_version` ≠ the artifact's `current_version`:
  *"Patch rejected: artifact `x` is at version 18, but patch was based on version 17. Fetch the
  manifest again and retry."*
- **Hash conflict** — a touched block's `expected_hash` ≠ its current hash:
  *"Patch rejected: block `/current_state` changed since it was read. Expected hash abc… but found
  def…"*
- **Missing path / path exists** — addressed block doesn't exist (or already does for `create_block`).

`content_hash` is SHA-256 of the exact stored content, computed identically in SQL
(`encode(digest(content,'sha256'),'hex')`) and TypeScript (`crypto.subtle`), so manifest hashes and
patch checks always agree.

## Tools

`create_artifact`, `get_artifact_manifest`, `get_artifact_block`, `patch_artifact`,
`search_artifacts`, `checkpoint_artifact`, `get_artifact_snapshot`, `get_artifact` (compat read),
`list_artifacts`, `link_artifact`, `replace_artifact_body` (admin/import only),
`reindex_artifact_embeddings`.

Retired in v2: `approve_artifact` (audit-only governance), `update_artifact` (→ `replace_artifact_body`).

## Migration notes

The v1 tables (`canonical_artifacts` / `artifact_versions` / `artifact_chunks` / `artifact_links` /
`match_artifact_chunks`) are **retained read-only** for rollback — not dropped. The migration:

- Backfills each `canonical_artifacts` row into `artifacts`, **reusing the legacy `id`** as
  `artifacts.id` so `artifact_links` and all provenance still resolve. The `artifact_links` FK is
  re-pointed to `artifacts(id)` (valid because ids are shared; required so new v2 artifacts can be
  linked).
- Is **lossless before clever**: the full old body goes into a single `/body` block + a v1 snapshot.
  Legacy fields (`doc_type`, `authority_level`, `scope`, `domain`, `tags`, `summary`) are preserved
  in `artifacts.metadata`.

**Retrieval caveat:** migrated artifacts initially search as one large `/body` block. Block-level
search becomes precise only after sectioning. Use the optional, explicit, human-reviewed
`split_artifact_body_into_blocks` admin step (future) to break `/body` into heading blocks — never
automatically during migration.

After deploy, run `reindex_artifact_embeddings` (no args) once to eager-embed all migrated `/body`
blocks.

## Troubleshooting

- **`search_artifacts` returns nothing for a known artifact** → its blocks may be unembedded
  (just-migrated). Run `reindex_artifact_embeddings(key=…)`.
- **Patch keeps getting version-conflicted** → another writer advanced the artifact; re-fetch the
  manifest for the new `current_version` and the fresh hashes, then retry.
- **`embedding_warnings` in a patch result** → the patch committed (it's durable) but some block
  embeddings failed (e.g. OpenRouter hiccup). Re-run `reindex_artifact_embeddings` for those paths.
- **Need the whole document** → `get_artifact_snapshot(key)` (latest/compiled) or
  `checkpoint_artifact(key)` to store a fresh snapshot.

## Verification

`scripts/ecb-artifacts-v2-verify.py` drives the deployed MCP through all 10 acceptance tests
(create → manifest → block read → safe patch → stale/hash rejections → append → snapshot → search →
migration safety). Run it against **staging** (`ECB_URL` + `ECB_KEY`) before requesting prod approval.
