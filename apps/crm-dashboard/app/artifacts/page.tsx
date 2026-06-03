import { supabase } from "@/lib/supabase-server";
import type { Artifact } from "@/lib/supabase";
import { ActiveFilterSummary, EmptyReviewState, chipClass, type ReviewChip } from "@/lib/review-ui";
import type { ReactNode } from "react";

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

const AUTHORITY_ORDER = [
  "policy",
  "approved_instruction",
  "proposed_instruction",
  "proposed_operational_protocol",
  "draft",
  "evidence",
] as const;

const AUTHORITY_COLORS: Record<string, string> = {
  policy: "bg-red-100 text-red-700",
  approved_instruction: "bg-emerald-100 text-emerald-800",
  proposed_instruction: "bg-blue-50 text-blue-700",
  proposed_operational_protocol: "bg-blue-50 text-blue-700",
  draft: "bg-amber-100 text-amber-800",
  evidence: "bg-gray-100 text-gray-700",
};

const AUTHORITY_LABELS: Record<string, string> = {
  policy: "Policy",
  approved_instruction: "Approved",
  proposed_instruction: "Proposed",
  proposed_operational_protocol: "Proposed protocol",
  draft: "Draft",
  evidence: "Evidence",
};

// jsonb metadata is loosely typed — read scalar fields with a guard.
const str = (meta: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const v = meta?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};

const countBy = <T,>(rows: T[], getValue: (row: T) => string | undefined): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = getValue(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const authorityRank = (authorityLevel: string | undefined): number => {
  if (!authorityLevel) return AUTHORITY_ORDER.length + 1;
  const rank = AUTHORITY_ORDER.indexOf(authorityLevel as (typeof AUTHORITY_ORDER)[number]);
  return rank === -1 ? AUTHORITY_ORDER.length : rank;
};

const formatAuthority = (authorityLevel: string): string =>
  AUTHORITY_LABELS[authorityLevel] ??
  authorityLevel
    .split("_")
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part[0]?.toUpperCase() + part.slice(1) : part))
    .join(" ");

export default async function ArtifactsPage({
  searchParams,
}: {
  searchParams: { kind?: string; status?: string; authority?: string; q?: string; sort?: string };
}) {
  const { kind, status, authority, q, sort } = searchParams ?? {};
  const search = q?.trim();

  const { data: artifacts, error } = await supabase
    .from("artifacts")
    .select("id, key, title, kind, status, current_version, metadata, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  const allRows = (artifacts ?? []) as Artifact[];
  const normalizedSearch = search?.toLowerCase();
  const rows = allRows
    .filter((artifact) => {
      const meta = artifact.metadata ?? {};
      const summary = str(meta, "summary") ?? "";
      const authorityLevel = str(meta, "authority_level");
      if (kind && artifact.kind !== kind) return false;
      if (status && artifact.status !== status) return false;
      if (authority && authorityLevel !== authority) return false;
      if (!normalizedSearch) return true;
      return [artifact.title, artifact.key, summary].some((value) => value.toLowerCase().includes(normalizedSearch));
    })
    .sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "authority") {
        const rankDiff = authorityRank(str(a.metadata, "authority_level")) - authorityRank(str(b.metadata, "authority_level"));
        if (rankDiff !== 0) return rankDiff;
        return b.updated_at.localeCompare(a.updated_at);
      }
      return b.updated_at.localeCompare(a.updated_at);
    });

  const kinds = countBy(allRows, (artifact) => artifact.kind).map(([value]) => value);
  const statuses = countBy(allRows, (artifact) => artifact.status).map(([value]) => value);
  const authorities = countBy(allRows, (artifact) => str(artifact.metadata, "authority_level")).map(([value]) => value);
  const resultKindCounts = countBy(rows, (artifact) => artifact.kind);
  const resultStatusCounts = countBy(rows, (artifact) => artifact.status);
  const resultAuthorityCounts = countBy(rows, (artifact) => str(artifact.metadata, "authority_level"));
  const activeCount = rows.filter((artifact) => artifact.status === "active").length;
  const instructionGradeCount = rows.filter((artifact) =>
    ["policy", "approved_instruction"].includes(str(artifact.metadata, "authority_level") ?? "")
  ).length;

  const buildUrl = (overrides: { kind?: string; status?: string; authority?: string; q?: string; sort?: string }) => {
    const params = new URLSearchParams();
    const merged = { kind, status, authority, q: search, sort, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return `/artifacts${s ? `?${s}` : ""}`;
  };

  const activeFilters = ([
    kind ? { label: `kind: ${kind}`, tone: "purple" } : null,
    status ? { label: `status: ${status}`, tone: status === "active" ? "emerald" : "gray" } : null,
    authority ? { label: `authority: ${formatAuthority(authority)}`, tone: "indigo" } : null,
    search ? { label: `search: ${search}`, tone: "blue" } : null,
    sort === "title" ? { label: "sort: title", tone: "gray" } : null,
    sort === "authority" ? { label: "sort: authority", tone: "gray" } : null,
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

  const FilterGroup = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="flex gap-2 flex-wrap">{children}</div>
    </div>
  );

  const CountChips = ({
    label,
    counts,
    colorFor,
    formatter,
  }: {
    label: string;
    counts: Array<[string, number]>;
    colorFor?: (value: string) => string;
    formatter?: (value: string) => string;
  }) => (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {counts.slice(0, 8).map(([value, count]) => (
          <span key={value} className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorFor?.(value) ?? "bg-gray-100 text-gray-700"}`}>
            {formatter ? formatter(value) : value}: {count}
          </span>
        ))}
        {counts.length === 0 && <span className="text-xs text-gray-400">None</span>}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-5">
        <h1 className="text-xl font-semibold">
          <span className="text-violet-600">▤</span> Artifacts
        </h1>
        <span className="text-sm text-gray-500">{rows.length} shown · {allRows.length} total</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Matching artifacts</p>
          <p className="text-2xl font-semibold mt-1">{rows.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-semibold mt-1">{activeCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Kinds in result</p>
          <p className="text-2xl font-semibold mt-1">{resultKindCounts.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Policy / approved</p>
          <p className="text-2xl font-semibold mt-1">{instructionGradeCount}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-5 grid gap-4 lg:grid-cols-3">
        <CountChips label="Kinds" counts={resultKindCounts} colorFor={(value) => KIND_COLORS[value]} />
        <CountChips label="Lifecycle status" counts={resultStatusCounts} colorFor={(value) => STATUS_COLORS[value]} />
        <CountChips
          label="Authority level"
          counts={resultAuthorityCounts}
          colorFor={(value) => AUTHORITY_COLORS[value]}
          formatter={formatAuthority}
        />
      </div>

      <form action="/artifacts" method="GET" className="mb-4">
        {kind && <input type="hidden" name="kind" value={kind} />}
        {status && <input type="hidden" name="status" value={status} />}
        {authority && <input type="hidden" name="authority" value={authority} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            name="q"
            defaultValue={search ?? ""}
            placeholder="Search title, key, or summary..."
            className="min-h-10 flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            type="submit"
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800"
          >
            Search
          </button>
        </div>
      </form>

      <div className="space-y-4 mb-6">
        <FilterGroup label="Sort">
          <FilterPill label="Newest" href={buildUrl({ sort: undefined })} active={!sort || sort === "newest"} />
          <FilterPill label="Title" href={buildUrl({ sort: "title" })} active={sort === "title"} />
          <FilterPill label="Authority" href={buildUrl({ sort: "authority" })} active={sort === "authority"} />
        </FilterGroup>
        <FilterGroup label="Kind">
          <FilterPill label="All kinds" href={buildUrl({ kind: undefined })} active={!kind} />
          {kinds.map((k) => (
            <FilterPill key={k} label={k} href={buildUrl({ kind: k })} active={kind === k} />
          ))}
        </FilterGroup>
        <FilterGroup label="Lifecycle status">
          <FilterPill label="All statuses" href={buildUrl({ status: undefined })} active={!status} />
          {statuses.map((s) => (
            <FilterPill key={s} label={s} href={buildUrl({ status: s })} active={status === s} />
          ))}
        </FilterGroup>
        <FilterGroup label="Authority level">
          <FilterPill label="All authority levels" href={buildUrl({ authority: undefined })} active={!authority} />
          {authorities.map((level) => (
            <FilterPill key={level} label={formatAuthority(level)} href={buildUrl({ authority: level })} active={authority === level} />
          ))}
        </FilterGroup>
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${AUTHORITY_COLORS[authorityLevel] ?? "bg-indigo-50 text-indigo-700"}`}>
                        authority: {formatAuthority(authorityLevel)}
                      </span>
                    )}
                    {scope && (
                      <span className={chipClass("blue")}>
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
            description={activeFilters.length > 0 ? "The active search, filters, or sort may be too narrow for the available artifact metadata." : "No artifacts are available."}
            clearHref="/artifacts"
          />
        )}
      </div>
    </div>
  );
}
