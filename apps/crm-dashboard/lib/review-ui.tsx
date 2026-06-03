type Tone = "gray" | "amber" | "red" | "emerald" | "blue" | "indigo" | "purple";

const TONE_CLASSES: Record<Tone, string> = {
  gray: "bg-gray-100 text-gray-700",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  emerald: "bg-emerald-100 text-emerald-800",
  blue: "bg-blue-50 text-blue-700",
  indigo: "bg-indigo-50 text-indigo-700",
  purple: "bg-purple-50 text-purple-700",
};

export type ReviewChip = {
  label: string;
  tone?: Tone;
  title?: string;
};

export type ReviewField = {
  label: string;
  value: string;
  mono?: boolean;
};

export function chipClass(tone: Tone = "gray"): string {
  return `px-2 py-0.5 rounded-full text-xs font-medium [overflow-wrap:anywhere] ${TONE_CLASSES[tone]}`;
}

export function ReviewHeader({
  eyebrow,
  title,
  subtitle,
  chips,
  warnings,
  fields,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  chips: ReviewChip[];
  warnings: ReviewChip[];
  fields: ReviewField[];
}) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 mb-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{eyebrow}</p>
          <h1 className="text-lg font-semibold text-gray-900 leading-snug">{title}</h1>
          {subtitle && <p className="font-mono text-xs text-gray-500 mt-1 break-all">{subtitle}</p>}
        </div>
        {warnings.length > 0 && (
          <div className="flex flex-wrap gap-1.5 sm:justify-end sm:flex-shrink-0 sm:max-w-xs">
            {warnings.map((warning) => (
              <span key={warning.label} className={chipClass(warning.tone ?? "amber")} title={warning.title}>
                {warning.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {chips.map((chip) => (
          <span key={chip.label} className={chipClass(chip.tone)} title={chip.title}>
            {chip.label}
          </span>
        ))}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {fields.map((field) => (
          <div key={field.label}>
            <dt className="text-xs text-gray-500 uppercase tracking-wide">{field.label}</dt>
            <dd className={`font-medium text-gray-800 break-words ${field.mono ? "font-mono text-xs" : ""}`}>
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ActiveFilterSummary({
  filters,
  clearHref,
  resultCount,
}: {
  filters: ReviewChip[];
  clearHref: string;
  resultCount: number;
}) {
  if (filters.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Active filters</span>
        {filters.map((filter) => (
          <span key={filter.label} className={chipClass(filter.tone)} title={filter.title}>
            {filter.label}
          </span>
        ))}
        <span className="text-xs text-gray-400">{resultCount} shown</span>
      </div>
      <a href={clearHref} className="inline-flex min-h-10 items-center text-xs font-medium text-gray-500 hover:text-gray-900 sm:flex-shrink-0">
        Clear all
      </a>
    </div>
  );
}

export function EmptyReviewState({
  title,
  description,
  clearHref,
}: {
  title: string;
  description: string;
  clearHref: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="text-sm text-gray-400 mt-1">{description}</p>
      <a href={clearHref} className="inline-block mt-3 text-sm font-medium text-gray-600 hover:text-gray-900">
        Broaden search
      </a>
    </div>
  );
}
