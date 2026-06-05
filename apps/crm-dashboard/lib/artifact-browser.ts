import type { Artifact } from "@/lib/supabase";

export const artifactTags = (artifact: Artifact): string[] => {
  const tags = artifact.metadata?.tags;
  return Array.isArray(tags) ? tags.filter((value): value is string => typeof value === "string") : [];
};

export const countArtifactTags = (rows: Artifact[]): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const artifact of rows) {
    for (const tag of artifactTags(artifact)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
