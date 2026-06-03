import { supabase } from "@/lib/supabase-server";
import type { Thought } from "@/lib/supabase";
import { relativeAge } from "@/lib/logic";
import { ReviewHeader, chipClass, type ReviewChip, type ReviewField } from "@/lib/review-ui";
import { notFound } from "next/navigation";

export default async function ThoughtDetailPage({ params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, content, original_content, created_at, status, retrieval_count, source_id, metadata")
    .eq("id", params.id)
    .single();

  if (error || !data) notFound();

  const thought = data as Thought;
  const meta = thought.metadata ?? {};
  const wasRewritten = thought.original_content && thought.original_content !== thought.content;
  const title = thought.content.length > 110 ? thought.content.slice(0, 110) + "..." : thought.content;

  const { data: sameSourceRows } = thought.source_id
    ? await supabase
        .from("thoughts")
        .select("id, content, created_at, status, source_id, metadata")
        .eq("source_id", thought.source_id)
        .neq("id", thought.id)
        .order("created_at", { ascending: false })
        .limit(8)
    : { data: [] };

  const sameSource = (sameSourceRows ?? []) as Pick<Thought, "id" | "content" | "created_at" | "status" | "source_id" | "metadata">[];

  const reviewChips = ([
    meta.domain ? { label: meta.domain, tone: "purple" } : null,
    meta.type ? { label: `type: ${meta.type}` } : null,
    meta.horizon ? { label: `horizon: ${meta.horizon}`, tone: "amber" } : null,
    meta.signal_type ? { label: `signal: ${meta.signal_type}`, tone: "indigo" } : null,
    thought.status ? { label: `status: ${thought.status}`, tone: thought.status === "current" ? "emerald" : "gray" } : null,
  ] as Array<ReviewChip | null>).filter((x): x is ReviewChip => x !== null);

  const warnings = ([
    !thought.source_id ? { label: "missing source_id", tone: "amber", title: "No source_id is stored on this thought." } : null,
    meta.needs_split ? { label: "needs split", tone: "amber", title: "metadata.needs_split is true." } : null,
    meta.metadata_fallback ? { label: "metadata fallback", tone: "amber", title: "metadata.metadata_fallback is true." } : null,
    thought.status && thought.status !== "current" ? { label: thought.status, tone: "red", title: "Thought status is not current." } : null,
  ] as Array<ReviewChip | null>).filter((x): x is ReviewChip => x !== null);

  const reviewFields: ReviewField[] = [
    { label: "Captured", value: `${new Date(thought.created_at).toLocaleDateString()} (${relativeAge(thought.created_at)})` },
    { label: "Retrievals", value: String(thought.retrieval_count) },
    { label: "Source", value: thought.source_id ?? "none", mono: Boolean(thought.source_id) },
    { label: "ID", value: thought.id, mono: true },
  ];

  return (
    <div className="max-w-3xl">
      <a href="/brain" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        ← BRAIN
      </a>

      <ReviewHeader
        eyebrow="BRAIN review state"
        title={title}
        subtitle={thought.id}
        chips={reviewChips}
        warnings={warnings}
        fields={reviewFields}
      />

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {wasRewritten ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1">As captured</h3>
              <p className="text-gray-900 text-base leading-relaxed whitespace-pre-wrap">{thought.original_content}</p>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1">As stored / searched</h3>
              <p className="text-gray-700 text-base leading-relaxed whitespace-pre-wrap">{thought.content}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-900 text-base leading-relaxed whitespace-pre-wrap">{thought.content}</p>
        )}
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Metadata</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {meta.confidence && (
            <div>
              <span className="text-gray-500">Confidence</span>
              <p className="font-medium">{meta.confidence}</p>
            </div>
          )}
          <div>
            <span className="text-gray-500">Captured</span>
            <p className="font-medium">{new Date(thought.created_at).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-gray-500">Retrievals</span>
            <p className="font-medium">{thought.retrieval_count}</p>
          </div>
          {thought.source_id && (
            <div>
              <span className="text-gray-500">Source ID</span>
              <p className="font-mono text-xs text-gray-700">{thought.source_id}</p>
            </div>
          )}
        </div>

        {meta.topics && meta.topics.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Topics</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {meta.topics.map((t: string) => (
                <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{t}</span>
              ))}
            </div>
          </div>
        )}

        {meta.people && meta.people.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">People</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {meta.people.map((p: string) => (
                <span key={p} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{p}</span>
              ))}
            </div>
          </div>
        )}

        {meta.action_items && meta.action_items.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Action items</span>
            <ul className="mt-1 space-y-0.5">
              {meta.action_items.map((a: string, i: number) => (
                <li key={i} className="text-sm text-gray-700">• {a}</li>
              ))}
            </ul>
          </div>
        )}

        {(meta.needs_split || meta.metadata_fallback) && (
          <div className="mt-3 flex gap-2">
            {meta.needs_split && (
              <span className={chipClass("amber")}>needs split</span>
            )}
            {meta.metadata_fallback && (
              <span className={chipClass("amber")}>metadata fallback</span>
            )}
          </div>
        )}
      </div>

      {/* Continuity */}
      {thought.source_id && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Continuity</h2>
          {sameSource.length > 0 ? (
            <div className="space-y-2">
              {sameSource.map((row) => (
                <a key={row.id} href={`/brain/${row.id}`} className="block border border-gray-100 rounded-lg p-3 hover:border-purple-200 transition-colors">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className={chipClass("blue")}>same source_id</span>
                    <span className="text-xs text-gray-400">{new Date(row.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {row.content.length > 160 ? row.content.slice(0, 160) + "..." : row.content}
                  </p>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No other thoughts share this source_id.</p>
          )}
        </div>
      )}

      {/* Thought ID — copyable */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Thought ID</p>
        <p className="font-mono text-sm text-gray-800 select-all break-all">{thought.id}</p>
      </div>
    </div>
  );
}
