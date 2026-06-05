import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase-server";
import type { Artifact, ArtifactBlock, ArtifactChangeProposal, ArtifactReviewEvent } from "@/lib/supabase";
import { artifactOpLabel, currentBlockForOp, proposedContentForOp } from "@/lib/artifact-review";
import { ActionFeedbackBanner, chipClass, ReviewHeader, type ReviewChip } from "@/lib/review-ui";
import { reviewArtifactProposalAction } from "@/app/artifacts/actions";
import { readArtifactActionFeedback } from "@/lib/artifact-action-feedback";
import { getHumanAuthorityReadiness, humanAuthorityReadinessMessage } from "@/lib/human-authority";

export default async function ArtifactProposalDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action_result?: string; action_label?: string; action_message?: string }>;
}) {
  const [{ id }, actionParams] = await Promise.all([params, searchParams]);
  const actionFeedback = readArtifactActionFeedback(actionParams);
  const [humanAuthorityReadiness, proposalResult] = await Promise.all([
    getHumanAuthorityReadiness(),
    supabase.from("artifact_change_proposals").select("*").eq("id", id).maybeSingle(),
  ]);
  const humanAuthorityReady = humanAuthorityReadiness === "ready";
  const { data: proposalRow } = proposalResult;
  if (!proposalRow) notFound();
  const proposal = proposalRow as ArtifactChangeProposal;

  const [{ data: artifactRow }, { data: blockRows }, { data: eventRows }] = await Promise.all([
    supabase.from("artifacts").select("*").eq("id", proposal.artifact_id).maybeSingle(),
    supabase.from("artifact_blocks").select("*").eq("artifact_id", proposal.artifact_id).order("sort_order").order("path"),
    supabase.from("artifact_review_events").select("*").eq("proposal_id", proposal.id).order("created_at"),
  ]);
  if (!artifactRow) notFound();
  const artifact = artifactRow as Artifact;
  const blocks = (blockRows ?? []) as ArtifactBlock[];
  const events = (eventRows ?? []) as ArtifactReviewEvent[];
  const isOpen = proposal.status === "pending" || proposal.status === "revision_requested";
  const chips: ReviewChip[] = [
    { label: proposal.status.replaceAll("_", " "), tone: proposal.status === "pending" ? "amber" : proposal.status === "approved" ? "emerald" : "gray" },
    { label: artifact.review_policy, tone: artifact.review_policy === "human_gate" ? "indigo" : "gray" },
    { label: `base v${proposal.base_version}` },
    { label: `current v${artifact.current_version}`, tone: artifact.current_version === proposal.base_version ? "emerald" : "red" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <a href="/artifacts/review" className="inline-flex min-h-10 items-center text-sm text-gray-500 hover:text-gray-900">
          Back to review inbox
        </a>
        <a href={`/artifacts/${encodeURIComponent(artifact.key)}`} className="inline-flex min-h-10 items-center text-sm text-gray-500 hover:text-gray-900">
          Open current artifact
        </a>
      </div>

      <ReviewHeader
        eyebrow="Artifact change proposal"
        title={proposal.summary}
        subtitle={`${artifact.title} · ${artifact.key}`}
        chips={chips}
        warnings={artifact.current_version !== proposal.base_version ? [{ label: "base version drift", tone: "red" }] : []}
        fields={[
          { label: "Proposer", value: `${proposal.proposer_actor_type}:${proposal.proposer_actor_id ?? "unknown"}` },
          { label: "Created", value: new Date(proposal.created_at).toLocaleString() },
          { label: "Operations", value: String(proposal.ops.length) },
          { label: "Proposal ID", value: proposal.id, mono: true },
        ]}
      />

      {actionFeedback && <ActionFeedbackBanner {...actionFeedback} clearHref={`/artifacts/review/${id}`} />}

      {isOpen && !humanAuthorityReady && (
        <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 mb-5 text-red-950">
          <p className="text-xs font-semibold uppercase tracking-wide">Human review unavailable</p>
          <p className="text-sm mt-1">{humanAuthorityReadinessMessage(humanAuthorityReadiness)}</p>
        </section>
      )}

      {proposal.review_reason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-5">
          <p className="text-xs uppercase tracking-wide text-amber-700">Latest review reason</p>
          <p className="text-sm text-amber-900 mt-1">{proposal.review_reason}</p>
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Proposed changes</h2>
      <div className="space-y-5 mb-8">
        {proposal.ops.map((op, index) => {
          const current = currentBlockForOp(op, blocks);
          const proposed = proposedContentForOp(op, current);
          return (
            <section key={`${index}-${artifactOpLabel(op)}`} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={chipClass("purple")}>op {index + 1}</span>
                  <span className="font-mono text-xs text-gray-700">{artifactOpLabel(op)}</span>
                </div>
              </div>
              <div className="grid lg:grid-cols-2">
                <div className="border-b border-gray-100 p-4 lg:border-b-0 lg:border-r">
                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Current</p>
                  <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs text-gray-700">
                    {current?.content ?? "(no current block content)"}
                  </pre>
                </div>
                <div className="p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-700 mb-2">Proposed</p>
                  <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded bg-emerald-50 p-3 text-xs text-emerald-950">
                    {proposed ?? "(removed / no content)"}
                  </pre>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {isOpen && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Human review action</h2>
          <form action={reviewArtifactProposalAction}>
            <fieldset disabled={!humanAuthorityReady} className="space-y-3">
            <input type="hidden" name="proposal_id" value={proposal.id} />
            <textarea
              name="reason"
              rows={3}
              placeholder="Reason, rejection note, or revision request..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
            <div className="flex flex-wrap gap-2">
              <button name="action" value="approve" className="min-h-10 rounded-lg bg-emerald-800 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300">
                Approve
              </button>
              <button name="action" value="request_revision" className="min-h-10 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400">
                Request revision
              </button>
              <button name="action" value="reject" className="min-h-10 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400">
                Reject
              </button>
              <button name="action" value="supersede" className="min-h-10 rounded-lg border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400">
                Supersede
              </button>
            </div>
            </fieldset>
          </form>

          <details className="mt-5 border-t border-gray-100 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Edit raw operations and approve</summary>
            <form action={reviewArtifactProposalAction}>
              <fieldset disabled={!humanAuthorityReady} className="space-y-3 mt-3">
              <input type="hidden" name="proposal_id" value={proposal.id} />
              <input type="hidden" name="action" value="edit_and_approve" />
              <textarea
                name="replacement_ops"
                rows={18}
                defaultValue={JSON.stringify(proposal.ops, null, 2)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
              <input
                name="reason"
                required
                placeholder="Describe the human edit"
                className="min-h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
              <button className="min-h-10 rounded-lg bg-emerald-800 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300">
                Edit and approve
              </button>
              </fieldset>
            </form>
          </details>
        </section>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Review event trail</h2>
        <div className="divide-y divide-gray-100">
          {events.map((event) => (
            <div key={event.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={chipClass(event.event_type === "approved" || event.event_type === "edited_and_approved" ? "emerald" : "gray")}>
                  {event.event_type.replaceAll("_", " ")}
                </span>
                <span className="text-xs text-gray-500">{event.actor_type}:{event.actor_id ?? "unknown"}</span>
                <span className="text-xs text-gray-400">{new Date(event.created_at).toLocaleString()}</span>
              </div>
              {event.reason && <p className="text-sm text-gray-700 mt-1">{event.reason}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
