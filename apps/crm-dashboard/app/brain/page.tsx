import { supabase } from "@/lib/supabase-server";
import type { Thought } from "@/lib/supabase";
import { ActiveFilterSummary, EmptyReviewState, chipClass, type ReviewChip } from "@/lib/review-ui";

const BRAIN_DOMAINS = [
  "ecos-architecture",
  "tango-pedagogy",
  "ttc-board",
  "neil-outreach",
  "it-consulting",
  "music-production",
  "brain-protocol",
  "personal",
] as const;

const BRAIN_TYPES = ["observation", "task", "idea", "reference", "person_note"] as const;
const BRAIN_HORIZONS = ["immediate", "project", "evergreen"] as const;
const BRAIN_SIGNALS = ["taste", "voice", "struct", "decision", "framework", "content"] as const;

const TYPE_ICONS: Record<string, string> = {
  observation: "👁",
  task: "✓",
  idea: "◈",
  reference: "⊕",
  person_note: "◉",
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

const HORIZON_COLORS: Record<string, string> = {
  immediate: "bg-red-100 text-red-700",
  project: "bg-yellow-100 text-yellow-700",
  evergreen: "bg-emerald-100 text-emerald-700",
};

const STATUS_COLORS: Record<string, string> = {
  current: "bg-emerald-100 text-emerald-800",
  superseded: "bg-gray-100 text-gray-600",
  archived: "bg-red-100 text-red-700",
};

export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; type?: string; horizon?: string; signal_type?: string; q?: string; sort?: string }>;
}) {
  const { domain, type, horizon, signal_type, q, sort } = await searchParams;

  let query = supabase
    .from("thoughts")
    .select("id, content, created_at, status, retrieval_count, source_id, metadata")
    .order(sort === "retrieval" ? "retrieval_count" : "created_at", { ascending: false })
    .limit(100);

  if (domain) query = query.eq("metadata->>domain", domain);
  if (type) query = query.eq("metadata->>type", type);
  if (horizon) query = query.eq("metadata->>horizon", horizon);
  if (signal_type) query = query.eq("metadata->>signal_type", signal_type);
  if (q) query = query.ilike("content", `%${q}%`);

  const { data: thoughts, error } = await query;
  const rows = (thoughts ?? []) as Thought[];

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { domain, type, horizon, signal_type, q, sort, ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return `/brain${s ? `?${s}` : ""}`;
  };

  const activeFilters = ([
    domain ? { label: `domain: ${domain}`, tone: "purple" } : null,
    type ? { label: `type: ${type}`, tone: "gray" } : null,
    horizon ? { label: `horizon: ${horizon}`, tone: "amber" } : null,
    signal_type ? { label: `signal: ${signal_type}`, tone: "indigo" } : null,
    q ? { label: `search: ${q}`, tone: "blue" } : null,
    sort === "retrieval" ? { label: "sort: most retrieved", tone: "gray" } : null,
  ] as Array<ReviewChip | null>).filter((x): x is ReviewChip => x !== null);

  const FilterPill = ({
    label,
    href,
    active,
  }: {
    label: string;
    href: string;
    active: boolean;
  }) => (
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
          <span className="text-purple-600">◆</span> BRAIN
        </h1>
        <div className="flex items-center gap-3">
          <a
            href={buildUrl({ sort: undefined })}
            className={`text-sm px-3 py-1 rounded-full border transition-colors ${
              !sort || sort !== "retrieval"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-400"
            }`}
          >
            Newest
          </a>
          <a
            href={buildUrl({ sort: "retrieval" })}
            className={`text-sm px-3 py-1 rounded-full border transition-colors ${
              sort === "retrieval"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white border-gray-200 text-gray-600 hover:border-gray-400"
            }`}
          >
            Most retrieved
          </a>
          <span className="text-sm text-gray-500">{rows.length} shown</span>
        </div>
      </div>

      {/* Keyword search */}
      <form action="/brain" method="GET" className="mb-4">
        {domain && <input type="hidden" name="domain" value={domain} />}
        {type && <input type="hidden" name="type" value={type} />}
        {horizon && <input type="hidden" name="horizon" value={horizon} />}
        {signal_type && <input type="hidden" name="signal_type" value={signal_type} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search content…"
          className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
        />
      </form>

      {/* Domain filter */}
      <div className="flex gap-2 flex-wrap mb-3">
        <FilterPill label="All domains" href={buildUrl({ domain: undefined })} active={!domain} />
        {BRAIN_DOMAINS.map((d) => (
          <FilterPill key={d} label={d} href={buildUrl({ domain: d })} active={domain === d} />
        ))}
      </div>

      {/* Type filter */}
      <div className="flex gap-2 flex-wrap mb-3">
        <FilterPill label="All types" href={buildUrl({ type: undefined })} active={!type} />
        {BRAIN_TYPES.map((t) => (
          <FilterPill key={t} label={t} href={buildUrl({ type: t })} active={type === t} />
        ))}
      </div>

      {/* Horizon + signal_type */}
      <div className="flex gap-2 flex-wrap mb-6">
        <FilterPill label="All horizons" href={buildUrl({ horizon: undefined })} active={!horizon} />
        {BRAIN_HORIZONS.map((h) => (
          <FilterPill key={h} label={h} href={buildUrl({ horizon: h })} active={horizon === h} />
        ))}
        <span className="w-px bg-gray-200 mx-1" />
        <FilterPill label="All signals" href={buildUrl({ signal_type: undefined })} active={!signal_type} />
        {BRAIN_SIGNALS.map((s) => (
          <FilterPill key={s} label={s} href={buildUrl({ signal_type: s })} active={signal_type === s} />
        ))}
      </div>

      <ActiveFilterSummary filters={activeFilters} clearHref="/brain" resultCount={rows.length} />

      {error && (
        <p className="text-red-600 text-sm mb-4">Error loading thoughts: {error.message}</p>
      )}

      <div className="space-y-3">
        {rows.map((t) => {
          const meta = t.metadata ?? {};
          const needsAttention = meta.needs_split || meta.metadata_fallback;
          return (
            <a
              key={t.id}
              href={`/brain/${t.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-purple-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    {meta.type && (
                      <span className="text-base" title={meta.type}>
                        {TYPE_ICONS[meta.type] ?? "·"}
                      </span>
                    )}
                    {meta.domain && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[meta.domain] ?? "bg-gray-100 text-gray-700"}`}>
                        {meta.domain}
                      </span>
                    )}
                    {meta.horizon && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${HORIZON_COLORS[meta.horizon] ?? "bg-gray-100 text-gray-700"}`}>
                        {meta.horizon}
                      </span>
                    )}
                    {t.status && t.status !== "current" && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {t.status}
                      </span>
                    )}
                    {needsAttention && (
                      <span className={chipClass("amber")} title={meta.needs_split ? "needs split" : "metadata fallback"}>
                        {meta.needs_split ? "needs split" : "metadata fallback"}
                      </span>
                    )}
                    <span
                      className={chipClass(t.source_id ? "blue" : "gray")}
                      title={t.source_id ? `source_id: ${t.source_id}` : "No source_id on this row"}
                    >
                      {t.source_id ? "source" : "no source"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 leading-relaxed">
                    {t.content.length > 200 ? t.content.slice(0, 200) + "…" : t.content}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {meta.topics?.map((topic: string) => (
                      <span key={topic} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                        {topic}
                      </span>
                    ))}
                    {meta.people?.map((person: string) => (
                      <span key={person} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                        {person}
                      </span>
                    ))}
                    {meta.signal_type && (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs">
                        {meta.signal_type}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 text-xs text-gray-400 space-y-1">
                  <p>{new Date(t.created_at).toLocaleDateString()}</p>
                  {t.retrieval_count > 0 && <p>{t.retrieval_count} retrievals</p>}
                </div>
              </div>
            </a>
          );
        })}
        {rows.length === 0 && !error && (
          <EmptyReviewState
            title="No thoughts found."
            description={activeFilters.length > 0 ? "The active filters may be too narrow or metadata may be incomplete." : "No BRAIN entries are available."}
            clearHref="/brain"
          />
        )}
      </div>
    </div>
  );
}
