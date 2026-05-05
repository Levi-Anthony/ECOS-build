import { supabase, TastePreference, TasteEvolution } from "@/lib/supabase";
import { notFound } from "next/navigation";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  archived: "bg-gray-100 text-gray-600",
  superseded: "bg-yellow-100 text-yellow-800",
};

const CHANGE_COLORS: Record<string, string> = {
  upgraded: "bg-emerald-100 text-emerald-800",
  downgraded: "bg-amber-100 text-amber-800",
  refined: "bg-blue-100 text-blue-800",
  archived: "bg-gray-100 text-gray-600",
};

export default async function TasteDetailPage({ params }: { params: { id: string } }) {
  const { data: prefData, error: prefError } = await supabase
    .from("taste_preferences")
    .select("*")
    .eq("id", params.id)
    .single();

  if (prefError || !prefData) notFound();
  const pref = prefData as TastePreference;

  const { data: evolutionData } = await supabase
    .from("taste_evolution")
    .select("*")
    .eq("taste_id", params.id)
    .order("created_at", { ascending: false });
  const evolution = (evolutionData ?? []) as TasteEvolution[];

  return (
    <div className="max-w-3xl">
      <a href="/taste" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        ← Taste
      </a>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {pref.preference_name ?? "(unnamed)"}
            </h1>
            {pref.type_label && (
              <p className="text-sm text-gray-500 mt-1">{pref.type_label}</p>
            )}
          </div>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[pref.status] ?? "bg-gray-100 text-gray-700"}`}>
            {pref.status}
          </span>
        </div>

        {pref.domain && (
          <div className="mb-4">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Domain</span>
            <p className="text-sm text-gray-700 mt-1">{pref.domain}</p>
          </div>
        )}

        {pref.reject && (
          <div className="mb-4">
            <span className="text-xs text-rose-600 font-medium uppercase tracking-wide">Reject</span>
            <p className="text-sm text-gray-700 mt-1 leading-relaxed">{pref.reject}</p>
          </div>
        )}

        {pref.want && (
          <div className="mb-4">
            <span className="text-xs text-emerald-700 font-medium uppercase tracking-wide">Want</span>
            <p className="text-sm text-gray-700 mt-1 leading-relaxed">{pref.want}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm mt-4 pt-4 border-t border-gray-100">
          <div>
            <span className="text-gray-500 text-xs uppercase tracking-wide">Captured</span>
            <p className="text-gray-700">{new Date(pref.created_at).toLocaleDateString()}</p>
          </div>
          <div>
            <span className="text-gray-500 text-xs uppercase tracking-wide">Invocations</span>
            <p className="text-gray-700">{pref.invocation_count ?? 0}</p>
          </div>
          {pref.last_invoked_at && (
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Last invoked</span>
              <p className="text-gray-700">{new Date(pref.last_invoked_at).toLocaleDateString()}</p>
            </div>
          )}
          {pref.source && (
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Source</span>
              <p className="text-gray-700 font-mono text-xs">{pref.source}</p>
            </div>
          )}
        </div>

        {pref.thought_id && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Linked BRAIN entry</span>
            <p className="mt-1">
              <a href={`/brain/${pref.thought_id}`} className="text-sm text-blue-600 hover:text-blue-800 font-mono">
                {pref.thought_id}
              </a>
            </p>
          </div>
        )}
      </div>

      {/* Audit history */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
          Evolution history {evolution.length > 0 && <span className="text-gray-400">({evolution.length})</span>}
        </h2>
        {evolution.length === 0 ? (
          <p className="text-sm text-gray-500">No changes logged yet.</p>
        ) : (
          <div className="space-y-3">
            {evolution.map((e) => (
              <div key={e.id} className="border-l-2 border-gray-200 pl-3 py-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CHANGE_COLORS[e.change_type] ?? "bg-gray-100"}`}>
                    {e.change_type}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(e.applied_at ?? e.created_at).toLocaleString()}
                  </span>
                </div>
                {e.reason && (
                  <p className="text-sm text-gray-700">{e.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Thought ID — copyable */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 mt-6">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Preference ID</p>
        <p className="font-mono text-sm text-gray-800 select-all break-all">{pref.id}</p>
      </div>
    </div>
  );
}
