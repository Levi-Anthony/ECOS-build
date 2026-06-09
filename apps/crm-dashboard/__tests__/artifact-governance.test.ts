import { describe, expect, it } from "vitest";
import { buildArtifactGovernanceOps } from "@/lib/artifact-governance";

const baseSelection = {
  currentStatus: "active",
  status: "active",
  currentReviewPolicy: "live_audit",
  reviewPolicy: "live_audit",
  currentAuthority: "evidence",
  authority: "evidence",
};

describe("artifact governance patch builder", () => {
  it("returns no ops when governance fields are unchanged", () => {
    expect(buildArtifactGovernanceOps(baseSelection)).toEqual([]);
  });

  it("builds only the changed governance ops in stable order", () => {
    expect(buildArtifactGovernanceOps({
      ...baseSelection,
      status: "draft",
      reviewPolicy: "human_gate",
      authority: "policy",
    })).toEqual([
      { op: "set_artifact_status", status: "draft" },
      { op: "set_review_policy", review_policy: "human_gate" },
      { op: "update_artifact_metadata", metadata_patch: { authority_level: "policy" } },
    ]);
  });

  it("rejects tampered governance values before building write ops", () => {
    expect(() => buildArtifactGovernanceOps({ ...baseSelection, status: "deleted" }))
      .toThrow("BAD_OP: invalid artifact status");
    expect(() => buildArtifactGovernanceOps({ ...baseSelection, reviewPolicy: "auto_publish" }))
      .toThrow("BAD_OP: invalid review policy");
    expect(() => buildArtifactGovernanceOps({ ...baseSelection, authority: "owner" }))
      .toThrow("BAD_OP: invalid authority level");
  });
});
