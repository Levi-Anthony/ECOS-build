import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase-server";
import type { ArtifactLink, Contact, Entity, EntityLink } from "@/lib/supabase";
import { formatEntityType } from "@/lib/entity-browser";
import { relativeAge } from "@/lib/logic";
import { ReviewHeader, chipClass, type ReviewChip, type ReviewField } from "@/lib/review-ui";

type LinkedArtifact = {
  id: string;
  key: string;
  title: string;
  kind: string;
  status: string;
};

const displayMetadataValue = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

export default async function EntityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entityRes = await supabase
    .from("entities")
    .select("id, name, entity_type, aliases, description, metadata, status, tags, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (entityRes.error || !entityRes.data) notFound();
  const entity = entityRes.data as Entity;

  const [linksRes, contactsRes, artifactLinksRes] = await Promise.all([
    supabase
      .from("entity_links")
      .select("id, from_entity_id, to_entity_id, relationship_type, notes, metadata, created_at")
      .or(`from_entity_id.eq.${id},to_entity_id.eq.${id}`)
      .order("created_at", { ascending: false }),
    supabase
      .from("professional_contacts")
      .select("id, entity_id, name, company, title, relationship_domain, administrative_status")
      .eq("entity_id", id)
      .order("name", { ascending: true }),
    supabase
      .from("artifact_links")
      .select("id, artifact_id, linked_type, linked_id, relationship_type, note, created_at")
      .eq("linked_type", "entity")
      .eq("linked_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const links = (linksRes.data ?? []) as EntityLink[];
  const contacts = (contactsRes.data ?? []) as Contact[];
  const artifactLinks = (artifactLinksRes.data ?? []) as ArtifactLink[];
  const relatedEntityIds = Array.from(new Set(links.flatMap((link) => [link.from_entity_id, link.to_entity_id]).filter((linkedId) => linkedId !== id)));
  const artifactIds = Array.from(new Set(artifactLinks.map((link) => link.artifact_id)));

  const [relatedEntitiesRes, artifactsRes] = await Promise.all([
    relatedEntityIds.length
      ? supabase.from("entities").select("id, name, entity_type, status").in("id", relatedEntityIds)
      : Promise.resolve({ data: [] }),
    artifactIds.length
      ? supabase.from("artifacts").select("id, key, title, kind, status").in("id", artifactIds)
      : Promise.resolve({ data: [] }),
  ]);

  const relatedEntities = new Map(
    (relatedEntitiesRes.data ?? []).map((row) => [row.id, row] as const)
  );
  const artifacts = new Map(
    ((artifactsRes.data ?? []) as LinkedArtifact[]).map((artifact) => [artifact.id, artifact] as const)
  );
  const metadataEntries = Object.entries(entity.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const chips = ([
    { label: formatEntityType(entity.entity_type), tone: "purple" },
    { label: `status: ${entity.status}`, tone: entity.status === "active" ? "emerald" : "gray" },
    ...entity.tags.slice(0, 6).map((tag) => ({ label: tag, tone: "blue" as const })),
  ] as ReviewChip[]);
  const warnings = ([
    entity.status !== "active" ? { label: entity.status, tone: "red", title: "Entity status is not active." } : null,
    !entity.description ? { label: "missing description", tone: "amber", title: "No description is stored on this entity." } : null,
  ] as Array<ReviewChip | null>).filter((warning): warning is ReviewChip => warning !== null);
  const fields: ReviewField[] = [
    { label: "Updated", value: `${new Date(entity.updated_at).toLocaleDateString()} (${relativeAge(entity.updated_at)})` },
    { label: "Relationships", value: String(links.length) },
    { label: "Linked artifacts", value: String(artifactLinks.length) },
    { label: "Linked contacts", value: String(contacts.length) },
  ];

  return (
    <div className="max-w-5xl">
      <a href="/entities" className="inline-flex min-h-10 items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        ← Entities
      </a>

      <ReviewHeader
        eyebrow="Entity review state"
        title={entity.name}
        subtitle={entity.id}
        chips={chips}
        warnings={warnings}
        fields={fields}
      />

      <section className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
        <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Description</h2>
        {entity.description ? (
          <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{entity.description}</p>
        ) : (
          <p className="text-sm text-gray-400">No description.</p>
        )}
        {entity.aliases.length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">Aliases</p>
            <div className="flex flex-wrap gap-1.5">
              {entity.aliases.map((alias) => <span key={alias} className={chipClass("purple")}>{alias}</span>)}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white mb-6 overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Entity relationships ({links.length})</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {links.map((link) => {
            const outgoing = link.from_entity_id === entity.id;
            const otherId = outgoing ? link.to_entity_id : link.from_entity_id;
            const other = relatedEntities.get(otherId);
            return (
              <a key={link.id} href={`/entities/${otherId}`} className="block p-4 hover:bg-gray-50 transition-colors">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`font-medium [overflow-wrap:anywhere] ${outgoing ? "text-gray-900" : "text-violet-700"}`}>
                    {outgoing ? entity.name : other?.name ?? "Missing entity"}
                  </span>
                  <span className={chipClass("purple")}>{link.relationship_type.replaceAll("_", " ")}</span>
                  <span className="text-gray-400">→</span>
                  <span className={`font-medium [overflow-wrap:anywhere] ${outgoing ? "text-violet-700" : "text-gray-900"}`}>
                    {outgoing ? other?.name ?? "Missing entity" : entity.name}
                  </span>
                  {other?.entity_type && <span className={chipClass("gray")}>{formatEntityType(other.entity_type)}</span>}
                </div>
                {link.notes && <p className="text-sm text-gray-700 mt-2 leading-relaxed">{link.notes}</p>}
              </a>
            );
          })}
          {links.length === 0 && <p className="p-5 text-sm text-gray-400">No entity_links rows.</p>}
        </div>
      </section>

      <div className={`grid gap-6 mb-6 ${artifactLinks.length > 0 && contacts.length > 0 ? "lg:grid-cols-2" : ""}`}>
        <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Linked artifacts ({artifactLinks.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {artifactLinks.map((link) => {
              const artifact = artifacts.get(link.artifact_id);
              return artifact ? (
                <a key={link.id} href={`/artifacts/${encodeURIComponent(artifact.key)}`} className="block p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-violet-700 [overflow-wrap:anywhere]">{artifact.title}</span>
                    <span className={chipClass("gray")}>{artifact.kind}</span>
                    <span className={chipClass(artifact.status === "active" ? "emerald" : "gray")}>{artifact.status}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{link.relationship_type.replaceAll("_", " ")}</p>
                  {link.note && <p className="text-sm text-gray-700 mt-1">{link.note}</p>}
                </a>
              ) : (
                <div key={link.id} className="p-4 text-sm text-red-700">Target artifact not found: {link.artifact_id}</div>
              );
            })}
            {artifactLinks.length === 0 && <p className="p-5 text-sm text-gray-400">No linked artifacts.</p>}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="border-b border-gray-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Linked contacts ({contacts.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {contacts.map((contact) => (
              <a key={contact.id} href={`/contacts/${contact.id}`} className="block p-4 hover:bg-gray-50 transition-colors">
                <p className="text-sm font-medium text-blue-700">{contact.name}</p>
                {(contact.title || contact.company) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {contact.title}{contact.title && contact.company && " · "}{contact.company}
                  </p>
                )}
              </a>
            ))}
            {contacts.length === 0 && <p className="p-5 text-sm text-gray-400">No contacts point to this entity.</p>}
          </div>
        </section>
      </div>

      <details className="rounded-lg border border-gray-200 bg-white mb-6">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-semibold text-gray-900">
          Structured metadata
          <span className="text-xs font-normal text-gray-400">{metadataEntries.length} fields</span>
        </summary>
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {metadataEntries.map(([key, value]) => (
            <div key={key} className="grid gap-1 px-5 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <dt className="font-mono text-xs text-gray-500 break-all">{key}</dt>
              <dd className="text-sm text-gray-800 whitespace-pre-wrap break-words">{displayMetadataValue(value)}</dd>
            </div>
          ))}
          {metadataEntries.length === 0 && <p className="p-5 text-sm text-gray-400">No structured metadata.</p>}
        </div>
      </details>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Entity ID</p>
        <p className="font-mono text-sm text-gray-800 select-all break-all">{entity.id}</p>
      </div>
    </div>
  );
}
