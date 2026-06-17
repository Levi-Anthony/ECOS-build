{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 # ECBRAIN v3.1 Implementation Errata\
\
This is a precision patch to `ECBRAIN Vault Migration Architecture v3` and the `ECBRAIN V1 Implementation Work Order`.\
\
It does not reopen architecture. It only resolves implementation footguns.\
\
## 1. event_seq is monotonic, not gap-free\
\
Wherever v3 says `event_seq` is gap-free, replace that with:\
\
`event_seq` is a server-assigned monotonic cursor. Gaps are allowed and expected. Do not rely on contiguous values. Snapshot compilation uses `event_seq > watermark_event_seq`, not gap-free assumptions.\
\
## 2. Embeddings are synchronous before database writes\
\
Replace \'93embeddings happen inside the MCP tool transaction\'94 with:\
\
Embedding-bearing writes compute embeddings synchronously before the database insert or database transaction. If embedding fails, no database write is attempted.\
\
For `log_pulse`:\
\
compute embedding \uc0\u8594  insert pulse row\
\
For `save_handoff_snapshot`:\
\
compute embedding \uc0\u8594  call transactional SQL RPC\
\
## 3. save_handoff_snapshot must use a SQL RPC transaction\
\
Do not implement multi-statement transaction logic through separate Supabase client calls.\
\
Implementation pattern:\
\
1. TypeScript computes the snapshot embedding.\
2. TypeScript calls a Postgres RPC function, e.g. `save_handoff_snapshot_tx`.\
3. The RPC performs the transactional database work:\
   - acquire advisory lock\
   - compute watermark\
   - flip previous current snapshot to false\
   - insert new current snapshot\
   - return inserted row\
\
The advisory lock lives inside the SQL function:\
\
`SELECT pg_advisory_xact_lock(hashtext('ecbrain.handoff_snapshot_save'));`\
\
## 4. Add migration for save_handoff_snapshot_tx\
\
Add a SQL migration creating a transactional RPC function accepting:\
\
- `p_compiled_by text`\
- `p_source_session_id text`\
- `p_source_event_ids uuid[]`\
- `p_content text`\
- `p_embedding vector(1536)`\
- `p_metadata jsonb`\
\
It returns:\
\
- `id`\
- `compiled_at`\
- `watermark_event_seq`\
- `watermark_occurred_at`\
- `is_current`\
\
## 5. Add client_request_id unless there is a strong reason not to\
\
Recommended V1 addition:\
\
Add nullable `client_request_id text` to:\
\
- `pulse_entries`\
- `handoff_events`\
- `handoff_snapshots`\
\
Add unique partial indexes:\
\
- unique `client_request_id` where not null\
\
Purpose: make offline outbox replay and retry-after-uncertain-network safer.\
\
If implementation chooses not to add this in V1, explicitly document that V1 accepts possible duplicate append events during replay and that dedupe is deferred.\
\
## 6. Make boot_artifacts filter explicit after Phase 0\
\
Do not leave \'93metadata flag boot:true or whatever convention exists\'94 unresolved during implementation.\
\
Phase 0 must inspect the actual `artifacts` metadata shape and report the exact filter to use for boot artifacts before implementing `get_boot_context`.\
\
## 7. Branch wording\
\
If Supabase branching is unavailable, use a staging Supabase project or local Supabase dev instance. Do not apply migrations to production during verification.}