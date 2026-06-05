import { supabase } from "@/lib/supabase-server";
import type { Artifact, ArtifactChangeProposal } from "@/lib/supabase";
import { chipClass, EmptyReviewState } from "@/lib/review-ui";

const STATUS_TONES: Record<string, "amber" | "blue" | "emerald" | "red" | "gray"> = {
  pending: "amber",
  revision_requested: "blue",
  approved: "emerald",
  rejected: "red",
  conflicted: "red",
  superseded: "gray",
};

export default async function ArtifactReviewInbox({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status = searchParams?.status ?? "pending";
  let query = supabase.from("artifact_change_proposals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  const proposals = (data ?? []) as ArtifactChangeProposal[];
  const artifactIds = Array.from(new Set(proposals.map((proposal) => proposal.artifact_id)));
  const { data: artifactRows } = artifactIds.length
    ? await supabase.from("artifacts")
        .select("id, key, title, kind, status, review_policy, current_version, metadata, created_at, updated_at")
        .in("id", artifactIds)
    : { data: [] };
  const artifacts = new Map(((artifactRows ?? []) as Artifact[]).map((artifact) => [artifact.id, artifact]));

  const statuses = ["pending", "revision_requested", "conflicted", "approved", "rejected", "superseded", "all"];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Artifact human door</p>
          <h1 className="text-xl font-semibold text-gray-900 mt-1">Review inbox</h1>
          <p className="text-sm text-gray-500 mt-1">Agent proposals remain evidence until explicitly approved.</p>
        </div>
        <a href="/artifacts" className="inline-flex min-h-10 items-center text-sm font-medium text-gray-600 hover:text-gray-900">
          Back to artifacts
        </a>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {statuses.map((value) => (
          <a
            key={value}
            href={`/artifacts/review?status=${value}`}
            className={`inline-flex min-h-10 items-center rounded-full px-3 text-sm font-medium ${
              status === value ? "bg-emerald-800 text-white" : "border border-gray-200 bg-white text-gray-600 hover:border-emerald-400"
            }`}
          >
            {value.replaceAll("_", " ")}
          </a>
        ))}
      </div>

      {error && <p className="text-sm text-red-700 mb-4">{error.message}</p>}

      <div className="space-y-3">
        {proposals.map((proposal) => {
          const artifact = artifacts.get(proposal.artifact_id);
          return (
            <a
              key={proposal.id}
              href={`/artifacts/review/${proposal.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-emerald-400 hover:shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={chipClass(STATUS_TONES[proposal.status] ?? "gray")}>{proposal.status.replaceAll("_", " ")}</span>
                    <span className={chipClass(artifact?.review_policy === "human_gate" ? "indigo" : "gray")}>
                      {artifact?.review_policy ?? proposal.review_policy_at_proposal}
                    </span>
                    <span className={chipClass("gray")}>base v{proposal.base_version}</span>
                    <span className={chipClass("gray")}>{proposal.ops.length} op{proposal.ops.length === 1 ? "" : "s"}</span>
                  </div>
                  <h2 className="font-medium text-gray-900">{proposal.summary}</h2>
                  <p className="text-sm text-gray-600 mt-1">{artifact?.title ?? "Unknown artifact"}</p>
                  <p className="font-mono text-xs text-gray-400 mt-1 break-all">{artifact?.key ?? proposal.artifact_id}</p>
                </div>
                <div className="text-xs text-gray-400 sm:text-right">
                  <p>{proposal.proposer_actor_type}:{proposal.proposer_actor_id ?? "unknown"}</p>
                  <p className="mt-1">{new Date(proposal.created_at).toLocaleString()}</p>
                </div>
              </div>
            </a>
          );
        })}
        {proposals.length === 0 && !error && (
          <EmptyReviewState
            title="No proposals in this queue."
            description="Change the status filter to inspect resolved or conflicted proposals."
            clearHref="/artifacts/review?status=all"
          />
        )}
      </div>
    </div>
  );
}
