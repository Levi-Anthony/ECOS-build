import { describe, expect, it } from "vitest";
import {
  artifactKeyForReviewedProposal,
  type ArtifactReviewResolutionClient,
} from "@/lib/artifact-review-resolution";

type Call = {
  table: string;
  columns: string;
  column: string;
  value: string;
};

const fakeClient = (
  rows: Record<string, Record<string, unknown>>,
): ArtifactReviewResolutionClient & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            calls.push({ table, columns, column, value });
            return { data: rows[`${table}:${column}:${value}`] ?? null };
          },
        }),
      }),
    }),
  };
};

describe("artifact review resolution", () => {
  it("resolves the artifact key directly from an applied patch artifact id", async () => {
    const client = fakeClient({
      "artifacts:id:artifact-1": { key: "artifact_key" },
    });

    await expect(artifactKeyForReviewedProposal(client, "proposal-1", "artifact-1"))
      .resolves.toBe("artifact_key");
    expect(client.calls).toEqual([
      { table: "artifacts", columns: "key", column: "id", value: "artifact-1" },
    ]);
  });

  it("falls back through the proposal row when no patch artifact id is returned", async () => {
    const client = fakeClient({
      "artifact_change_proposals:id:proposal-1": { artifact_id: "artifact-1" },
      "artifacts:id:artifact-1": { key: "artifact_key" },
    });

    await expect(artifactKeyForReviewedProposal(client, "proposal-1", null))
      .resolves.toBe("artifact_key");
    expect(client.calls).toEqual([
      { table: "artifact_change_proposals", columns: "artifact_id", column: "id", value: "proposal-1" },
      { table: "artifacts", columns: "key", column: "id", value: "artifact-1" },
    ]);
  });

  it("returns null when proposal or artifact rows cannot be resolved", async () => {
    await expect(artifactKeyForReviewedProposal(fakeClient({}), "proposal-1", null))
      .resolves.toBeNull();
    await expect(artifactKeyForReviewedProposal(fakeClient({
      "artifact_change_proposals:id:proposal-1": { artifact_id: "artifact-1" },
    }), "proposal-1", null)).resolves.toBeNull();
  });
});
