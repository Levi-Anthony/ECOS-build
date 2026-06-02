// Handoff tools — ECBRAIN V1 event stream and snapshot management.
//
// Tools registered here:
//   list_handoff_events          (read,  READ_ONLY)
//   get_latest_handoff_snapshot  (read,  READ_ONLY)
//   append_handoff_event         (write, WRITE_APPEND)
//   save_handoff_snapshot        (write, WRITE_TRANSACTIONAL)

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY, WRITE_APPEND, WRITE_TRANSACTIONAL } from "../lib/annotations.ts";
import { textResult, errorResult } from "../lib/format.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {

  registrar.registerTool(
    "list_handoff_events",
    {
      title: "List Handoff Events",
      description:
        "Read handoff events with optional filters. " +
        "Pass since_event_seq = prior snapshot watermark_event_seq to retrieve only new events " +
        "since the last snapshot — this is the compilation cursor. " +
        "Results ordered by event_seq ASC (chronological append order).",
      inputSchema: {
        session_id:      z.string().optional().describe("Filter to a specific session"),
        event_type:      z.string().optional()
                           .describe("e.g. open_loop_added | open_loop_resolved | decision | next_action | state_change | block"),
        since:           z.string().optional().describe("ISO timestamp lower bound on occurred_at"),
        until:           z.string().optional().describe("ISO timestamp upper bound on occurred_at"),
        since_event_seq: z.number().int().optional()
                           .describe("Cursor: return events with event_seq > this value (use prior snapshot watermark_event_seq)"),
        limit:           z.number().int().min(1).max(500).optional().default(100),
      },
      annotations: READ_ONLY,
    },
    async ({ session_id, event_type, since, until, since_event_seq, limit }) => {
      try {
        let q = supabase
          .from("handoff_events")
          .select(
            "id, event_seq, session_id, surface, event_type, content, " +
            "refs, metadata, occurred_at, client_ts, created_at"
          )
          .order("event_seq", { ascending: true })
          .limit(limit ?? 100);

        if (session_id !== undefined)      q = q.eq("session_id", session_id);
        if (event_type !== undefined)      q = q.eq("event_type", event_type);
        if (since !== undefined)           q = q.gte("occurred_at", since);
        if (until !== undefined)           q = q.lte("occurred_at", until);
        if (since_event_seq !== undefined) q = q.gt("event_seq", since_event_seq);

        const { data, error } = await q;
        if (error) return errorResult(`list_handoff_events: ${error.message}`);

        return textResult(JSON.stringify({ events: data ?? [] }, null, 2));
      } catch (err: unknown) {
        return errorResult(`list_handoff_events: ${(err as Error).message}`);
      }
    }
  );

  registrar.registerTool(
    "get_latest_handoff_snapshot",
    {
      title: "Get Latest Handoff Snapshot",
      description:
        "Read the current handoff snapshot (is_current = TRUE). " +
        "Returns null when no snapshot exists — client should treat this as a cold start " +
        "and proceed with BRAIN search alone.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const { data, error } = await supabase
          .from("handoff_snapshots")
          .select(
            "id, compiled_at, compiled_by, source_session_id, source_event_ids, " +
            "watermark_event_seq, watermark_occurred_at, content, metadata, " +
            "is_current, artifact_id, client_request_id"
          )
          .eq("is_current", true)
          .maybeSingle();

        if (error) return errorResult(`get_latest_handoff_snapshot: ${error.message}`);

        return textResult(JSON.stringify({ snapshot: data ?? null }, null, 2));
      } catch (err: unknown) {
        return errorResult(`get_latest_handoff_snapshot: ${(err as Error).message}`);
      }
    }
  );

  registrar.registerTool(
    "append_handoff_event",
    {
      title: "Append Handoff Event",
      description:
        "Append one event to the handoff_events stream. Append-only: never updates an " +
        "existing row. event_seq is server-assigned via IDENTITY (monotonic, gaps allowed). " +
        "No embedding is computed — handoff events are operational; semantic recall happens " +
        "on the compiled snapshot, not on individual events. Provide a `client_request_id` " +
        "to make replays idempotent (unique partial index).",
      inputSchema: {
        content: z.string().min(1)
          .describe("Event content. Stored verbatim."),
        event_type: z.string().min(1)
          .describe("Event type, e.g. open_loop_added | open_loop_resolved | decision | next_action | state_change | block."),
        session_id: z.string().optional().default("mcp")
          .describe("Session scope. Defaults to 'mcp' when caller does not supply one."),
        surface: z.string().optional().default("mcp")
          .describe("Originating surface. Defaults to 'mcp'."),
        refs: z.record(z.string(), z.unknown()).optional().default({})
          .describe("Cross-references (e.g. linked thought/contact IDs)."),
        metadata: z.record(z.string(), z.unknown()).optional().default({})
          .describe("Free-form metadata."),
        occurred_at: z.string().datetime().optional()
          .describe("ISO timestamp when the event occurred. Defaults to server now() if omitted."),
        client_ts: z.string().datetime().optional()
          .describe("ISO timestamp from the client clock (audit only)."),
        client_request_id: z.string().optional()
          .describe("Idempotency key. Unique partial index where not null."),
      },
      annotations: WRITE_APPEND,
    },
    async ({ content, event_type, session_id, surface, refs, metadata, occurred_at, client_ts, client_request_id }) => {
      try {
        const row: Record<string, unknown> = {
          session_id: session_id ?? "mcp",
          surface:    surface    ?? "mcp",
          event_type,
          content,
          refs:       refs       ?? {},
          metadata:   metadata   ?? {},
        };
        if (occurred_at)        row.occurred_at = occurred_at;
        if (client_ts)          row.client_ts = client_ts;
        if (client_request_id)  row.client_request_id = client_request_id;

        const { data, error } = await supabase
          .from("handoff_events")
          .insert(row)
          .select("id, event_seq, event_type, session_id, surface, occurred_at, created_at, client_request_id")
          .single();

        if (error) return errorResult(`append_handoff_event: ${error.message}`);
        if (!data)  return errorResult("append_handoff_event: insert returned no row");

        return textResult(JSON.stringify({
          event: {
            id:                data.id,
            event_seq:         data.event_seq,
            event_type:        data.event_type,
            session_id:        data.session_id,
            surface:           data.surface,
            occurred_at:       data.occurred_at,
            created_at:        data.created_at,
            client_request_id: data.client_request_id,
          },
        }, null, 2));
      } catch (err: unknown) {
        return errorResult(`append_handoff_event: ${(err as Error).message}`);
      }
    }
  );

  registrar.registerTool(
    "save_handoff_snapshot",
    {
      title: "Save Handoff Snapshot",
      description:
        "Compile and persist a handoff snapshot. Computes a 1536-d embedding from `content` " +
        "via OpenRouter, then calls public.save_handoff_snapshot_tx which (a) takes a cluster-wide " +
        "advisory lock, (b) flips the prior is_current snapshot to FALSE, and (c) inserts the new " +
        "current snapshot in one transaction. Pass an empty source_event_ids[] to invoke the " +
        "manual-override path: watermark falls back to the prior snapshot's watermark and metadata " +
        "is tagged with a warning. Any unresolved UUID in source_event_ids aborts the entire " +
        "transaction (no rows inserted, prior is_current preserved).",
      inputSchema: {
        content: z.string().min(1)
          .describe("Compiled handoff content. Will be embedded synchronously and stored verbatim."),
        source_event_ids: z.array(z.string().uuid()).optional().default([])
          .describe("UUIDs of handoff_events that contributed to this snapshot. " +
                    "Empty/omitted = manual-override path."),
        session_id: z.string().optional()
          .describe("Optional source_session_id stored on the snapshot for audit."),
        metadata: z.record(z.string(), z.unknown()).optional().default({})
          .describe("Free-form snapshot metadata. Server may merge a {warning} key on the empty path."),
        client_request_id: z.string().optional()
          .describe("Idempotency key for offline replay. Unique partial index on snapshots."),
      },
      annotations: WRITE_TRANSACTIONAL,
    },
    async ({ content, source_event_ids, session_id, metadata, client_request_id }) => {
      try {
        const vec = await helpers.getEmbedding(content);
        if (!Array.isArray(vec) || vec.length !== 1536) {
          return errorResult(
            `save_handoff_snapshot: embedding shape invalid ` +
            `(expected 1536-d array, got ${Array.isArray(vec) ? `length ${vec.length}` : typeof vec})`
          );
        }
        // pgvector accepts the canonical text literal '[v1,v2,...]'. JSON.stringify yields the
        // same shape, but we use join(",") so we never accidentally serialize NaN/Infinity tokens
        // (JSON.stringify would emit `null` for those; vector parser would reject).
        const embeddingLiteral = `[${vec.join(",")}]`;

        const { data, error } = await supabase.rpc("save_handoff_snapshot_tx", {
          p_compiled_by:        "ecb-mcp.save_handoff_snapshot",
          p_source_session_id:  session_id ?? null,
          p_source_event_ids:   source_event_ids ?? [],
          p_content:            content,
          p_embedding:          embeddingLiteral,
          p_metadata:           metadata ?? {},
          p_client_request_id:  client_request_id ?? null,
        });

        if (error) return errorResult(`save_handoff_snapshot: ${error.message}`);

        // RPC declares RETURNS TABLE → supabase-js returns a one-row array.
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return errorResult("save_handoff_snapshot: RPC returned no row");

        const sourceCount = (source_event_ids ?? []).length;

        return textResult(JSON.stringify({
          snapshot: {
            id:                    row.id,
            compiled_at:           row.compiled_at,
            watermark_event_seq:   row.watermark_event_seq,
            watermark_occurred_at: row.watermark_occurred_at,
            is_current:            row.is_current,
            source_event_count:    sourceCount,
            // Server-side: the empty-source path is the only branch that injects a warning.
            metadata_warning_present: sourceCount === 0,
          },
        }, null, 2));
      } catch (err: unknown) {
        return errorResult(`save_handoff_snapshot: ${(err as Error).message}`);
      }
    }
  );

};
