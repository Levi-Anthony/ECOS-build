// Pure, side-effect-free logic extracted from page files.
// All date-dependent functions accept an optional `now` parameter so tests
// can pin time without monkey-patching Date.

// ─── Date helpers ────────────────────────────────────────────────────────────

export function isOverdue(date: string | null, now = new Date()): boolean {
  if (!date) return false;
  return new Date(date) < now;
}

export function isFollowUpSoon(date: string | null, now = new Date()): boolean {
  if (!date) return false;
  const followUp = new Date(date);
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + 7);
  return followUp <= threshold;
}

export function relativeAge(iso: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// Arizona never observes DST — MST is UTC-7 year-round.
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const mst = new Date(d.getTime() - 7 * 60 * 60 * 1000);
  return mst.toISOString().slice(11, 16);
}

export function formatDayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function weekLabel(now = new Date()): string {
  const end = now;
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

// Returns an ISO date string (YYYY-MM-DD) for the cold-contact threshold.
export function coldContactThreshold(daysAgo: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

// ─── Data aggregations ───────────────────────────────────────────────────────

export function aggregateObsCounts(
  rows: { contact_id: string }[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.contact_id] = (map[row.contact_id] ?? 0) + 1;
  }
  return map;
}

// Returns the most recent service_date per contact.
// Expects rows already sorted by service_date DESC so the first hit per
// contact_id is the latest.
export function aggregateLastService(
  rows: { contact_id: string; service_date: string }[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!map[row.contact_id]) map[row.contact_id] = row.service_date;
  }
  return map;
}

export function aggregateUnbilled(
  rows: { contact_id: string; time_spent_minutes?: number | null }[]
): Record<string, { count: number; totalMin: number }> {
  const map: Record<string, { count: number; totalMin: number }> = {};
  for (const row of rows) {
    if (!map[row.contact_id]) map[row.contact_id] = { count: 0, totalMin: 0 };
    map[row.contact_id].count++;
    map[row.contact_id].totalMin += row.time_spent_minutes ?? 0;
  }
  return map;
}

// ─── People intel status ─────────────────────────────────────────────────────

export type IntelStatus = "unseeded" | "needs_snap" | "stale" | "current";

export type ObsAgg = {
  total: number;
  lastObserved: string;
  facts: number;
  interpretations: number;
  strategies: number;
};

export type SnapInfo = {
  version: number;
  created_at: string;
  obsAtCompile: number;
};

export type StalenessResult = {
  daysSince: number;
  newObsSince: number;
  stale: boolean;
};

export function computeStaleness(
  snap: SnapInfo,
  obsTotal: number,
  now = new Date()
): StalenessResult {
  const daysSince = Math.floor(
    (now.getTime() - new Date(snap.created_at).getTime()) / 86400000
  );
  const newObsSince = obsTotal - snap.obsAtCompile;
  const stale = daysSince > 30 || newObsSince >= 5;
  return { daysSince, newObsSince, stale };
}

export function computeIntelStatus(
  obs: ObsAgg | undefined | null,
  snap: SnapInfo | undefined | null,
  now = new Date()
): IntelStatus {
  if (!obs) return "unseeded";
  if (!snap) return "needs_snap";
  const { stale } = computeStaleness(snap, obs.total, now);
  return stale ? "stale" : "current";
}
