import { supabase } from "@/lib/supabase-server";
import type { Artifact } from "@/lib/supabase";
import { ActiveFilterSummary, EmptyReviewState, type ReviewChip } from "@/lib/review-ui";

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
  searchParams: { kind?: string; status?: string };
}) {
  const { kind, status } = searchParams ?? {};

  let query = supabase
    .from("artifacts")
    .select("id, key, title, kind, status, current_version, metadata, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (kind) query = query.eq("kind", kind);
  if (status) query = query.eq("status", status);

  const { data: artifacts, error } = await query;
  const rows = (artifacts ?? []) as Artifact[];

  // Derive the kind pill set from a SEPARATE unfiltered query — building it from
  // the (possibly ?kind=-filtered) list would collapse it to a single kind.
  const { data: allKinds } = await supabase.from("artifacts").select("id, kind, status");
  const kinds = Array.from(
    new Set((allKinds ?? []).map((a) => a.kind).filter(Boolean) as string[])
  ).sort();
  const statuses = Array.from(
    new Set((allKinds ?? []).map((a) => a.status).filter(Boolean) as string[])
  ).sort();

  const buildUrl = (overrides: { kind?: string; status?: string }) => {
    const params = new URLSearchParams();
    const merged = { kind, status, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return `/artifacts${s ? `?${s}` : ""}`;
  };

  const activeFilters = ([
    kind ? { label: `kind: ${kind}`, tone: "purple" } : null,
    status ? { label: `status: ${status}`, tone: status === "active" ? "emerald" : "gray" } : null,
  ] as Array<ReviewChip | null>).filter((x): x is ReviewChip => x !== null);

  const FilterPill = ({ label, href, active }: { label: string; href: string; active: boolean }) => (
    <a
      href={href}
      className={`inline-flex min-h-10 items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-xl font-semibold">
          <span className="text-violet-600">▤</span> Artifacts
        </h1>
        <span className="text-sm text-gray-500">{rows.length} shown</span>
      </div>

      {/* Kind filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        <FilterPill label="All kinds" href={buildUrl({ kind: undefined })} active={!kind} />
        {kinds.map((k) => (
          <FilterPill key={k} label={k} href={buildUrl({ kind: k })} active={kind === k} />
        ))}
        <span className="hidden sm:block w-px bg-gray-200 mx-1" />
        <FilterPill label="All statuses" href={buildUrl({ status: undefined })} active={!status} />
        {statuses.map((s) => (
          <FilterPill key={s} label={s} href={buildUrl({ status: s })} active={status === s} />
        ))}
      </div>

      <ActiveFilterSummary filters={activeFilters} clearHref="/artifacts" resultCount={rows.length} />

      {error && (
        <p className="text-red-600 text-sm mb-4">Error loading artifacts: {error.message}</p>
      )}

      <div className="space-y-3">
        {rows.map((a) => {
          const meta = a.metadata ?? {};
          const migratedFrom = str(meta, "migrated_from") ?? str(meta, "legacy_doc_type");
          const summary = str(meta, "summary");
          const authorityLevel = str(meta, "authority_level");
          const scope = str(meta, "scope");
          return (
            <a
              key={a.id}
              href={`/artifacts/${encodeURIComponent(a.key)}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-violet-300 hover:shadow-sm transition-all"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">{a.title}</span>
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
                    {authorityLevel && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        authority: {authorityLevel}
                      </span>
                    )}
                    {scope && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        scope: {scope}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-gray-500 break-all">{a.key}</p>
                  {summary && (
                    <p className="text-sm text-gray-700 leading-relaxed mt-1.5">
                      {summary.length > 200 ? summary.slice(0, 200) + "…" : summary}
                    </p>
                  )}
                </div>
                <div className="text-left sm:text-right flex-shrink-0 text-xs text-gray-400">
                  <p>{new Date(a.updated_at).toLocaleDateString()}</p>
                </div>
              </div>
            </a>
          );
        })}
        {rows.length === 0 && !error && (
          <EmptyReviewState
            title="No artifacts found."
            description={activeFilters.length > 0 ? "The active filters may be too narrow for the available artifact metadata." : "No artifacts are available."}
            clearHref="/artifacts"
          />
        )}
      </div>
    </div>
  );
}
