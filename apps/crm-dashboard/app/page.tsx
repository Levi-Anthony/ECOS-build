import { supabase } from "@/lib/supabase-server";
import { DOMAIN_COLORS, DOMAIN_LABELS, STATUS_COLORS, STATUS_LABELS } from "@/lib/supabase";
import type { Contact } from "@/lib/supabase";
import { isFollowUpSoon, isOverdue, aggregateObsCounts } from "@/lib/logic";
import { PageHeader, StatGrid, StatCard } from "@/lib/page-ui";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const { domain } = await searchParams;

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

  const contactRows = (contacts as Contact[] | null) ?? [];
  const totalContacts = contactRows.length;
  const overdueCount = contactRows.filter((c) => isOverdue(c.follow_up_date)).length;
  const dueSoonCount = contactRows.filter((c) => isFollowUpSoon(c.follow_up_date)).length;

  const domains = ["tango", "ttc", "outreach", "it", "music", "personal", "general"];

  return (
    <div>
      <PageHeader
        glyph="◍"
        glyphClass="text-blue-500"
        title="Contacts"
        summary={`${totalContacts} total`}
      />

      {/* Stats */}
      <StatGrid>
        <StatCard label="Total contacts" value={totalContacts} />
        <StatCard label="Follow-up due soon" value={dueSoonCount} />
        <StatCard label="Overdue follow-ups" value={overdueCount} highlight={overdueCount > 0} />
      </StatGrid>

      {/* Domain filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        <a
          href="/"
          className={`inline-flex min-h-10 min-w-[40px] items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${!domain ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
        >
          All
        </a>
        {domains.map((d) => (
          <a
            key={d}
            href={`/?domain=${d}`}
            className={`inline-flex min-h-10 min-w-[40px] items-center px-3 py-1 rounded-full text-sm font-medium transition-colors ${domain === d ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-400"}`}
          >
            {DOMAIN_LABELS[d]}
          </a>
        ))}
      </div>

      {error && (
        <p className="text-red-600 text-sm mb-4">Error loading contacts: {error.message}</p>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="divide-y divide-gray-100 md:hidden">
          {(contacts as Contact[] | null)?.map((contact) => {
            const followUpSoon = isFollowUpSoon(contact.follow_up_date);
            const overdue = isOverdue(contact.follow_up_date);
            return (
              <article
                key={contact.id}
                className={`p-4 ${contact.administrative_status === "administrative_closed" ? "opacity-50" : ""} ${overdue ? "bg-red-50" : followUpSoon ? "bg-amber-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={`/contacts/${contact.id}`} className="inline-flex min-h-10 min-w-[40px] items-center font-medium text-blue-600 hover:text-blue-800 [overflow-wrap:anywhere]">
                      {contact.name}
                    </a>
                    {(contact.company || contact.title) && (
                      <p className="text-sm text-gray-500 [overflow-wrap:anywhere]">
                        {contact.company}{contact.company && contact.title && " · "}{contact.title}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {Array.isArray(contact.thought_links) && contact.thought_links.length > 0 && (
                      <a
                        href={`/brain?q=${encodeURIComponent(contact.name)}`}
                        className="inline-flex min-h-10 min-w-[40px] items-center justify-center text-xs font-medium text-purple-600 hover:text-purple-800"
                        title={`${contact.thought_links.length} BRAIN link(s) — search BRAIN`}
                      >
                        ◆{contact.thought_links.length}
                      </a>
                    )}
                    {obsCountMap[contact.id] > 0 && (
                      <a
                        href={`/contacts/${contact.id}#observations`}
                        className="inline-flex min-h-10 min-w-[40px] items-center justify-center text-xs font-medium text-emerald-600 hover:text-emerald-800"
                        title={`${obsCountMap[contact.id]} observation(s)`}
                      >
                        ◉{obsCountMap[contact.id]}
                      </a>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[contact.relationship_domain] ?? "bg-gray-100 text-gray-700"}`}>
                    {DOMAIN_LABELS[contact.relationship_domain] ?? contact.relationship_domain}
                  </span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[contact.administrative_status] ?? "bg-gray-100 text-gray-700"}`}>
                    {STATUS_LABELS[contact.administrative_status] ?? contact.administrative_status}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-gray-400">Follow-up</dt>
                    <dd className={overdue ? "font-medium text-red-600" : followUpSoon ? "font-medium text-amber-600" : "text-gray-600"}>
                      {contact.follow_up_date ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-gray-400">Last contact</dt>
                    <dd className="text-gray-600">
                      {contact.last_contacted ? new Date(contact.last_contacted).toLocaleDateString() : "—"}
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
          {(!contacts || contacts.length === 0) && (
            <div className="p-8 text-center text-gray-400">No contacts found.</div>
          )}
        </div>
        <table className="hidden w-full text-sm md:table">
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
