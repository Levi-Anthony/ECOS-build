import { describe, expect, it } from "vitest";
import { artifactOpLabel, currentBlockForOp, proposedContentForOp } from "@/lib/artifact-review";
import type { ArtifactBlock } from "@/lib/supabase";

const block: ArtifactBlock = {
  id: "block-1",
  artifact_id: "artifact-1",
  path: "/overview",
  title: "Overview",
  content: "Current content",
  content_hash: "hash",
  version: 3,
  sort_order: 0,
  metadata: {},
  created_at: "2026-06-04T00:00:00Z",
  updated_at: "2026-06-04T00:00:00Z",
};

describe("artifact proposal review helpers", () => {
  it("finds the current block for normal and rename operations", () => {
    expect(currentBlockForOp({ op: "replace_block", path: "/overview" }, [block])?.id).toBe("block-1");
    expect(currentBlockForOp({ op: "rename_block", from_path: "/overview", to_path: "/summary" }, [block])?.id).toBe("block-1");
  });

  it("previews append and delete semantics", () => {
    expect(proposedContentForOp({ op: "append_block", path: "/overview", content: "Appended" }, block))
      .toBe("Current content\n\nAppended");
    expect(proposedContentForOp({ op: "delete_block", path: "/overview" }, block)).toBeNull();
  });

  it("labels artifact-level governance operations", () => {
    expect(artifactOpLabel({ op: "set_review_policy", review_policy: "human_gate" }))
      .toBe("set review policy: human_gate");
    expect(artifactOpLabel({ op: "set_artifact_status", status: "archived" }))
      .toBe("set lifecycle status: archived");
  });
});
