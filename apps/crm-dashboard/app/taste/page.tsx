import { supabase } from "@/lib/supabase-server";
import type { TastePreference } from "@/lib/supabase";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  archived: "bg-gray-100 text-gray-600",
  superseded: "bg-yellow-100 text-yellow-800",
};

export default async function TastePage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; status?: string }>;
}) {
  const { domain, status } = await searchParams;

  let query = supabase
    .from("taste_preferences")
    .select("id, user_id, preference_name, domain, reject, want, type_label, status, invocation_count, last_invoked_at, created_at, thought_id, constraint_text, constraint_type, source, contact_id, user_responded, updated_at")
    .order("status", { ascending: true })
    .order("invocation_count", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (domain) query = query.eq("domain", domain);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    return <div className="text-red-700">Error loading taste preferences: {error.message}</div>;
  }

  const prefs = (data ?? []) as TastePreference[];

  // Distinct domains for filter chips
  const domains = Array.from(new Set(prefs.map((p) => p.domain).filter(Boolean) as string[])).sort();

  // Group by status for visual sectioning
  const grouped: Record<string, TastePreference[]> = {};
  for (const p of prefs) {
    grouped[p.status] = grouped[p.status] ?? [];
    grouped[p.status].push(p);
  }
  const statusOrder = ["active", "superseded", "archived"];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Taste</h1>
          <p className="text-sm text-gray-500 mt-1">{prefs.length} preference{prefs.length === 1 ? "" : "s"} tracked</p>
        </div>
      </div>

      {/* Domain filter chips */}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <a
            href="/taste"
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              !domain ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-200 hover:border-gray-400"
            }`}
          >
            All domains
          </a>
          {domains.map((d) => (
            <a
              key={d}
              href={`/taste?domain=${encodeURIComponent(d)}`}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                domain === d ? "bg-gray-900 text-white" : "bg-white text-gray-700 border border-gray-200 hover:border-gray-400"
              }`}
            >
              {d}
            </a>
          ))}
        </div>
      )}

      {prefs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          No taste preferences match the current filters.
        </div>
      ) : (
        <div className="space-y-8">
          {statusOrder.map((s) => {
            const rows = grouped[s];
            if (!rows || rows.length === 0) return null;
            return (
              <div key={s}>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  {s} <span className="text-gray-400">({rows.length})</span>
                </h2>
                <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {rows.map((p) => (
                    <a
                      key={p.id}
                      href={`/taste/${p.id}`}
                      className="block p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-gray-900 truncate">
                              {p.preference_name ?? "(unnamed)"}
                            </h3>
                            {p.type_label && (
                              <span className="text-xs text-gray-500 truncate">· {p.type_label}</span>
                            )}
                          </div>
                          {p.domain && (
                            <p className="text-xs text-gray-500 mb-2">{p.domain}</p>
                          )}
                          {p.reject && (
                            <p className="text-sm text-gray-700 line-clamp-2">
                              <span className="text-rose-600 font-medium">Reject: </span>{p.reject}
                            </p>
                          )}
                          {p.want && (
                            <p className="text-sm text-gray-700 line-clamp-2 mt-1">
                              <span className="text-emerald-700 font-medium">Want: </span>{p.want}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-700"}`}>
                            {p.status}
                          </span>
                          {(p.invocation_count ?? 0) > 0 && (
                            <span className="text-xs text-gray-500">{p.invocation_count} ×</span>
                          )}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
