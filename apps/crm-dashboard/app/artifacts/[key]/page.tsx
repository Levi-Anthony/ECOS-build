import { supabase } from "@/lib/supabase-server";
import type { Artifact, ArtifactBlock, ArtifactLink, ArtifactRevision } from "@/lib/supabase";
import { relativeAge } from "@/lib/logic";
import { ReviewHeader, chipClass, type ReviewChip, type ReviewField } from "@/lib/review-ui";
import { Markdown } from "@/lib/markdown";
import { CopyButton } from "@/lib/copy-button";
import { editArtifactBlockAction, updateArtifactGovernanceAction } from "@/app/artifacts/actions";
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

// Reconstruct a standalone markdown document from the ordered blocks:
// artifact title as an H1, then each block as an H2 section (title or path) + its content.
const buildFullDoc = (title: string, blocks: ArtifactBlock[]): string => {
  const sections = blocks.map((b) => `## ${b.title ?? b.path}\n\n${b.content}`);
  return [`# ${title}`, ...sections].join("\n\n");
};

export default async function ArtifactDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: encodedKey } = await params;
  const key = decodeURIComponent(encodedKey);

  const { data: artifactRow, error } = await supabase
    .from("artifacts")
    .select("id, key, title, kind, status, review_policy, current_version, metadata, created_at, updated_at")
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
    .select("id, artifact_id, version, base_version, ops, summary, actor, actor_type, actor_id, source_refs, created_at")
    .eq("artifact_id", artifact.id)
    .order("version", { ascending: false })
    .limit(50);

  const { data: linkRows } = await supabase
    .from("artifact_links")
    .select("id, artifact_id, linked_type, linked_id, relationship_type, note, created_at")
    .eq("artifact_id", artifact.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const { data: proposalRows } = await supabase
    .from("artifact_change_proposals")
    .select("id, status, summary, created_at")
    .eq("artifact_id", artifact.id)
    .in("status", ["pending", "revision_requested", "conflicted"])
    .order("created_at", { ascending: false })
    .limit(20);

  const blocks = (blockRows ?? []) as ArtifactBlock[];
  const revisions = (revisionRows ?? []) as ArtifactRevision[];
  const links = (linkRows ?? []) as ArtifactLink[];
  const openProposals = (proposalRows ?? []) as Array<{ id: string; status: string; summary: string; created_at: string }>;

  const idsByType = (linkedType: ArtifactLink["linked_type"]) =>
    links.filter((link) => link.linked_type === linkedType).map((link) => link.linked_id);
  const [thoughtRows, contactRows, entityRows, opportunityRows] = await Promise.all([
    idsByType("thought").length
      ? supabase.from("thoughts").select("id, content").in("id", idsByType("thought"))
      : Promise.resolve({ data: [] }),
    idsByType("contact").length
      ? supabase.from("professional_contacts").select("id, name").in("id", idsByType("contact"))
      : Promise.resolve({ data: [] }),
    idsByType("entity").length
      ? supabase.from("entities").select("id, name, entity_type").in("id", idsByType("entity"))
      : Promise.resolve({ data: [] }),
    idsByType("opportunity").length
      ? supabase.from("opportunities").select("id, title").in("id", idsByType("opportunity"))
      : Promise.resolve({ data: [] }),
  ]);
  const linkedLabels = new Map<string, string>([
    ...(thoughtRows.data ?? []).map((row) => [row.id, row.content.length > 140 ? `${row.content.slice(0, 140)}...` : row.content] as const),
    ...(contactRows.data ?? []).map((row) => [row.id, row.name] as const),
    ...(entityRows.data ?? []).map((row) => [row.id, `${row.name} (${row.entity_type})`] as const),
    ...(opportunityRows.data ?? []).map((row) => [row.id, row.title] as const),
  ]);

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
    artifact.review_policy ? { label: `review: ${artifact.review_policy}`, tone: artifact.review_policy === "human_gate" ? "indigo" : "gray" } : null,
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
    openProposals.length > 0 ? { label: `${openProposals.length} open proposal${openProposals.length === 1 ? "" : "s"}`, tone: "amber", title: "Artifact has pending, revision-requested, or conflicted proposals." } : null,
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
      <a href="/artifacts" className="inline-flex min-h-10 items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
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

      {openProposals.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Open review proposals</h2>
              <p className="text-sm text-amber-800 mt-1">Proposed changes have not altered the current artifact.</p>
            </div>
            <a href="/artifacts/review" className="inline-flex min-h-10 items-center text-sm font-medium text-amber-900 hover:text-amber-700">
              Open review inbox
            </a>
          </div>
          <div className="mt-3 space-y-2">
            {openProposals.map((proposal) => (
              <a key={proposal.id} href={`/artifacts/review/${proposal.id}`} className="block rounded border border-amber-200 bg-white px-3 py-2 text-sm text-gray-800 hover:border-amber-400">
                <span className="font-medium">{proposal.summary}</span>
                <span className="ml-2 text-xs text-gray-500">{proposal.status.replaceAll("_", " ")}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <details className="bg-white rounded-lg border border-gray-200 mb-6">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-gray-900">
          Human governance controls
          <span className="text-xs font-normal text-gray-400">authority · lifecycle · review policy</span>
        </summary>
        <form action={updateArtifactGovernanceAction} className="border-t border-gray-100 p-4 grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="key" value={artifact.key} />
          <input type="hidden" name="base_version" value={artifact.current_version} />
          <input type="hidden" name="current_status" value={artifact.status} />
          <input type="hidden" name="current_review_policy" value={artifact.review_policy} />
          <input type="hidden" name="current_authority" value={authorityLevel ?? "evidence"} />
          <label className="text-sm text-gray-700">
            <span className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Authority</span>
            <select name="authority_level" defaultValue={authorityLevel ?? "evidence"} className="min-h-10 w-full rounded-lg border border-gray-200 px-3">
              {["evidence", "draft", "proposed_instruction", "approved_instruction", "policy"].map((value) => (
                <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Lifecycle</span>
            <select name="status" defaultValue={artifact.status} className="min-h-10 w-full rounded-lg border border-gray-200 px-3">
              {["active", "draft", "archived", "superseded"].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Review policy</span>
            <select name="review_policy" defaultValue={artifact.review_policy} className="min-h-10 w-full rounded-lg border border-gray-200 px-3">
              <option value="live_audit">live audit</option>
              <option value="human_gate">human gate</option>
            </select>
          </label>
          <label className="sm:col-span-3 text-sm text-gray-700">
            <span className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Change reason</span>
            <input name="reason" required className="min-h-10 w-full rounded-lg border border-gray-200 px-3" placeholder="Why this authority or lifecycle change is appropriate" />
          </label>
          <div className="sm:col-span-3">
            <button className="min-h-10 rounded-lg bg-emerald-800 px-4 text-sm font-medium text-white hover:bg-emerald-700">
              Apply human governance change
            </button>
          </div>
        </form>
      </details>

      <details className="lg:hidden bg-white rounded-lg border border-gray-200 mb-6">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-gray-900">
          <span>Blocks</span>
          <span className="text-xs font-normal text-gray-400">{blocks.length}</span>
        </summary>
        <div className="border-t border-gray-100 p-3">
          {blockNav.length > 0 ? (
            <ol className="space-y-1">
              {blockNav.map((block, index) => (
                <li key={block.id}>
                  <a
                    href={`#${block.id}`}
                    className="flex min-h-10 flex-col justify-center rounded px-2 py-2 text-xs hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                  >
                    <span>
                      <span className="font-mono text-gray-400 mr-1">{index + 1}.</span>
                      <span className="font-mono text-gray-700 break-all">{block.path}</span>
                    </span>
                    {block.title && (
                      <span className="pl-5 pt-0.5 text-gray-500 line-clamp-2">{block.title}</span>
                    )}
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-gray-400">No blocks.</p>
          )}
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-1">
            {links.length > 0 && (
              <a
                href="#linked-records"
                className="flex min-h-10 items-center rounded px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
              >
                Linked records
              </a>
            )}
            <a
              href="#revision-history"
              className="flex min-h-10 items-center rounded px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
            >
              Revision history
            </a>
          </div>
        </div>
      </details>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
        <main className="min-w-0">
          {/* Blocks — the review surface */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-sm text-gray-500 uppercase tracking-wide">
              Blocks ({blocks.length})
            </h2>
            {blocks.length > 0 && (
              <CopyButton text={buildFullDoc(artifact.title, blocks)} label="Copy all" copiedLabel="Copied all" />
            )}
          </div>
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <a
                          href={`#${id}`}
                          className="inline-flex min-h-10 min-w-10 items-center font-mono text-xs text-gray-500 hover:text-gray-800 break-all"
                        >
                          {b.path}
                        </a>
                        {b.title && <h3 className="text-sm font-semibold text-gray-900 mt-1">{b.title}</h3>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 flex-shrink-0 text-xs text-gray-400">
                        {archived && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            archived
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">v{b.version}</span>
                        {b.content_hash && <span className="font-mono">{b.content_hash.slice(0, 8)}</span>}
                        <CopyButton text={b.content} label="Copy" />
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <Markdown>{b.content}</Markdown>
                  </div>
                  {!archived && (
                    <details className="border-t border-gray-100">
                      <summary className="flex min-h-10 cursor-pointer list-none items-center px-4 py-3 text-xs font-medium text-gray-500 hover:text-gray-900">
                        Edit block as human
                      </summary>
                      <form action={editArtifactBlockAction} className="border-t border-gray-100 p-4 space-y-3">
                        <input type="hidden" name="key" value={artifact.key} />
                        <input type="hidden" name="base_version" value={artifact.current_version} />
                        <input type="hidden" name="path" value={b.path} />
                        <input type="hidden" name="expected_hash" value={b.content_hash ?? ""} />
                        <textarea
                          name="content"
                          rows={14}
                          defaultValue={b.content}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                        <input
                          name="reason"
                          required
                          placeholder="Describe the human edit"
                          className="min-h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                        />
                        <button className="min-h-10 rounded-lg bg-emerald-800 px-4 text-sm font-medium text-white hover:bg-emerald-700">
                          Save new accepted version
                        </button>
                      </form>
                    </details>
                  )}
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
              const linkedLabel = linkedLabels.get(link.linked_id);
              const href = linkedLabel ? linkedHref(link) : null;
              const body = (
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={chipClass("blue")}>artifact_link: {link.relationship_type}</span>
                    <span className={chipClass("gray")}>{link.linked_type}</span>
                    <span className="text-xs text-gray-400">{new Date(link.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="font-mono text-xs text-gray-600 break-all">{link.linked_id}</p>
                  {linkedLabel ? (
                    <p className="text-sm font-medium text-gray-800 mt-1">{linkedLabel}</p>
                  ) : (
                    <p className="text-xs font-medium text-red-700 mt-1">Target record not found</p>
                  )}
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
                  <div key={r.id} className="p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                    <div className="text-left sm:text-right flex-shrink-0 text-xs text-gray-400 space-y-1">
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

        <aside className="hidden lg:block lg:sticky lg:top-4 lg:self-start">
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
                      className="flex min-h-10 flex-col justify-center rounded px-2 py-2 text-xs hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                    >
                      <span>
                        <span className="font-mono text-gray-400 mr-1">{index + 1}.</span>
                        <span className="font-mono text-gray-700 break-all">{block.path}</span>
                      </span>
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
                  className="flex min-h-10 items-center rounded px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
                >
                  Linked records
                </a>
              )}
              <a
                href="#revision-history"
                className="flex min-h-10 items-center rounded px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
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
