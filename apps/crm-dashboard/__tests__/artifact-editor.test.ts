import { describe, expect, it } from "vitest";
import { artifactBlockContentHash, normalizeArtifactBlockContent } from "@/lib/artifact-editor";

describe("artifact editor content normalization", () => {
  it("normalizes browser-submitted CRLF without changing canonical LF content", () => {
    expect(normalizeArtifactBlockContent("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
    expect(artifactBlockContentHash("one\r\ntwo")).toBe(artifactBlockContentHash("one\ntwo"));
  });
});
