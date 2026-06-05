// Tool annotation presets — ECBRAIN V1.
// Architecture ref: §4.3. Applied to new ECBRAIN tools in Phases 3–4.
// Some existing tools do not use these yet; apply on the first edit of each tool.

export const READ_ONLY = {
  readOnlyHint:  true,
  openWorldHint: false,
} as const;

export const WRITE_APPEND = {
  readOnlyHint:    false,
  destructiveHint: false, // append-only; no mutation of existing rows
  openWorldHint:   false,
} as const;

export const WRITE_TRANSACTIONAL = {
  readOnlyHint:    false,
  destructiveHint: false, // flips is_current but does not delete rows
  openWorldHint:   false,
} as const;
