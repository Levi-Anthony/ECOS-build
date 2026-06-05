import { describe, expect, it } from "vitest";
import {
  artifactTags,
  countArtifactTags,
  formatArtifactTag,
  sortArtifactTags,
} from "@/lib/artifact-browser";
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

  it("prioritizes FIBERR, Filament, and boot before sorting remaining tags by count then name", () => {
    expect(countArtifactTags([
      artifact("a", ["boot", "ecos", "fiberr"]),
      artifact("b", ["boot", "ecos", "filament"]),
      artifact("c", ["ecos", "alpha"]),
    ])).toEqual([
      ["fiberr", 1],
      ["filament", 1],
      ["boot", 2],
      ["ecos", 3],
      ["alpha", 1],
    ]);
  });

  it("sorts priority tags to the front and formats their canonical labels", () => {
    expect(sortArtifactTags(["zeta", "boot", "filament", "alpha", "fiberr"]))
      .toEqual(["fiberr", "filament", "boot", "alpha", "zeta"]);
    expect(formatArtifactTag("fiberr")).toBe("FIBERR");
    expect(formatArtifactTag("filament")).toBe("Filament");
    expect(formatArtifactTag("boot")).toBe("boot");
  });
});
