// Response formatting helpers for MCP tool handlers.
// New ECBRAIN tools (Phases 3–4) should use these instead of inline object literals.
// Some existing tools still use inline literals; migrate opportunistically on first edit.

export const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

// Stable error codes agents can branch on (retry vs. re-fetch vs. escalate).
// Keep this list small and meaningful; add a code only when a caller could
// reasonably react to it differently. Freeform errors (no code) remain valid.
export type ErrorCode =
  | "NOT_FOUND"          // target row/key does not exist
  | "VERSION_CONFLICT"   // optimistic-concurrency base_version mismatch — re-fetch the manifest and retry
  | "HASH_CONFLICT"      // expected_hash did not match — re-read the block and retry
  | "MISSING_PATH"       // referenced block path does not exist
  | "PATH_EXISTS"        // create targeted an already-existing path
  | "HUMAN_GATE_BLOCKED" // write was blocked/queued by human-gate authority
  | "VALIDATION"         // input or precondition failed
  | "UPSTREAM";          // dependency (DB/embedding/RPC) failed

// errorResult — the canonical failure return. Pass a `code` when the caller
// could act on the failure programmatically; it is surfaced both in the text
// and as a structured error envelope. Errors are exempt from output-schema
// validation (the SDK skips isError results), so attaching structuredContent
// here is always safe regardless of the tool's outputSchema.
export const errorResult = (text: string, code?: ErrorCode) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
  ...(code ? { structuredContent: { ok: false as const, error: { code, message: text } } } : {}),
});

// structuredResult — the standard success return for any tool that declares an
// `outputSchema`. Returns BOTH machine-readable `structuredContent` (validated
// by the MCP SDK against the tool's outputSchema) AND a human-readable text
// `content` block for back-compat with clients that only read text.
//
// Contract notes (load-bearing — see tools/CONVENTION.md):
//   • `data` MUST be a JSON object (not an array). Wrap lists as { items, count }.
//   • The SDK throws if `data` is missing a required field or has a wrong type.
//     Extra fields are stripped silently, so generous schemas are safe.
//   • Pass the existing human-readable string as `text` so byte-for-byte text
//     output is preserved for prose consumers. If omitted, the JSON is pretty-printed.
//   • Error paths must NOT use this — keep returning errorResult(...) (no
//     structuredContent) so they stay exempt from output-schema validation.
export const structuredResult = (
  data: Record<string, unknown>,
  text?: string,
) => ({
  content: [{ type: "text" as const, text: text ?? JSON.stringify(data, null, 2) }],
  structuredContent: data,
});
