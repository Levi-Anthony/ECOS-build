import { supabase } from "@/lib/supabase-server";
import type { Artifact, ArtifactBlock, ArtifactLink, ArtifactRevision } from "@/lib/supabase";
import { relativeAge } from "@/lib/logic";
import { ReviewHeader, chipClass, type ReviewChip, type ReviewField } from "@/lib/review-ui";
import { Markdown } from "@/lib/markdown";
import { notFound } from "next/navigation";

// jsonb metadata is loosely typed — read fields with guards.
const str = (meta: Record<string, unknown> | null | undefined, key: string): string | undefined => {
  const v = meta?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};
const strArray = (meta: Record<string, unknown> | null | undefined, key: string): string[] => {
  const v = meta?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
const anchorId = (path: string, index: number) => {
  const slug = path
    .replace(/^\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `block-${index + 1}${slug ? `-${slug}` : ""}`;
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

  const { data: linkRows } = await supabase
    .from("artifact_links")
    .select("id, artifact_id, linked_type, linked_id, relationship_type, note, created_at")
    .eq("artifact_id", artifact.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const blocks = (blockRows ?? []) as ArtifactBlock[];
  const revisions = (revisionRows ?? []) as ArtifactRevision[];
  const links = (linkRows ?? []) as ArtifactLink[];

  const authorityLevel = str(meta, "authority_level");
  const scope = str(meta, "scope");
  const domain = str(meta, "domain");
  const tags = strArray(meta, "tags");
  const migratedFrom = str(meta, "migrated_from") ?? str(meta, "legacy_doc_type");
  const summary = str(meta, "summary");
  const targetRuntime = str(meta, "target_runtime");

  const reviewChips = ([
    artifact.kind ? { label: `kind: ${artifact.kind}`, tone: "purple" } : null,
    artifact.status ? { label: `status: ${artifact.status}`, tone: artifact.status === "active" ? "emerald" : "gray" } : null,
    { label: `v${artifact.current_version}` },
    authorityLevel ? { label: `authority: ${authorityLevel}`, tone: "indigo" } : null,
    scope ? { label: `scope: ${scope}`, tone: "blue" } : null,
    domain ? { label: domain, tone: "blue" } : null,
  ] as Array<ReviewChip | null>).filter((x): x is ReviewChip => x !== null);

  const warnings = ([
    migratedFrom ? { label: "migrated", tone: "amber", title: `Migrated from ${migratedFrom}` } : null,
    artifact.status !== "active" ? { label: artifact.status, tone: "red", title: "Artifact status is not active." } : null,
    !summary ? { label: "missing summary", tone: "amber", title: "No metadata.summary is stored on this artifact." } : null,
    blocks.length === 0 ? { label: "no blocks", tone: "red", title: "No current artifact_blocks rows found." } : null,
    revisions.length === 0 ? { label: "no revisions", tone: "amber", title: "No artifact_revisions rows found." } : null,
  ] as Array<ReviewChip | null>).filter((x): x is ReviewChip => x !== null);

  const reviewFields: ReviewField[] = [
    { label: "Updated", value: `${new Date(artifact.updated_at).toLocaleDateString()} (${relativeAge(artifact.updated_at)})` },
    { label: "Created", value: new Date(artifact.created_at).toLocaleDateString() },
    { label: "Blocks", value: String(blocks.length) },
    { label: "Revisions", value: String(revisions.length) },
  ];

  const linkedHref = (link: ArtifactLink) => {
    if (link.linked_type === "thought") return `/brain/${link.linked_id}`;
    if (link.linked_type === "contact") return `/contacts/${link.linked_id}`;
    return null;
  };
  const blockNav = blocks.map((block, index) => ({
    id: anchorId(block.path, index),
    path: block.path,
    title: block.title,
  }));

  return (
    <div className="max-w-6xl">
      <a href="/artifacts" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">
        ← Artifacts
      </a>

      <ReviewHeader
        eyebrow="Artifact review state"
        title={artifact.title}
        subtitle={artifact.key}
        chips={reviewChips}
        warnings={warnings}
        fields={reviewFields}
      />

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Summary and metadata</h2>
        {summary ? (
          <p className="text-sm text-gray-700 leading-relaxed mb-3">{summary}</p>
        ) : (
          <p className="text-sm text-gray-400 mb-3">No stored summary.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {migratedFrom && <span className={chipClass("amber")}>migrated_from: {migratedFrom}</span>}
          {targetRuntime && <span className={chipClass("gray")}>runtime: {targetRuntime}</span>}
          {tags.map((t) => (
            <span key={t} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
        <main className="min-w-0">
          {/* Blocks — the review surface */}
          <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
            Blocks ({blocks.length})
          </h2>
          <div className="space-y-4 mb-8">
            {blocks.map((b, index) => {
              const archived = str(b.metadata, "status") === "archived";
              const id = anchorId(b.path, index);
              return (
                <section
                  key={b.id}
                  id={id}
                  className={`scroll-mt-4 bg-white rounded-lg border border-gray-200 ${
                    archived ? "opacity-60" : ""
                  }`}
                >
                  <div className="border-b border-gray-100 px-4 py-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <a
                          href={`#${id}`}
                          className="font-mono text-xs text-gray-500 hover:text-gray-800 break-all"
                        >
                          {b.path}
                        </a>
                        {b.title && <h3 className="text-sm font-semibold text-gray-900 mt-1">{b.title}</h3>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 text-xs text-gray-400">
                        {archived && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            archived
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">v{b.version}</span>
                        {b.content_hash && <span className="font-mono">{b.content_hash.slice(0, 8)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <Markdown>{b.content}</Markdown>
                  </div>
                </section>
              );
            })}
            {blocks.length === 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
                No blocks.
              </div>
            )}
          </div>

          {/* Continuity */}
          <h2
            id="linked-records"
            className="scroll-mt-4 font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide"
          >
            Linked records ({links.length})
          </h2>
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 mb-8">
            {links.map((link) => {
              const href = linkedHref(link);
              const body = (
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={chipClass("blue")}>artifact_link: {link.relationship_type}</span>
                    <span className={chipClass("gray")}>{link.linked_type}</span>
                    <span className="text-xs text-gray-400">{new Date(link.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="font-mono text-xs text-gray-600 break-all">{link.linked_id}</p>
                  {link.note && <p className="text-sm text-gray-700 mt-1">{link.note}</p>}
                </div>
              );

              return href ? (
                <a key={link.id} href={href} className="block p-4 hover:bg-gray-50 transition-colors">
                  {body}
                </a>
              ) : (
                <div key={link.id} className="p-4">
                  {body}
                </div>
              );
            })}
            {links.length === 0 && (
              <div className="p-6 text-center text-gray-400 text-sm">No explicit artifact_links rows.</div>
            )}
          </div>

          {/* Revision history — the immutable ledger */}
          <div
            id="revision-history"
            className="scroll-mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4 mb-6"
          >
            <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
              Revision history ({revisions.length})
            </h2>
            <div className="bg-white rounded-md border border-gray-200 divide-y divide-gray-100">
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
          </div>

          {/* Artifact ID — copyable */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Artifact ID</p>
            <p className="font-mono text-sm text-gray-800 select-all break-all">{artifact.id}</p>
          </div>
        </main>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <nav className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-semibold text-sm text-gray-900">Blocks</h2>
              <span className="text-xs text-gray-400">{blocks.length}</span>
            </div>
            {blockNav.length > 0 ? (
              <ol className="space-y-1">
                {blockNav.map((block, index) => (
                  <li key={block.id}>
                    <a
                      href={`#${block.id}`}
                      className="block rounded px-2 py-1.5 text-xs hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                    >
                      <span className="font-mono text-gray-400 mr-1">{index + 1}.</span>
                      <span className="font-mono text-gray-700 break-all">{block.path}</span>
                      {block.title && (
                        <span className="block pl-5 pt-0.5 text-gray-500 line-clamp-2">{block.title}</span>
                      )}
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-gray-400">No blocks.</p>
            )}
            <div className="mt-4 border-t border-gray-100 pt-3 space-y-1">
              {links.length > 0 && (
                <a
                  href="#linked-records"
                  className="block rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Linked records
                </a>
              )}
              <a
                href="#revision-history"
                className="block rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Revision history
              </a>
            </div>
          </nav>
        </aside>
      </div>
    </div>
  );
}
