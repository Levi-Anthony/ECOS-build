import { supabase, Thought } from "@/lib/supabase";
import { notFound } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  current: "bg-emerald-100 text-emerald-800",
  superseded: "bg-gray-100 text-gray-600",
  archived: "bg-red-100 text-red-700",
};

const DOMAIN_COLORS: Record<string, string> = {
  "ecos-architecture": "bg-violet-100 text-violet-800",
  "tango-pedagogy": "bg-rose-100 text-rose-800",
  "ttc-board": "bg-orange-100 text-orange-800",
  "neil-outreach": "bg-amber-100 text-amber-800",
  "it-consulting": "bg-blue-100 text-blue-800",
  "music-production": "bg-purple-100 text-purple-800",
  "brain-protocol": "bg-teal-100 text-teal-800",
  personal: "bg-green-100 text-green-800",
};

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

  return (
    <div className="max-w-3xl">
      <a href="/brain" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        ← BRAIN
      </a>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex flex-wrap gap-2">
            {meta.domain && (
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${DOMAIN_COLORS[meta.domain] ?? "bg-gray-100 text-gray-700"}`}>
                {meta.domain}
              </span>
            )}
            {meta.type && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                {meta.type}
              </span>
            )}
            {meta.horizon && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                {meta.horizon}
              </span>
            )}
            {meta.signal_type && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                {meta.signal_type}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {thought.status && (
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[thought.status] ?? "bg-gray-100 text-gray-700"}`}>
                {thought.status}
              </span>
            )}
          </div>
        </div>

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
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">⚠ needs split</span>
            )}
            {meta.metadata_fallback && (
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">⚠ metadata fallback</span>
            )}
          </div>
        )}
      </div>

      {/* Thought ID — copyable */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Thought ID</p>
        <p className="font-mono text-sm text-gray-800 select-all break-all">{thought.id}</p>
      </div>
    </div>
  );
}
