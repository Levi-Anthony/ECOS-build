import type { ReactNode } from "react";

// Shared list-page chrome — encodes the People-Intel "bar" (colored-glyph heading +
// stat-card grid with an amber attention highlight) so list pages stay visually consistent.

export function PageHeader({
  glyph,
  glyphClass,
  title,
  summary,
}: {
  glyph?: string;
  glyphClass?: string;
  title: string;
  summary?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6">
      <h1 className="text-xl font-semibold">
        {glyph && <span className={glyphClass}>{glyph}</span>}
        {glyph && " "}
        {title}
      </h1>
      {summary !== undefined && <span className="text-sm text-gray-500">{summary}</span>}
    </div>
  );
}

export function StatGrid({
  cols = 3,
  children,
}: {
  cols?: 3 | 4;
  children: ReactNode;
}) {
  const gridCols =
    cols === 4
      ? "grid-cols-2 lg:grid-cols-4"
      : "grid-cols-1 sm:grid-cols-3";
  return <div className={`grid ${gridCols} gap-4 mb-6`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: ReactNode;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "bg-amber-50 border-amber-200" : "bg-white border-gray-200"}`}>
      <p className={`text-sm ${highlight ? "text-amber-700" : "text-gray-500"}`}>{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${highlight ? "text-amber-800" : ""}`}>{value}</p>
    </div>
  );
}
