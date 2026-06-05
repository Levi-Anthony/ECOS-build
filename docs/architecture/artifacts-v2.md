# Artifact v2/v3 — Patch-Based Canonical Artifacts + Human Door

*Storage-engine refactor of the canonical-artifact lane inside ecb-mcp. Migration
`20260602100000_artifacts_v2.sql`; Artifact v3 human-door extension in
`20260605010000_artifact_v3_human_door.sql`; tools in
`supabase/functions/ecb-mcp/tools/artifacts.ts`.*

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
| `artifacts` | stable identity (`key`), `title`, `kind`, lifecycle `status`, `review_policy`, `current_version`, `metadata` |
| `artifact_blocks` | current materialized blocks, addressable by `path`, each with a `content_hash` |
| `artifact_revisions` | immutable append-only ledger — one row per patch (the audit trail) |
| `artifact_snapshots` | compiled full-document view + exact ordered block state for every accepted version |
| `artifact_block_embeddings` | one (or chunked, for >8k blocks) embedding per block for search |
| `artifact_change_proposals` | pending agent patches waiting for explicit human review |
| `artifact_review_events` | append-only proposal/review/provenance event trail |

The canonical current state is `artifact_blocks`; history is `artifact_revisions`; the full-document
view is a compiled `artifact_snapshot`.

**Governance is authority-sensitive hybrid.**

- `live_audit`: ordinary evidence, tracker, handoff, and document patches apply live and produce a
  revision + exact snapshot.
- `human_gate`: agent patches become proposals and do not change current blocks or embeddings until
  explicitly approved.
- Agent authority/lifecycle/review-policy changes are always proposed, regardless of artifact policy.
- Human dashboard edits apply directly as new accepted versions only through an allowlisted Supabase
  Auth principal, with database-derived actor identity and change reason.
- Full-body replacement remains an admin/import/repair path and is routed to review for human-gated
  artifacts.

Agent-created policy, instruction, prompt, SOP, protocol, and boot-tagged artifacts begin as
human-gated drafts. Requested `approved_instruction` or `policy` authority is downgraded to
`proposed_instruction` until human promotion.

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

For `human_gate` artifacts or authority-sensitive operations, step 5 returns a proposal ID rather
than a new version. The patch has not applied until a human reviews it.

### Patch operations

| op | required | notes |
|---|---|---|
| `create_block` | `path`, `content` | fails if `path` exists; `title`/`sort_order`/`metadata` optional |
| `replace_block` | `path`, `content` | `expected_hash` strongly recommended; fails if block missing |
| `append_block` | `path`, `content` | inserts `\n\n` separator; `create_if_missing` optional; for logs |
| `delete_block` | `path`, `expected_hash` | **soft delete** — archives the block (`metadata.status=archived`), content retained |
| `rename_block` | `from_path`, `to_path`, `expected_hash` | fails if `to_path` exists |
| `update_block_metadata` | `path`, `metadata_patch` | no content change → no embedding regeneration |

Artifact-level operations are `update_artifact_metadata`, `set_artifact_status`, and
`set_review_policy`. Operations are discriminated and validated inside SQL before mutation.
Unknown operation names/fields, malformed paths, wrong JSON value types, and missing required
fields fail closed. Existing-block writes require `expected_hash` unless the private import/repair
path is used.

### Lifecycle transition matrix

| From | Allowed destinations |
|---|---|
| `draft` | `active`, `archived` |
| `active` | `draft`, `archived`, `superseded` |
| `archived` | `draft`, `active` |
| `superseded` | `archived` |

No-op transitions are allowed. Every lifecycle transition requires authenticated human authority.

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
`reindex_artifact_embeddings`, `propose_artifact_patch`, `list_artifact_change_proposals`,
`get_artifact_change_proposal`.

Retired tools remain retired: `approve_artifact`, `update_artifact`, and shared-key
`review_artifact_change`. Artifact v3 review approves a specific optimistic-locked patch proposal,
not a mutable whole-document draft.

## Human door

The existing CRM dashboard is the governed human surface:

- `/artifacts` — browse/search/filter by lifecycle, authority, and review policy.
- `/artifacts/:key` — document/block view, direct human block edits, and human authority/lifecycle
  controls.
- `/artifacts/review` — pending/conflicted/resolved proposal inbox.
- `/artifacts/review/:id` — current-versus-proposed diff, approve, edit-and-approve, reject,
  request-revision, and supersede actions.

Dashboard writes are server-only. Accepted writes remove stale vectors immediately and request
changed-block reindexing through ecb-mcp. Configure `ECB_URL` + `ECB_KEY` in the dashboard runtime
so human edits regenerate embeddings immediately.

The mutation boundary is database-owned:

- `apply_artifact_patch` is private and executable by no application role.
- `apply_artifact_agent_patch_tx` is the service-role path. It rejects `human_gate` artifacts and
  all authority/lifecycle/review-policy operations.
- `apply_artifact_human_patch_tx` and `review_artifact_change_tx` are executable only by
  `authenticated`; both derive identity from `auth.uid()` plus an active
  `artifact_human_authorities` row.
- `service_role` has read access but no direct insert/update/delete privilege on canonical artifact,
  revision, snapshot, proposal, or review-event state.
- The shared-key MCP exposes proposal submission and review reads, but no approval/review tool.

The dashboard authenticates its human write path with server-only `SUPABASE_ANON_KEY`,
`HUMAN_AUTH_EMAIL`, and `HUMAN_AUTH_PASSWORD`. The Supabase Auth user must be explicitly mapped to
a stable audit identity in `artifact_human_authorities`. `SITE_PASSWORD` remains the coarse site
gate; it is not reviewer identity.

## Version reconstruction

Every accepted v3 create or patch writes an `artifact_snapshots` row containing the compiled
document and exact ordered `block_state`. The v3 migration creates one exact baseline for each
artifact's then-current version. Older v2 snapshots remain readable compiled views but are marked
`reconstructable=false` when exact historical block state was never captured.

## Migration notes

Deploy in order: apply the Artifact v3 migration, deploy `ecb-mcp`, then deploy the dashboard. The
new dashboard routes query `review_policy` and proposal tables and will report schema-cache errors
until the migration is present.

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

`supabase/tests/artifact_v3_human_door.sql` proves direct service-role apply/review/table writes
cannot approve or bypass gated changes and an allowlisted authenticated human can approve with
database-derived identity. `scripts/ecb-artifacts-v2-verify.py` drives the deployed MCP through the
v2 patch-engine acceptance tests plus v3 reconstructable-snapshot, human-gate routing, and no-MCP-
review-authority tests. Run both locally/CI first, then run the harness against **staging**
(`ECB_URL` + `ECB_KEY`) before requesting production approval.
