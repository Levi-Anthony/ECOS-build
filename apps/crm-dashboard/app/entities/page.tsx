import { supabase } from "@/lib/supabase-server";
import type { Entity, EntityLink } from "@/lib/supabase";
import { ActiveFilterSummary, EmptyReviewState, chipClass, type ReviewChip } from "@/lib/review-ui";
import { countEntityLinks, entityMatchesSearch, formatEntityType } from "@/lib/entity-browser";
import { PageHeader, StatCard, StatGrid } from "@/lib/page-ui";

const TYPE_COLORS: Record<string, string> = {
  person: "bg-blue-100 text-blue-800",
  organization: "bg-violet-100 text-violet-800",
  governance_body: "bg-purple-100 text-purple-800",
  project: "bg-amber-100 text-amber-800",
  team: "bg-teal-100 text-teal-800",
  faction: "bg-orange-100 text-orange-800",
  event: "bg-rose-100 text-rose-800",
  artifact: "bg-indigo-100 text-indigo-800",
};

const countBy = (rows: Entity[], getValue: (row: Entity) => string): Array<[string, number]> => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(getValue(row), (counts.get(getValue(row)) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string; sort?: string }>;
}) {
  const { q, type, status, sort } = await searchParams;
  const search = q?.trim() ?? "";

  const [entitiesRes, linksRes] = await Promise.all([
    supabase
      .from("entities")
      .select("id, name, entity_type, aliases, description, metadata, status, tags, created_at, updated_at")
      .order("updated_at", { ascending: false }),
    supabase
      .from("entity_links")
      .select("id, from_entity_id, to_entity_id, relationship_type, notes, metadata, created_at"),
  ]);

  const allRows = (entitiesRes.data ?? []) as Entity[];
  const links = (linksRes.data ?? []) as EntityLink[];
  const linkCounts = countEntityLinks(links);
  const rows = allRows
    .filter((entity) => {
      if (type && entity.entity_type !== type) return false;
      if (status && entity.status !== status) return false;
      return entityMatchesSearch(entity, search);
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "relationships") return (linkCounts.get(b.id) ?? 0) - (linkCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name);
      return b.updated_at.localeCompare(a.updated_at);
    });

  const types = countBy(allRows, (entity) => entity.entity_type);
  const statuses = countBy(allRows, (entity) => entity.status);
  const activeFilters = ([
    type ? { label: `type: ${formatEntityType(type)}`, tone: "purple" } : null,
    status ? { label: `status: ${status}`, tone: status === "active" ? "emerald" : "gray" } : null,
    search ? { label: `search: ${search}`, tone: "blue" } : null,
    sort === "name" ? { label: "sort: name", tone: "gray" } : null,
    sort === "relationships" ? { label: "sort: relationships", tone: "gray" } : null,
  ] as Array<ReviewChip | null>).filter((filter): filter is ReviewChip => filter !== null);

  const buildUrl = (overrides: { q?: string; type?: string; status?: string; sort?: string }) => {
    const params = new URLSearchParams();
    const merged = { q: search || undefined, type, status, sort, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return `/entities${query ? `?${query}` : ""}`;
  };

  const FilterPill = ({ label, href, active }: { label: string; href: string; active: boolean }) => (
    <a
      href={href}
      className={`inline-flex min-h-10 items-center rounded-full px-3 py-1 text-sm font-medium transition-colors ${
        active ? "bg-gray-900 text-white" : "border border-gray-200 bg-white text-gray-600 hover:border-gray-400"
      }`}
    >
      {label}
    </a>
  );

  return (
    <div>
      <PageHeader glyph="◇" glyphClass="text-violet-600" title="Entities" summary={`${rows.length} shown · ${allRows.length} total`} />

      <StatGrid cols={4}>
        <StatCard label="Matching entities" value={rows.length} />
        <StatCard label="Active" value={rows.filter((entity) => entity.status === "active").length} />
        <StatCard label="Entity types" value={new Set(rows.map((entity) => entity.entity_type)).size} />
        <StatCard label="Relationships" value={links.length} />
      </StatGrid>

      <form action="/entities" method="GET" className="mb-4">
        {type && <input type="hidden" name="type" value={type} />}
        {status && <input type="hidden" name="status" value={status} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            name="q"
            defaultValue={search}
            placeholder="Search names, descriptions, aliases, or tags..."
            className="min-h-10 flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button className="inline-flex min-h-10 items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800">
            Search
          </button>
        </div>
      </form>

      <div className="space-y-4 mb-6">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Sort</p>
          <div className="flex flex-wrap gap-2">
            <FilterPill label="Recently updated" href={buildUrl({ sort: undefined })} active={!sort} />
            <FilterPill label="Name" href={buildUrl({ sort: "name" })} active={sort === "name"} />
            <FilterPill label="Relationships" href={buildUrl({ sort: "relationships" })} active={sort === "relationships"} />
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Type</p>
          <div className="flex flex-wrap gap-2">
            <FilterPill label="All types" href={buildUrl({ type: undefined })} active={!type} />
            {types.map(([entityType, count]) => (
              <FilterPill
                key={entityType}
                label={`${formatEntityType(entityType)} (${count})`}
                href={buildUrl({ type: entityType })}
                active={type === entityType}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</p>
          <div className="flex flex-wrap gap-2">
            <FilterPill label="All statuses" href={buildUrl({ status: undefined })} active={!status} />
            {statuses.map(([entityStatus, count]) => (
              <FilterPill
                key={entityStatus}
                label={`${entityStatus} (${count})`}
                href={buildUrl({ status: entityStatus })}
                active={status === entityStatus}
              />
            ))}
          </div>
        </div>
      </div>

      <ActiveFilterSummary filters={activeFilters} clearHref="/entities" resultCount={rows.length} />

      {(entitiesRes.error || linksRes.error) && (
        <p className="text-red-600 text-sm mb-4">
          Error loading entities: {entitiesRes.error?.message ?? linksRes.error?.message}
        </p>
      )}

      <div className="space-y-3">
        {rows.map((entity) => (
          <a
            key={entity.id}
            href={`/entities/${entity.id}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-violet-300 hover:shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">{entity.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[entity.entity_type] ?? "bg-gray-100 text-gray-700"}`}>
                    {formatEntityType(entity.entity_type)}
                  </span>
                  <span className={chipClass(entity.status === "active" ? "emerald" : "gray")}>{entity.status}</span>
                  <span className={chipClass("gray")}>{linkCounts.get(entity.id) ?? 0} relationships</span>
                </div>
                {entity.description && (
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {entity.description.length > 240 ? `${entity.description.slice(0, 240)}...` : entity.description}
                  </p>
                )}
                {(entity.aliases.length > 0 || entity.tags.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entity.aliases.slice(0, 4).map((alias) => <span key={`alias-${alias}`} className={chipClass("purple")}>{alias}</span>)}
                    {entity.tags.slice(0, 6).map((tag) => <span key={`tag-${tag}`} className={chipClass("blue")}>{tag}</span>)}
                  </div>
                )}
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">{new Date(entity.updated_at).toLocaleDateString()}</span>
            </div>
          </a>
        ))}
        {rows.length === 0 && !entitiesRes.error && (
          <EmptyReviewState
            title="No entities found."
            description={activeFilters.length > 0 ? "The active search or filters may be too narrow." : "No entities are available."}
            clearHref="/entities"
          />
        )}
      </div>
    </div>
  );
}
