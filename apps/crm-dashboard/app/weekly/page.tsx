import { supabase, DOMAIN_COLORS, DOMAIN_LABELS, Briefing } from "@/lib/supabase";

const BRAIN_DOMAINS = [
  "ecos-architecture",
  "tango-pedagogy",
  "ttc-board",
  "neil-outreach",
  "it-consulting",
  "music-production",
  "brain-protocol",
  "personal",
];

const BRAIN_DOMAIN_LABELS: Record<string, string> = {
  "ecos-architecture": "ECOS Arch",
  "tango-pedagogy": "Tango",
  "ttc-board": "TTC",
  "neil-outreach": "Neil",
  "it-consulting": "IT",
  "music-production": "Music",
  "brain-protocol": "BRAIN",
  "personal": "Personal",
};

const BRAIN_DOMAIN_COLORS: Record<string, string> = {
  "ecos-architecture": "bg-slate-100 text-slate-700",
  "tango-pedagogy": "bg-rose-100 text-rose-800",
  "ttc-board": "bg-orange-100 text-orange-800",
  "neil-outreach": "bg-amber-100 text-amber-800",
  "it-consulting": "bg-blue-100 text-blue-800",
  "music-production": "bg-purple-100 text-purple-800",
  "brain-protocol": "bg-cyan-100 text-cyan-800",
  "personal": "bg-green-100 text-green-800",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-800",
  proposal: "bg-amber-100 text-amber-800",
  closed_won: "bg-green-100 text-green-800",
  closed_lost: "bg-red-100 text-red-800",
};

function relativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function weekLabel(): string {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function WeeklyPage() {
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const today = now.toISOString().split("T")[0];
  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];

  const [
    { data: captures },
    { data: openLoops },
    { data: followUps },
    { data: opps },
    { data: recentBriefings },
  ] = await Promise.all([
    supabase
      .from("thoughts")
      .select("id, created_at, metadata")
      .gte("created_at", weekAgo.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("thoughts")
      .select("id, content, created_at, metadata")
      .eq("metadata->>type", "task")
      .eq("metadata->>horizon", "immediate")
      .gte("created_at", twoWeeksAgo.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("professional_contacts")
      .select("id, name, relationship_domain, follow_up_date, last_contacted")
      .gte("follow_up_date", today)
      .lte("follow_up_date", nextWeekStr)
      .not("follow_up_date", "is", null)
      .eq("administrative_status", "active")
      .order("follow_up_date", { ascending: true }),
    supabase
      .from("opportunities")
      .select("id, title, stage, value, close_date")
      .not("stage", "in", '("closed_won","closed_lost")')
      .order("close_date", { ascending: true }),
    supabase
      .from("life_engine_briefings")
      .select("id, user_responded, created_at")
      .gte("created_at", weekAgo.toISOString()),
  ]);

  // BRAIN domain summary
  const domainCounts: Record<string, number> = {};
  const domainLatest: Record<string, string> = {};
  for (const t of captures ?? []) {
    const d = (t.metadata as { domain?: string })?.domain;
    if (!d) continue;
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
    if (!domainLatest[d] || t.created_at > domainLatest[d]) {
      domainLatest[d] = t.created_at;
    }
  }
  const staleDomains = BRAIN_DOMAINS.filter((d) => !domainCounts[d]);

  // Briefing stats
  const briefingTotal = recentBriefings?.length ?? 0;
  const briefingResponded = recentBriefings?.filter((b) => b.user_responded).length ?? 0;
  const briefingRate = briefingTotal ? Math.round((briefingResponded / briefingTotal) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Weekly Review</h1>
        <span className="text-sm text-gray-500">{weekLabel()}</span>
      </div>

      {/* Section 1 — BRAIN Activity */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">
          BRAIN Activity
          <span className="font-normal text-gray-400 ml-2 text-sm">({captures?.length ?? 0} captures this week)</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BRAIN_DOMAINS.map((domain) => {
            const count = domainCounts[domain] ?? 0;
            const latest = domainLatest[domain];
            const stale = count === 0;
            return (
              <div
                key={domain}
                className={`bg-white rounded-lg border border-gray-200 p-3 ${stale ? "opacity-40" : ""}`}
              >
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${BRAIN_DOMAIN_COLORS[domain]}`}>
                    {BRAIN_DOMAIN_LABELS[domain]}
                  </span>
                  {stale && (
                    <span className="text-xs text-gray-400 font-medium">Stale</span>
                  )}
                </div>
                <p className="text-lg font-semibold text-gray-900 mt-1">{count}</p>
                <p className="text-xs text-gray-400">
                  {latest ? relativeAge(latest) : "No captures"}
                </p>
              </div>
            );
          })}
        </div>
        {staleDomains.length > 0 && (
          <p className="text-xs text-gray-400 mt-2">
            Stale: {staleDomains.map((d) => BRAIN_DOMAIN_LABELS[d]).join(", ")}
          </p>
        )}
      </section>

      {/* Section 2 — Open Loops */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">
          Open Loops
          <span className="font-normal text-gray-400 ml-2 text-sm">(immediate tasks, last 14 days)</span>
        </h2>
        {!openLoops?.length ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">
            No open immediate tasks — clear.
          </div>
        ) : (
          <div className="space-y-2">
            {openLoops.map((t) => {
              const domain = (t.metadata as { domain?: string })?.domain;
              return (
                <div key={t.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-start gap-3">
                  {domain && (
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${BRAIN_DOMAIN_COLORS[domain] ?? "bg-gray-100 text-gray-700"}`}>
                      {BRAIN_DOMAIN_LABELS[domain] ?? domain}
                    </span>
                  )}
                  <p className="text-sm text-gray-700 line-clamp-2 flex-1">{t.content}</p>
                  <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{relativeAge(t.created_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3 — Follow-ups This Week */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">
          Follow-ups This Week
        </h2>
        {!followUps?.length ? (
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-400">
            Nothing due this week.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-50">
            {followUps.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <a href={`/contacts/${c.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                    {c.name}
                  </a>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${DOMAIN_COLORS[c.relationship_domain] ?? "bg-gray-100 text-gray-700"}`}>
                    {DOMAIN_LABELS[c.relationship_domain] ?? c.relationship_domain}
                  </span>
                </div>
                <span className={`text-sm font-medium ${c.follow_up_date < today ? "text-red-600" : "text-gray-600"}`}>
                  {c.follow_up_date}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 4 — Active Opportunities */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Active Opportunities</h2>
        {!opps?.length ? (
          <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-400">
            No active opportunities.
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Title</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Stage</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Value</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Close</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {opps.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{o.title}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[o.stage] ?? "bg-gray-100 text-gray-700"}`}>
                        {o.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {o.value != null ? `$${Number(o.value).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {o.close_date ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 5 — Pulse */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Life Engine</h2>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-600">
            {briefingTotal} briefings sent · {briefingResponded} responded ({briefingRate}%) this week
          </span>
          <a href="/briefings" className="text-sm text-blue-600 hover:text-blue-800">View all →</a>
        </div>
      </section>
    </div>
  );
}
