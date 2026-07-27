# Increment 1 Review Response

Status: patched and locally verified

## Findings resolved

- Shape is now a runtime-backed `propose_shape` action. The provider output is
  validated, the runtime restores the governed Purpose handle, and the proposal
  must be persisted before `accept_shape` can install it.
- `sense_answered` and `field_reflected` are separate events with separate
  actors and perspectives. One request can persist both atomically.
- Installation authority belongs to the action: `accept_shape` installs the
  persisted proposal; `correct_shape` only creates a revised proposal. The
  obsolete `install` wire property is rejected.
- Session retrieval, active-session lookup, and midstream resume are implemented.
- The RPC catches concurrent unique violations and returns the winning request
  as an idempotent replay.
- Non-closing writes preserve `closed_at`.
- Completed, released, and abandoned sessions reject implicit reopening.
- The sequence-allocation row lock is documented beside the load-bearing query.
- The unused `version` column was removed.
- Configuration is validated at module load.
- Shared-secret comparison uses equal-length SHA-256 digests and a constant-work
  byte comparison.
- Client errors are bounded; unknown, provider, database, and configuration
  details are not returned to the client.
- Access documentation now distinguishes enabled RLS from the actual grant rail;
  `service_role` bypasses RLS.

## Evidence

- Clean local database reset applied the migration successfully.
- 14 Deno tests passed.
- 15 pgTAP persistence/security assertions passed.
- Concurrent identical requests produced two HTTP 200 responses, one write, one
  replay, one session, and one event.
- Supabase database lint reported no schema errors.
- Deno type-check, formatting, and `git diff --check` passed.

## Still pending reality

- Dedicated remote Supabase project and secret configuration
- Remote migration, grant, and function deployment verification
- Real Shape-provider behavior with the selected model
- Direct HTTP scenario transcripts
- Shortcut and Action Button installation
- Controlled and real field tests
- Review packet and falsifier assessment

## Accountability

- Linear `ECO-70` now tracks the Spike 1 reality-integration work under parent
  Human Rail outcome `ECO-61`.
- Local implementation lives on Git branch `codex/eco-70-ssmm-spike-1`.
- This review does not claim product success. It establishes local
  implementation evidence and leaves the remote, Shortcut, and field gates
  visibly open.
