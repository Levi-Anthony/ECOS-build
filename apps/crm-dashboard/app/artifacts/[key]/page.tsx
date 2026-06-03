import { supabase, Artifact, ArtifactBlock, ArtifactRevision } from "@/lib/supabase";
import { notFound } from "next/navigation";

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

// jsonb metadata is loosely typed — read fields with guards.
const str = (meta: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const v = meta?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};
const strArray = (meta: Record<string, unknown> | null | undefined, key: string): string[] => {
  const v = meta?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};

export default async function ArtifactDetailPage({ params }: { params: { key: string } }) {
  const key = decodeURIComponent(params.key);

  const { data: artifactRow, error } = await supabase
    .from("artifacts")
    .select("id, key, title, kind, status, current_version, metadata, created_at, updated_at")
    .eq("key", key)
    .maybeSingle();

  if (error || !artifactRow) notFound();

  const artifact = artifactRow as Artifact;
  const meta = artifact.metadata ?? {};

  const { data: blockRows } = await supabase
    .from("artifact_blocks")
    .select("id, artifact_id, path, title, content, content_hash, version, sort_order, metadata, updated_at")
    .eq("artifact_id", artifact.id)
    .order("sort_order", { ascending: true })
    .order("path", { ascending: true });

  const { data: revisionRows } = await supabase
    .from("artifact_revisions")
    .select("id, artifact_id, version, base_version, ops, summary, actor, created_at")
    .eq("artifact_id", artifact.id)
    .order("version", { ascending: false })
    .limit(50);

  const blocks = (blockRows ?? []) as ArtifactBlock[];
  const revisions = (revisionRows ?? []) as ArtifactRevision[];

  const authorityLevel = str(meta, "authority_level");
  const scope = str(meta, "scope");
  const domain = str(meta, "domain");
  const tags = strArray(meta, "tags");
  const migratedFrom = str(meta, "migrated_from") ?? str(meta, "legacy_doc_type");
  const summary = str(meta, "summary");

  return (
    <div className="max-w-3xl">
      <a href="/artifacts" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        ← Artifacts
      </a>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-2">{artifact.title}</h1>
        <p className="font-mono text-xs text-gray-500 mb-3 break-all">{artifact.key}</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {artifact.kind && (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${KIND_COLORS[artifact.kind] ?? "bg-gray-100 text-gray-700"}`}>
              {artifact.kind}
            </span>
          )}
          {artifact.status && (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[artifact.status] ?? "bg-gray-100 text-gray-700"}`}>
              {artifact.status}
            </span>
          )}
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            v{artifact.current_version}
          </span>
          {migratedFrom && (
            <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700" title={migratedFrom}>
              migrated
            </span>
          )}
        </div>
        {summary && <p className="text-sm text-gray-700 leading-relaxed mb-3">{summary}</p>}
        <div className="flex flex-wrap gap-2">
          {authorityLevel && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
              authority: {authorityLevel}
            </span>
          )}
          {scope && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              scope: {scope}
            </span>
          )}
          {domain && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700">
              {domain}
            </span>
          )}
          {tags.map((t) => (
            <span key={t} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
              {t}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Updated {new Date(artifact.updated_at).toLocaleDateString()} · Created{" "}
          {new Date(artifact.created_at).toLocaleDateString()}
        </p>
      </div>

      {/* Blocks — the review surface */}
      <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
        Blocks ({blocks.length})
      </h2>
      <div className="space-y-3 mb-6">
        {blocks.map((b) => {
          const archived = str(b.metadata, "status") === "archived";
          return (
            <div
              key={b.id}
              className={`bg-white rounded-lg border border-gray-200 p-4 ${archived ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-mono text-xs text-gray-500">{b.path}</span>
                  {b.title && <span className="text-sm font-medium text-gray-800">{b.title}</span>}
                  {archived && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      archived
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 text-xs text-gray-400">
                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">v{b.version}</span>
                  {b.content_hash && <span className="font-mono">{b.content_hash.slice(0, 8)}</span>}
                </div>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{b.content}</p>
            </div>
          );
        })}
        {blocks.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
            No blocks.
          </div>
        )}
      </div>

      {/* Revision history — the immutable ledger */}
      <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
        Revision history ({revisions.length})
      </h2>
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 mb-6">
        {revisions.map((r) => {
          const opCount = Array.isArray(r.ops) ? r.ops.length : 0;
          return (
            <div key={r.id} className="p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                    v{r.version}
                  </span>
                  {r.base_version !== null && (
                    <span className="text-xs text-gray-400">from v{r.base_version}</span>
                  )}
                  {r.actor && <span className="text-xs text-gray-500">{r.actor}</span>}
                </div>
                {r.summary && <p className="text-sm text-gray-700 mt-1">{r.summary}</p>}
              </div>
              <div className="text-right flex-shrink-0 text-xs text-gray-400 space-y-1">
                <p>{new Date(r.created_at).toLocaleDateString()}</p>
                <p>{opCount} op{opCount === 1 ? "" : "s"}</p>
              </div>
            </div>
          );
        })}
        {revisions.length === 0 && (
          <div className="p-6 text-center text-gray-400 text-sm">No revisions.</div>
        )}
      </div>

      {/* Artifact ID — copyable */}
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Artifact ID</p>
        <p className="font-mono text-sm text-gray-800 select-all break-all">{artifact.id}</p>
      </div>
    </div>
  );
}
