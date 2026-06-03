import { supabase, Artifact } from "@/lib/supabase";

const KIND_COLORS: Record<string, string> = {
  spec: "bg-violet-100 text-violet-800",
  strategy_tracker: "bg-orange-100 text-orange-800",
  agent_handoff: "bg-amber-100 text-amber-800",
  agent_context: "bg-sky-100 text-sky-800",
  agent_instruction: "bg-blue-100 text-blue-800",
  prompt: "bg-teal-100 text-teal-800",
  template: "bg-rose-100 text-rose-800",
  playbook: "bg-indigo-100 text-indigo-800",
  checklist: "bg-emerald-100 text-emerald-800",
  sop: "bg-purple-100 text-purple-800",
  document: "bg-gray-100 text-gray-700",
  scratch: "bg-gray-100 text-gray-500",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  archived: "bg-red-100 text-red-700",
  superseded: "bg-gray-100 text-gray-600",
  draft: "bg-yellow-100 text-yellow-700",
};

// jsonb metadata is loosely typed — read scalar fields with a guard.
const str = (meta: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const v = meta?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};

export default async function ArtifactsPage({
  searchParams,
}: {
  searchParams: { kind?: string };
}) {
  const { kind } = searchParams ?? {};

  let query = supabase
    .from("artifacts")
    .select("id, key, title, kind, status, current_version, metadata, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (kind) query = query.eq("kind", kind);

  const { data: artifacts, error } = await query;

  // Derive the kind pill set from a SEPARATE unfiltered query — building it from
  // the (possibly ?kind=-filtered) list would collapse it to a single kind.
  const { data: allKinds } = await supabase.from("artifacts").select("id, kind");
  const kinds = Array.from(
    new Set((allKinds ?? []).map((a) => a.kind).filter(Boolean) as string[])
  ).sort();

  const buildUrl = (k?: string) => (k ? `/artifacts?kind=${encodeURIComponent(k)}` : "/artifacts");

  const FilterPill = ({ label, href, active }: { label: string; href: string; active: boolean }) => (
    <a
      href={href}
      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white"
          : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"
      }`}
    >
      {label}
    </a>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">
          <span className="text-violet-600">▤</span> Artifacts
        </h1>
        <span className="text-sm text-gray-500">{artifacts?.length ?? 0} shown</span>
      </div>

      {/* Kind filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        <FilterPill label="All kinds" href={buildUrl(undefined)} active={!kind} />
        {kinds.map((k) => (
          <FilterPill key={k} label={k} href={buildUrl(k)} active={kind === k} />
        ))}
      </div>

      {error && (
        <p className="text-red-600 text-sm mb-4">Error loading artifacts: {error.message}</p>
      )}

      <div className="space-y-3">
        {(artifacts as Artifact[] | null)?.map((a) => {
          const meta = a.metadata ?? {};
          const migratedFrom = str(meta, "migrated_from") ?? str(meta, "legacy_doc_type");
          const summary = str(meta, "summary");
          return (
            <a
              key={a.id}
              href={`/artifacts/${encodeURIComponent(a.key)}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-violet-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-medium text-gray-900">{a.title}</span>
                    {a.kind && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${KIND_COLORS[a.kind] ?? "bg-gray-100 text-gray-700"}`}>
                        {a.kind}
                      </span>
                    )}
                    {a.status && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[a.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {a.status}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      v{a.current_version}
                    </span>
                    {migratedFrom && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700" title={migratedFrom}>
                        migrated
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-gray-500 truncate">{a.key}</p>
                  {summary && (
                    <p className="text-sm text-gray-700 leading-relaxed mt-1.5">
                      {summary.length > 200 ? summary.slice(0, 200) + "…" : summary}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0 text-xs text-gray-400">
                  <p>{new Date(a.updated_at).toLocaleDateString()}</p>
                </div>
              </div>
            </a>
          );
        })}
        {(!artifacts || artifacts.length === 0) && !error && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            No artifacts found.
          </div>
        )}
      </div>
    </div>
  );
}
