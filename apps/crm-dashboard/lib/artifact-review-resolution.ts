type MaybeSingleQuery = {
  maybeSingle: () => PromiseLike<{ data: unknown }>;
};

type EqQuery = {
  eq: (column: string, value: string) => MaybeSingleQuery;
};

type SelectQuery = {
  select: (columns: string) => EqQuery;
};

export type ArtifactReviewResolutionClient = {
  from: (table: string) => SelectQuery;
};

async function artifactKeyById(
  client: ArtifactReviewResolutionClient,
  artifactId: string,
): Promise<string | null> {
  const { data } = await client.from("artifacts")
    .select("key")
    .eq("id", artifactId)
    .maybeSingle();
  return data && typeof data === "object" && typeof (data as { key?: unknown }).key === "string"
    ? (data as { key: string }).key
    : null;
}

export async function artifactKeyForReviewedProposal(
  client: ArtifactReviewResolutionClient,
  proposalId: string,
  patchArtifactId?: string | null,
): Promise<string | null> {
  if (patchArtifactId) return artifactKeyById(client, patchArtifactId);

  const { data: proposal } = await client.from("artifact_change_proposals")
    .select("artifact_id")
    .eq("id", proposalId)
    .maybeSingle();
  const artifactId = proposal
    && typeof proposal === "object"
    && typeof (proposal as { artifact_id?: unknown }).artifact_id === "string"
      ? (proposal as { artifact_id: string }).artifact_id
      : null;

  return artifactId ? artifactKeyById(client, artifactId) : null;
}
