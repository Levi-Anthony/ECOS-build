import { supabase } from "@/lib/supabase-server";
import { DOMAIN_COLORS, DOMAIN_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/supabase";
import type { Contact } from "@/lib/supabase";
import { isFollowUpSoon, isOverdue, aggregateObsCounts } from "@/lib/logic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { domain?: string };
}) {
  const domain = searchParams?.domain;

  let query = supabase
    .from("professional_contacts")
    .select("id, name, company, title, email, relationship_domain, administrative_status, follow_up_date, last_contacted, tags, thought_links")
    .order("name", { ascending: true });

  if (domain) query = query.eq("relationship_domain", domain);

  const [{ data: contacts, error }, { data: obsRows }] = await Promise.all([
    query,
    supabase.from("person_observations").select("contact_id"),
  ]);

  const obsCountMap = aggregateObsCounts(obsRows ?? []);

  const domains = ["tango", "ttc", "outreach", "it", "music", "personal", "general"];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Contacts</h1>
        <span className="text-sm text-gray-500">{contacts?.length ?? 0} total</span>
      </div>

      {/* Domain filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        <a
          href="/"
          className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${!domain ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
        >
          All
        </a>
        {domains.map((d) => (
          <a
            key={d}
            href={`/?domain=${d}`}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${domain === d ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
          >
            {DOMAIN_LABELS[d]}
          </a>
        ))}
      </div>

      {error && (
        <p className="text-red-600 text-sm mb-4">Error loading contacts: {error.message}</p>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Company / Title</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Domain</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Follow-up</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Last Contact</th>
            </tr>
          </thead>
          <tbody>
            {(contacts as Contact[] | null)?.map((contact) => {
              const followUpSoon = isFollowUpSoon(contact.follow_up_date);
              const overdue = isOverdue(contact.follow_up_date);
              return (
                <tr
                  key={contact.id}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${contact.administrative_status === "administrative_closed" ? "opacity-40" : ""} ${overdue ? "bg-red-50 hover:bg-red-100" : followUpSoon ? "bg-amber-50 hover:bg-amber-100" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <a href={`/contacts/${contact.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                        {contact.name}
                      </a>
                      {Array.isArray(contact.thought_links) && contact.thought_links.length > 0 && (
                        <a
                          href={`/brain?q=${encodeURIComponent(contact.name)}`}
                          className="text-xs text-purple-500 hover:text-purple-700"
                          title={`${contact.thought_links.length} BRAIN link(s) — search BRAIN`}
                        >
                          ◆{contact.thought_links.length}
                        </a>
                      )}
                      {obsCountMap[contact.id] > 0 && (
                        <a
                          href={`/contacts/${contact.id}#observations`}
                          className="text-xs text-emerald-500 hover:text-emerald-700"
                          title={`${obsCountMap[contact.id]} observation(s)`}
                        >
                          ◉{obsCountMap[contact.id]}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {contact.company && <span>{contact.company}</span>}
                    {contact.company && contact.title && <span className="text-gray-400 mx-1">·</span>}
                    {contact.title && <span className="text-gray-500">{contact.title}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[contact.relationship_domain] ?? "bg-gray-100 text-gray-700"}`}>
                      {DOMAIN_LABELS[contact.relationship_domain] ?? contact.relationship_domain}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[contact.administrative_status] ?? "bg-gray-100 text-gray-700"}`}>
                      {STATUS_LABELS[contact.administrative_status] ?? contact.administrative_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {contact.follow_up_date ? (
                      <span className={overdue ? "text-red-600 font-medium" : followUpSoon ? "text-amber-600 font-medium" : ""}>
                        {contact.follow_up_date}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {contact.last_contacted ? (
                      new Date(contact.last_contacted).toLocaleDateString()
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!contacts || contacts.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No contacts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
