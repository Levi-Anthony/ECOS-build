# ECB MCP tool authoring convention

Every tool registered through the tracked registrar MUST satisfy this contract.
The meta-test (`../tools.test.ts`) enforces it: a tool listed in
`EXPECTED_FULL_CONTRACT` fails CI unless it has a description, `annotations`, and
`outputSchema`.

## 1. Description — the structured contract template

Write the `description` as a tight block (a few lines, not an essay):

```
<One-sentence purpose — what the tool does, in the imperative.>
Use when: <the trigger/situation>. Not for: <name the adjacent tool to use instead>.
Side effects: <writes / embeddings generated / authority gating — or "none; read only">.
Returns: <one line naming the structuredContent shape>.
```

- Cross-reference sibling tools **by name** in "Not for" so the model can route
  (e.g. "Not for exact-ID lookup — use `get_thought`").
- "Side effects" must call out authority/human-gate behavior for artifact writes.
- The "Returns" line names the envelope (e.g. "`{ items, count }` of contact
  summaries", "`{ ok, id }`", "`{ applied, proposal_id, version }`").

## 2. Annotations — always set one

Pick from `../lib/annotations.ts`:

- `READ_ONLY` — pure reads.
- `WRITE_APPEND` — append-only inserts (no mutation of existing rows).
- `WRITE_TRANSACTIONAL` — updates/flips existing rows (still non-destructive; no hard deletes).

## 3. Output schema — always declare one

- Set `outputSchema` to a **ZodRawShape** (a plain object of validators), the
  same style as `inputSchema`. Reuse `../lib/schemas.ts`: entity schemas plus the
  `listOf(...)`, `writeResult(...)`, and `proposalResult` envelope factories.
- The handler's success path returns `structuredResult(payload, humanText)` from
  `../lib/format.ts`:
  - `payload` is a JSON **object** (wrap collections as `{ items, count }`) that
    satisfies the schema. Missing-required or wrong-type → the SDK throws; extra
    fields are stripped silently, so prefer generous `.nullable()/.optional()`.
  - `humanText` is the existing human-readable string — pass it so prose
    consumers see byte-identical output. Structured content is purely additive.
- **Error paths keep using `errorResult(...)`** (no success `structuredContent`).
  The SDK exempts `isError` results from output-schema validation. Pass a stable
  `ErrorCode` as the second arg when the caller could branch on the failure
  (e.g. `errorResult("…not found", "NOT_FOUND")`, `VERSION_CONFLICT`,
  `HASH_CONFLICT`, `HUMAN_GATE_BLOCKED`). That attaches a structured
  `{ ok:false, error:{ code, message } }` envelope agents can react to.

## 3a. Safety net — the registrar output guard

`createTrackedRegistrar` wraps every handler: if a tool declares an
`outputSchema` and the returned `structuredContent` fails validation, the guard
**strips structuredContent and logs** rather than letting the SDK throw — the
tool degrades to text-only instead of failing in production. This means a
schema that is slightly too strict for real data is self-healing, not an outage.
Still aim for correct schemas; the guard is a backstop, not a license to guess.

## 4. Per-field input contract

Carry per-argument constraints in `.describe()` on each input field (allowed
values, units, formats, defaults). This is the input half of the contract.

## 5. Rollout

Conversion proceeds in waves; `EXPECTED_FULL_CONTRACT` in the meta-test grows as
each wave lands. Pilot wave: `contacts`, `thoughts`, `artifacts`. Remaining waves
documented in the plan (boot/handoff/pulse; observations/brain-bridge/briefing/
opportunities; billing/entities/taste). Do not change `EXPECTED_TOOL_COUNT` in
`index.ts` — this work changes definitions, not the tool count.
