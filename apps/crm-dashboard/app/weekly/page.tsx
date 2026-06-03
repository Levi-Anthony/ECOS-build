import { supabase } from "@/lib/supabase-server";
import { DOMAIN_COLORS, DOMAIN_LABELS, STAGE_COLORS, BRAIN_DOMAIN_COLORS, BRAIN_DOMAIN_LABELS } from "@/lib/supabase";
import type { Briefing } from "@/lib/supabase";
import { relativeAge, weekLabel, aggregateUnbilled } from "@/lib/logic";

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
    { data: unbilledLogs },
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
    supabase
      .from("it_service_logs")
      .select("contact_id, time_spent_minutes")
      .eq("billable", true)
      .eq("billed", false),
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

  // IT unbilled aggregation
  const unbilledByContact = aggregateUnbilled(unbilledLogs ?? []);
  const totalUnbilledMin = (unbilledLogs ?? []).reduce((s, l) => s + (l.time_spent_minutes ?? 0), 0);
  const unbilledContactIds = Object.keys(unbilledByContact);
  let unbilledContactNames: Record<string, string> = {};
  if (unbilledContactIds.length > 0) {
    const { data: nameRows } = await supabase
      .from("professional_contacts")
      .select("id, name")
      .in("id", unbilledContactIds);
    for (const row of nameRows ?? []) unbilledContactNames[row.id] = row.name;
  }

  // Briefing stats
  const briefingTotal = recentBriefings?.length ?? 0;
  const briefingResponded = recentBriefings?.filter((b) => b.user_responded).length ?? 0;
  const briefingRate = briefingTotal ? Math.round((briefingResponded / briefingTotal) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
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
                <div key={t.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
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
              <div key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/contacts/${c.id}`} className="inline-flex min-h-10 items-center text-sm font-medium text-blue-600 hover:text-blue-800 [overflow-wrap:anywhere]">
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
            <div className="divide-y divide-gray-100 md:hidden">
              {opps.map((o) => (
                <article key={o.id} className="p-4">
                  <p className="font-medium text-gray-900 [overflow-wrap:anywhere]">{o.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[o.stage] ?? "bg-gray-100 text-gray-700"}`}>
                      {o.stage}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs uppercase text-gray-400">Value</dt>
                      <dd className="text-gray-600">{o.value != null ? `$${Number(o.value).toLocaleString()}` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase text-gray-400">Close</dt>
                      <dd className="text-gray-600">{o.close_date ?? "—"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <table className="hidden w-full text-sm md:table">
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

      {/* Section 5 — IT Unbilled */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">IT Unbilled</h2>
        {totalUnbilledMin === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700">
            No unbilled IT work — clear.
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-amber-800">
                {(totalUnbilledMin / 60).toFixed(1)} hrs unbilled across {unbilledContactIds.length} client{unbilledContactIds.length !== 1 ? "s" : ""}
              </span>
              <a href="/it" className="inline-flex min-h-10 items-center text-sm text-blue-600 hover:text-blue-800">View IT →</a>
            </div>
            <div className="space-y-1.5">
              {unbilledContactIds.map((cid) => {
                const { count, totalMin } = unbilledByContact[cid];
                return (
                  <div key={cid} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <a href={`/it/${cid}`} className="inline-flex min-h-10 items-center text-blue-600 hover:text-blue-800 [overflow-wrap:anywhere]">
                      {unbilledContactNames[cid] ?? cid}
                    </a>
                    <span className="text-amber-700">{count} log{count !== 1 ? "s" : ""} · {(totalMin / 60).toFixed(1)}h</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Section 6 — Pulse */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Life Engine</h2>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-gray-600">
            {briefingTotal} briefings sent · {briefingResponded} responded ({briefingRate}%) this week
          </span>
          <a href="/briefings" className="inline-flex min-h-10 items-center text-sm text-blue-600 hover:text-blue-800">View all →</a>
        </div>
      </section>
    </div>
  );
}
