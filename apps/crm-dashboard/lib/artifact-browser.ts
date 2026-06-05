import type { Artifact } from "@/lib/supabase";

const PRIORITY_ARTIFACT_TAGS = ["fiberr", "filament", "boot"] as const;

const priorityArtifactTagRank = (tag: string): number => {
  const rank = PRIORITY_ARTIFACT_TAGS.indexOf(tag.toLowerCase() as (typeof PRIORITY_ARTIFACT_TAGS)[number]);
  return rank === -1 ? PRIORITY_ARTIFACT_TAGS.length : rank;
};

const compareArtifactTagNames = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b);

export const artifactTags = (artifact: Artifact): string[] => {
  const tags = artifact.metadata?.tags;
  return Array.isArray(tags) ? tags.filter((value): value is string => typeof value === "string") : [];
};

export const formatArtifactTag = (tag: string): string => {
  if (tag.toLowerCase() === "fiberr") return "FIBERR";
  if (tag.toLowerCase() === "filament") return "Filament";
  return tag;
};

export const sortArtifactTags = (tags: string[]): string[] =>
  [...tags].sort((a, b) =>
    priorityArtifactTagRank(a) - priorityArtifactTagRank(b)
    || compareArtifactTagNames(a, b)
  );

export const countArtifactTags = (rows: Artifact[]): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const artifact of rows) {
    for (const tag of artifactTags(artifact)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) =>
    priorityArtifactTagRank(a[0]) - priorityArtifactTagRank(b[0])
    || b[1] - a[1]
    || compareArtifactTagNames(a[0], b[0])
  );
};
