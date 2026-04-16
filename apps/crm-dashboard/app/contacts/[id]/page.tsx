import { supabase, Contact, Interaction, Opportunity, ThoughtLink, DOMAIN_COLORS, DOMAIN_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/supabase";
import { notFound } from "next/navigation";

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const [contactRes, interactionsRes, oppsRes] = await Promise.all([
    supabase
      .from("professional_contacts")
      .select("*")
      .eq("id", params.id)
      .single(),
    supabase
      .from("contact_interactions")
      .select("id, interaction_type, summary, follow_up_notes, follow_up_needed, occurred_at")
      .eq("contact_id", params.id)
      .order("occurred_at", { ascending: false })
      .limit(30),
    supabase
      .from("opportunities")
      .select("id, title, stage, value, expected_close_date, notes")
      .eq("contact_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  if (contactRes.error || !contactRes.data) notFound();

  const contact: Contact = contactRes.data;
  const interactions = (interactionsRes.data ?? []) as Interaction[];
  const opportunities = (oppsRes.data ?? []) as Opportunity[];
  const thoughtLinks: ThoughtLink[] = Array.isArray(contact.thought_links) ? contact.thought_links : [];

  const STAGE_COLORS: Record<string, string> = {
    prospect: "bg-gray-100 text-gray-700",
    qualified: "bg-blue-100 text-blue-800",
    proposal: "bg-purple-100 text-purple-800",
    closed_won: "bg-green-100 text-green-800",
    closed_lost: "bg-red-100 text-red-800",
  };

  return (
    <div className="max-w-4xl">
      {/* Back */}
      <a href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block">← All Contacts</a>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">{contact.name}</h1>
            {(contact.company || contact.title) && (
              <p className="text-gray-500 mt-1">
                {contact.title}{contact.title && contact.company && " · "}{contact.company}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${DOMAIN_COLORS[contact.relationship_domain] ?? "bg-gray-100 text-gray-700"}`}>
              {DOMAIN_LABELS[contact.relationship_domain] ?? contact.relationship_domain}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[contact.administrative_status] ?? "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[contact.administrative_status] ?? contact.administrative_status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {contact.email && (
            <div>
              <span className="text-gray-500">Email</span>
              <p><a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline">{contact.email}</a></p>
            </div>
          )}
          {contact.phone && (
            <div>
              <span className="text-gray-500">Phone</span>
              <p>{contact.phone}</p>
            </div>
          )}
          {contact.follow_up_date && (
            <div>
              <span className="text-gray-500">Follow-up</span>
              <p className={new Date(contact.follow_up_date) < new Date() ? "text-red-600 font-medium" : ""}>{contact.follow_up_date}</p>
            </div>
          )}
          {contact.last_contacted && (
            <div>
              <span className="text-gray-500">Last contacted</span>
              <p>{new Date(contact.last_contacted).toLocaleDateString()}</p>
            </div>
          )}
        </div>

        {contact.tags?.length > 0 && (
          <div className="mt-4 flex gap-1.5 flex-wrap">
            {contact.tags.map((tag: string) => (
              <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{tag}</span>
            ))}
          </div>
        )}

        {contact.notes && (
          <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-700">
            {contact.notes}
          </div>
        )}
      </div>

      {/* Opportunities */}
      {opportunities.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold mb-3">Opportunities</h2>
          <div className="space-y-2">
            {opportunities.map((opp: Opportunity) => (
              <div key={opp.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <span className="font-medium text-sm">{opp.title}</span>
                  {opp.notes && <p className="text-xs text-gray-500 mt-0.5">{opp.notes}</p>}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {opp.value && <span className="text-gray-600">${opp.value.toLocaleString()}</span>}
                  {opp.expected_close_date && <span className="text-gray-500">{opp.expected_close_date}</span>}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[opp.stage] ?? "bg-gray-100 text-gray-700"}`}>
                    {opp.stage.replace("_", " ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BRAIN Links */}
      {thoughtLinks.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold mb-3">
            <span className="text-purple-600">◆</span> BRAIN Links ({thoughtLinks.length})
          </h2>
          <div className="space-y-2">
            {thoughtLinks.map((link: ThoughtLink) => (
              <div key={link.thought_id} className="py-2 border-b border-gray-50 last:border-0">
                <p className="text-sm text-gray-700">{link.content_preview}</p>
                <p className="text-xs text-gray-400 mt-1">{new Date(link.linked_at).toLocaleDateString()} · {link.thought_id}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interaction Timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-4">Interactions ({interactions.length})</h2>
        {interactions.length === 0 ? (
          <p className="text-gray-400 text-sm">No interactions logged.</p>
        ) : (
          <div className="space-y-3">
            {interactions.map((i: Interaction) => (
              <div key={i.id} className="flex gap-3">
                <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-400"></div>
                <div className="flex-1 pb-3 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{i.interaction_type.replace("_", " ")}</span>
                    <span className="text-xs text-gray-400">{new Date(i.occurred_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-gray-800">{i.summary}</p>
                  {i.follow_up_notes && (
                    <p className="text-xs text-amber-700 mt-1">Follow-up: {i.follow_up_notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
