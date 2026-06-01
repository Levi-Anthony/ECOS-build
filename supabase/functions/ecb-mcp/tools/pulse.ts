// Pulse tools — ECBRAIN V1 in-session state capture.
//
// Tools registered here:
//   list_recent_pulse  (read,  READ_ONLY)
//   log_pulse          (write, WRITE_APPEND)

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY, WRITE_APPEND } from "../lib/annotations.ts";
import { textResult, errorResult } from "../lib/format.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {

  registrar.registerTool(
    "list_recent_pulse",
    {
      title: "List Recent Pulse",
      description:
        "Read the last N pulse entries ordered by occurred_at DESC. " +
        "Use to review recent in-session state at boot or for context. " +
        "Filter by session_id or surface to scope to one device/session.",
      inputSchema: {
        limit:      z.number().int().min(1).max(100).optional().default(20)
                      .describe("Max entries to return (default 20)"),
        session_id: z.string().optional().describe("Filter to a specific session UUID"),
        surface:    z.string().optional().describe("Filter by surface: desktop | mobile | shortcut | cron"),
        since:      z.string().optional().describe("ISO timestamp — only entries at or after this time"),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, session_id, surface, since }) => {
      try {
        let q = supabase
          .from("pulse_entries")
          .select(
            "id, session_id, surface, pulse_type, content, metadata, " +
            "occurred_at, client_ts, created_at, client_request_id"
          )
          .order("occurred_at", { ascending: false })
          .limit(limit ?? 20);

        if (session_id) q = q.eq("session_id", session_id);
        if (surface)    q = q.eq("surface", surface);
        if (since)      q = q.gte("occurred_at", since);

        const { data, error } = await q;
        if (error) return errorResult(`list_recent_pulse: ${error.message}`);

        return textResult(JSON.stringify({ entries: data ?? [] }, null, 2));
      } catch (err: unknown) {
        return errorResult(`list_recent_pulse: ${(err as Error).message}`);
      }
    }
  );

  registrar.registerTool(
    "log_pulse",
    {
      title: "Log Pulse",
      description:
        "Append an in-session pulse entry. Computes a 1536-d embedding from `content` " +
        "synchronously via OpenRouter; on embedding failure no row is inserted (synchronous " +
        "embedding policy, embedding column is NOT NULL). Append-only: never updates an " +
        "existing row. Provide a `client_request_id` to make replays idempotent (unique " +
        "partial index).",
      inputSchema: {
        content: z.string().min(1)
          .describe("Pulse content. Will be embedded and stored verbatim."),
        pulse_type: z.string().min(1)
          .describe("Pulse classification, e.g. state | observation | block | next_action."),
        session_id: z.string().optional().default("mcp")
          .describe("Session scope. Defaults to 'mcp' when caller does not supply one."),
        surface: z.string().optional().default("mcp")
          .describe("Originating surface. Defaults to 'mcp' (call came through this gateway)."),
        metadata: z.record(z.string(), z.unknown()).optional().default({})
          .describe("Free-form metadata."),
        occurred_at: z.string().datetime().optional()
          .describe("ISO timestamp when the pulse occurred. Defaults to server now() if omitted."),
        client_ts: z.string().datetime().optional()
          .describe("ISO timestamp from the client clock (audit only)."),
        client_request_id: z.string().optional()
          .describe("Idempotency key. Unique partial index where not null."),
      },
      annotations: WRITE_APPEND,
    },
    async ({ content, pulse_type, session_id, surface, metadata, occurred_at, client_ts, client_request_id }) => {
      try {
        const vec = await helpers.getEmbedding(content);
        if (!Array.isArray(vec) || vec.length !== 1536) {
          return errorResult(
            `log_pulse: embedding shape invalid ` +
            `(expected 1536-d array, got ${Array.isArray(vec) ? `length ${vec.length}` : typeof vec})`
          );
        }
        const embeddingLiteral = `[${vec.join(",")}]`;

        const row: Record<string, unknown> = {
          session_id: session_id ?? "mcp",
          surface:    surface    ?? "mcp",
          pulse_type,
          content,
          embedding:  embeddingLiteral,
          metadata:   metadata   ?? {},
        };
        if (occurred_at)        row.occurred_at = occurred_at;
        if (client_ts)          row.client_ts = client_ts;
        if (client_request_id)  row.client_request_id = client_request_id;

        const { data, error } = await supabase
          .from("pulse_entries")
          .insert(row)
          .select("id, session_id, surface, pulse_type, occurred_at, created_at, client_request_id")
          .single();

        if (error) return errorResult(`log_pulse: ${error.message}`);
        if (!data)  return errorResult("log_pulse: insert returned no row");

        return textResult(JSON.stringify({
          pulse: {
            id:                  data.id,
            session_id:          data.session_id,
            surface:             data.surface,
            pulse_type:          data.pulse_type,
            occurred_at:         data.occurred_at,
            created_at:          data.created_at,
            client_request_id:   data.client_request_id,
            embedding_dimension: 1536,
          },
        }, null, 2));
      } catch (err: unknown) {
        return errorResult(`log_pulse: ${(err as Error).message}`);
      }
    }
  );

};
