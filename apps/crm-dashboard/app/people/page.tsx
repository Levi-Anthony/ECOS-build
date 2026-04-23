import { supabase, DOMAIN_COLORS, DOMAIN_LABELS } from "@/lib/supabase";

type IntelStatus = "unseeded" | "needs_snap" | "stale" | "current";

const STATUS_CHIP: Record<IntelStatus, string> = {
  unseeded: "bg-gray-100 text-gray-500",
  needs_snap: "bg-amber-100 text-amber-800",
  stale: "bg-amber-100 text-amber-800",
  current: "bg-emerald-100 text-emerald-800",
};

const STATUS_LABEL: Record<IntelStatus, string> = {
  unseeded: "Unseeded",
  needs_snap: "Needs Snapshot",
  stale: "Stale",
  current: "Current",
};

function relativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const filter = searchParams?.filter ?? "all";

  const [contactsRes, obsRes, snapRes] = await Promise.all([
    supabase
      .from("professional_contacts")
      .select("id, name, relationship_domain, administrative_status")
      .order("name", { ascending: true }),
    supabase
      .from("person_observations")
      .select("contact_id, observation_type, observed_at"),
    supabase
      .from("person_snapshots")
      .select("contact_id, version, created_at, source_observation_ids, is_current")
      .eq("is_current", true),
  ]);

  const contacts = contactsRes.data ?? [];

  // Aggregate observations per contact
  type ObsAgg = {
    total: number;
    lastObserved: string;
    facts: number;
    interpretations: number;
    strategies: number;
  };
  const obsMap: Record<string, ObsAgg> = {};
  for (const row of obsRes.data ?? []) {
    if (!obsMap[row.contact_id]) {
      obsMap[row.contact_id] = { total: 0, lastObserved: row.observed_at, facts: 0, interpretations: 0, strategies: 0 };
    }
    const agg = obsMap[row.contact_id];
    agg.total++;
    if (row.observed_at > agg.lastObserved) agg.lastObserved = row.observed_at;
    if (row.observation_type === "fact") agg.facts++;
    if (row.observation_type === "interpretation") agg.interpretations++;
    if (row.observation_type === "strategy") agg.strategies++;
  }

  // Index snapshots
  type SnapInfo = { version: number; created_at: string; obsAtCompile: number };
  const snapMap: Record<string, SnapInfo> = {};
  for (const row of snapRes.data ?? []) {
    snapMap[row.contact_id] = {
      version: row.version,
      created_at: row.created_at,
      obsAtCompile: Array.isArray(row.source_observation_ids) ? row.source_observation_ids.length : 0,
    };
  }

  // Compute per-contact intel status
  const enriched = contacts.map((c) => {
    const obs = obsMap[c.id];
    const snap = snapMap[c.id];

    let status: IntelStatus;
    let daysSinceSnap: number | null = null;
    let newObsSince: number | null = null;

    if (!obs) {
      status = "unseeded";
    } else if (!snap) {
      status = "needs_snap";
    } else {
      daysSinceSnap = Math.floor((Date.now() - new Date(snap.created_at).getTime()) / 86400000);
      newObsSince = obs.total - snap.obsAtCompile;
      status = (daysSinceSnap > 30 || newObsSince >= 5) ? "stale" : "current";
    }

    return { ...c, obs, snap, status, daysSinceSnap, newObsSince };
  });

  // Filter
  const visible = enriched.filter((c) => {
    if (filter === "unseeded") return c.status === "unseeded";
    if (filter === "seeded") return c.status !== "unseeded";
    if (filter === "attention") return c.status === "unseeded" || c.status === "needs_snap" || c.status === "stale";
    return true;
  });

  // Sort: attention-first, then by last observed descending
  const statusOrder: Record<IntelStatus, number> = { unseeded: 0, needs_snap: 1, stale: 2, current: 3 };
  visible.sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    if (!a.obs && !b.obs) return 0;
    if (!a.obs) return 1;
    if (!b.obs) return -1;
    return b.obs.lastObserved.localeCompare(a.obs.lastObserved);
  });

  // Stats
  const totalSeeded = enriched.filter((c) => c.status !== "unseeded").length;
  const totalSnapped = enriched.filter((c) => c.snap).length;
  const totalAttention = enriched.filter((c) => ["unseeded", "needs_snap", "stale"].includes(c.status)).length;

  const FILTER_LABELS: Record<string, string> = {
    all: "All",
    attention: "Needs Attention",
    seeded: "Seeded",
    unseeded: "Unseeded",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">
          <span className="text-emerald-500">◉</span> People Intel
        </h1>
        <span className="text-sm text-gray-500">{totalSeeded} seeded · {totalAttention} need attention</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Contacts with intel</p>
          <p className="text-2xl font-semibold mt-1">{totalSeeded}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Snapshots compiled</p>
          <p className="text-2xl font-semibold mt-1">{totalSnapped}</p>
        </div>
        <div className={`rounded-lg border p-4 ${totalAttention > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-gray-200"}`}>
          <p className={`text-sm ${totalAttention > 0 ? "text-amber-700" : "text-gray-500"}`}>Need attention</p>
          <p className={`text-2xl font-semibold mt-1 ${totalAttention > 0 ? "text-amber-800" : ""}`}>{totalAttention}</p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-6">
        {Object.entries(FILTER_LABELS).map(([key, label]) => (
          <a
            key={key}
            href={`/people${key !== "all" ? `?filter=${key}` : ""}`}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${filter === key ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          {filter === "unseeded"
            ? "All contacts have been seeded."
            : filter === "attention"
            ? "No contacts need attention — everything is current."
            : "No contacts found. Run the seeding pipeline for your first contact."}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Domain</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Intel Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Observations</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last observed</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${c.administrative_status === "administrative_closed" ? "opacity-40" : ""}`}
                >
                  <td className="px-4 py-3">
                    <a href={`/contacts/${c.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                      {c.name}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[c.relationship_domain] ?? "bg-gray-100 text-gray-700"}`}>
                      {DOMAIN_LABELS[c.relationship_domain] ?? c.relationship_domain}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {c.obs ? (
                      <div>
                        <span className="font-medium">{c.obs.total}</span>
                        <span className="text-xs text-gray-400 ml-1">
                          {[
                            c.obs.facts > 0 && `${c.obs.facts}f`,
                            c.obs.interpretations > 0 && `${c.obs.interpretations}i`,
                            c.obs.strategies > 0 && `${c.obs.strategies}s`,
                          ].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.obs ? relativeAge(c.obs.lastObserved) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.snap ? (
                      <div>
                        <span className="text-xs">v{c.snap.version} · {relativeAge(c.snap.created_at)}</span>
                        {(c.newObsSince ?? 0) > 0 && (
                          <span className="ml-1 text-xs text-amber-500">+{c.newObsSince} new</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
