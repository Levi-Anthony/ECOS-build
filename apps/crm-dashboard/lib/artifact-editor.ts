import { createHash } from "node:crypto";

export function normalizeArtifactBlockContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function artifactBlockContentHash(content: string): string {
  return createHash("sha256").update(normalizeArtifactBlockContent(content)).digest("hex");
}
