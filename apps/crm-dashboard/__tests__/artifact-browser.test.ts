import { describe, expect, it } from "vitest";
import { artifactTags, countArtifactTags } from "@/lib/artifact-browser";
import type { Artifact } from "@/lib/supabase";

const artifact = (id: string, tags?: unknown): Artifact => ({
  id,
  key: id,
  title: id,
  kind: "document",
  status: "active",
  review_policy: "live_audit",
  current_version: 1,
  metadata: tags === undefined ? {} : { tags },
  created_at: "2026-06-05T00:00:00Z",
  updated_at: "2026-06-05T00:00:00Z",
});

describe("artifact browser tag helpers", () => {
  it("returns only string tags", () => {
    expect(artifactTags(artifact("a", ["boot", 3, "ecos"]))).toEqual(["boot", "ecos"]);
  });

  it("counts exact tags and sorts by count then name", () => {
    expect(countArtifactTags([
      artifact("a", ["boot", "ecos"]),
      artifact("b", ["boot"]),
      artifact("c", ["alpha"]),
    ])).toEqual([
      ["boot", 2],
      ["alpha", 1],
      ["ecos", 1],
    ]);
  });
});
