import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARTIFACT_HUMAN_EDIT_SUMMARY,
  artifactBlockContentHash,
  artifactHumanEditSummary,
  normalizeArtifactBlockContent,
} from "@/lib/artifact-editor";

describe("artifact editor content normalization", () => {
  it("normalizes browser-submitted CRLF without changing canonical LF content", () => {
    expect(normalizeArtifactBlockContent("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
    expect(artifactBlockContentHash("one\r\ntwo")).toBe(artifactBlockContentHash("one\ntwo"));
  });

  it("uses an audit-safe default when the optional human edit note is blank", () => {
    expect(artifactHumanEditSummary("  Corrected heading  ")).toBe("Corrected heading");
    expect(artifactHumanEditSummary("  ")).toBe(DEFAULT_ARTIFACT_HUMAN_EDIT_SUMMARY);
    expect(artifactHumanEditSummary(null)).toBe(DEFAULT_ARTIFACT_HUMAN_EDIT_SUMMARY);
  });
});
