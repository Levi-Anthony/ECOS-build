import { createHash } from "node:crypto";

export const DEFAULT_ARTIFACT_HUMAN_EDIT_SUMMARY = "Direct human block edit";

export function normalizeArtifactBlockContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function artifactBlockContentHash(content: string): string {
  return createHash("sha256").update(normalizeArtifactBlockContent(content)).digest("hex");
}

export function artifactHumanEditSummary(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : DEFAULT_ARTIFACT_HUMAN_EDIT_SUMMARY;
}
