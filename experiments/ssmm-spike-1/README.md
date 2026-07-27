# SSMM Spike 1

Status: provisional execution surface

This directory installs the first testable SSMM vertical slice without changing
the live ECB substrate or ratifying a final SSMM ontology.

Accountability:

- Linear: `ECO-70`, child of the Human Rail outcome `ECO-61`
- Project: Crucible
- Git branch: `codex/eco-70-ssmm-spike-1`
- Authority: Linear coordinates the work; Git holds implementation evidence;
  ECB holds continuity. The supplied SSMM document suite governs the spike
  pending integration with reality.

The selected path is:

`Action Button → Sense → reflection/correction → Shape/correction → explicit
loop installation → first move → return → consequence/closure`

The current local increment contains:

- the frozen path card;
- explicit request, response, loop, and handle contracts;
- a migration for a session projection plus append-only events;
- a transactional write function with atomic retry handling;
- authority-separated events for Levi's reports and runtime proposals;
- runtime-backed Shape proposal and correction;
- persisted session retrieval and active-session lookup;
- a provisional state machine with action-owned installation authority;
- pure state and contract tests;
- database tests ready to run against the dedicated project.

No deployment has been performed. A new Supabase project must be linked before
applying the migration. Do not link this directory to the existing ECB project.

## Local verification

```sh
deno test supabase/functions/ssmm-runtime --allow-env
deno check supabase/functions/ssmm-runtime/index.ts
supabase test db
node tests/concurrent-idempotency.mjs
```

Pure tests do not establish database behavior. The pgTAP and concurrency tests
require the isolated local stack or dedicated project.

## Deployment gate

Before deployment:

1. Create or identify the dedicated Spike 1 Supabase project.
2. Copy `.env.example` to a local secret-bearing environment file outside git.
3. Apply `supabase/migrations/202607260001_ssmm_spike1_runtime.sql`.
4. Verify RLS is enabled and that grants—not the inert service-role policies—
   deny `anon` and `authenticated` while allowing `service_role`.
5. Run the persistence SQL tests, including retry, event order, terminal-state,
   and `closed_at` behavior.
6. Deploy `ssmm-runtime`.
7. Run direct HTTP tests before building the Shortcut.
