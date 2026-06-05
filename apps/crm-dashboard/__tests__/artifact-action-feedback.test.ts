import { describe, expect, it } from "vitest";
import {
  acceptedWriteFeedback,
  artifactActionErrorMessage,
  artifactActionFeedbackHref,
  readArtifactActionFeedback,
} from "@/lib/artifact-action-feedback";

describe("artifact action feedback", () => {
  it("round-trips feedback through a result URL", () => {
    const href = artifactActionFeedbackHref("/artifacts/example", {
      result: "success",
      label: "Block edit",
      message: "Saved accepted version 3.",
    });
    const url = new URL(href, "https://example.invalid");

    expect(url.hash).toBe("#action-feedback");
    expect(readArtifactActionFeedback(Object.fromEntries(url.searchParams))).toEqual({
      result: "success",
      label: "Block edit",
      message: "Saved accepted version 3.",
    });
  });

  it("describes durable writes with pending embedding work as warnings", () => {
    expect(acceptedWriteFeedback("Block edit", 4, 1)).toEqual({
      result: "warning",
      label: "Block edit",
      message: "Saved accepted version 4, but embedding regeneration remains pending for 1 changed block.",
    });
  });

  it("turns concurrency and authorization failures into actionable messages", () => {
    expect(artifactActionErrorMessage(new Error("VERSION_CONFLICT: stale")))
      .toContain("changed after the form was opened");
    expect(artifactActionErrorMessage(new Error("HUMAN_AUTHORITY_REQUIRED: no reviewer")))
      .toContain("authorization failed");
    expect(artifactActionErrorMessage(new Error("Human authority path is not configured")))
      .toContain("not configured in this runtime");
  });

  it("does not expose unexpected database errors", () => {
    expect(artifactActionErrorMessage(new Error("secret internal database detail")))
      .toBe("The artifact write failed. No changes were applied.");
  });
});
