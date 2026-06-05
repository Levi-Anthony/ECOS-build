// Response formatting helpers for MCP tool handlers.
// New ECBRAIN tools (Phases 3–4) should use these instead of inline object literals.
// Some existing tools still use inline literals; migrate opportunistically on first edit.

export const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});

export const errorResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true as const,
});
