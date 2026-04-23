import { supabase, Briefing } from "@/lib/supabase";

const BRIEFING_COLORS: Record<string, string> = {
  morning: "bg-amber-100 text-amber-800",
  pre_meeting: "bg-blue-100 text-blue-800",
  checkin: "bg-green-100 text-green-800",
  evening: "bg-indigo-100 text-indigo-800",
  habit_reminder: "bg-purple-100 text-purple-800",
  weekly_review: "bg-teal-100 text-teal-800",
  custom: "bg-gray-100 text-gray-700",
};

const BRIEFING_BAR: Record<string, string> = {
  morning: "bg-amber-400",
  pre_meeting: "bg-blue-400",
  checkin: "bg-green-400",
  evening: "bg-indigo-400",
  habit_reminder: "bg-purple-400",
  weekly_review: "bg-teal-400",
  custom: "bg-gray-400",
};

const BRIEFING_LABELS: Record<string, string> = {
  morning: "Morning",
  pre_meeting: "Pre-Meeting",
  checkin: "Check-in",
  evening: "Evening",
  habit_reminder: "Habit",
  weekly_review: "Weekly Review",
  custom: "Custom",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  // MST = UTC-7 (Arizona never observes DST)
  const mst = new Date(d.getTime() - 7 * 60 * 60 * 1000);
  return mst.toISOString().slice(11, 16);
}

function formatDayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default async function BriefingsPage() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const { data: briefings, error } = await supabase
    .from("life_engine_briefings")
    .select("id, briefing_type, content, delivered_via, user_responded, created_at")
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-red-600">Error: {error.message}</p>;
  }

  const all = (briefings ?? []) as Briefing[];
  const responded = all.filter((b) => b.user_responded).length;
  const responseRate = all.length ? Math.round((responded / all.length) * 100) : 0;

  // Group by UTC date (MST day shift only affects midnight edge — acceptable)
  const byDay: Record<string, Briefing[]> = {};
  for (const b of all) {
    const day = b.created_at.split("T")[0];
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(b);
  }
  const days = Object.keys(byDay).sort((a, z) => z.localeCompare(a));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Briefings</h1>
        <span className="text-sm text-gray-500">Last 14 days · {all.length} total · {responseRate}% responded</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Sent", value: all.length },
          { label: "Responded", value: responded },
          { label: "Response Rate", value: `${responseRate}%` },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {all.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          No briefings in the last 14 days. Is the life-engine running?
        </div>
      ) : (
        <div className="space-y-6">
          {days.map((day) => {
            const items = byDay[day];
            const dayResponded = items.filter((b) => b.user_responded).length;
            return (
              <div key={day}>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-sm font-semibold text-gray-700">{formatDayLabel(day)}</h2>
                  <span className="text-xs text-gray-400">{items.length} sent, {dayResponded} responded</span>
                </div>
                <div className="space-y-2">
                  {items.map((b) => (
                    <div key={b.id} className="bg-white rounded-lg border border-gray-200 flex overflow-hidden">
                      <div className={`w-1 flex-shrink-0 ${BRIEFING_BAR[b.briefing_type] ?? "bg-gray-300"}`} />
                      <div className="flex-1 px-4 py-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BRIEFING_COLORS[b.briefing_type] ?? "bg-gray-100 text-gray-700"}`}>
                            {BRIEFING_LABELS[b.briefing_type] ?? b.briefing_type}
                          </span>
                          <span className="text-xs text-gray-400">{formatTime(b.created_at)} MST</span>
                          <span className="ml-auto text-sm" title={b.user_responded ? "Responded" : "No response"}>
                            {b.user_responded ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-3 whitespace-pre-line">{b.content}</p>
                      </div>
                    </div>
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
