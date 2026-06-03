import { supabase } from "@/lib/supabase-server";
import { DOMAIN_COLORS, DOMAIN_LABELS } from "@/lib/supabase";
import type { Contact } from "@/lib/supabase";

export default async function FollowUpsPage() {
  const today = new Date().toISOString().split("T")[0];
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const futureStr = future.toISOString().split("T")[0];
  const coldThreshold = new Date();
  coldThreshold.setDate(coldThreshold.getDate() - 60);
  const coldThresholdStr = coldThreshold.toISOString().split("T")[0];

  const [{ data: contacts, error }, { data: coldContacts }] = await Promise.all([
    supabase
      .from("professional_contacts")
      .select("id, name, company, title, relationship_domain, follow_up_date, last_contacted, email")
      .lte("follow_up_date", futureStr)
      .not("follow_up_date", "is", null)
      .eq("administrative_status", "active")
      .order("follow_up_date", { ascending: true }),
    supabase
      .from("professional_contacts")
      .select("id, name, company, title, relationship_domain, last_contacted, email")
      .eq("administrative_status", "active")
      .is("follow_up_date", null)
      .or(`last_contacted.lt.${coldThresholdStr},last_contacted.is.null`)
      .order("last_contacted", { ascending: true, nullsFirst: true }),
  ]);

  if (error) {
    return <p className="text-red-600">Error: {error.message}</p>;
  }

  const overdue = contacts?.filter((c) => c.follow_up_date < today) ?? [];
  const upcoming = contacts?.filter((c) => c.follow_up_date >= today) ?? [];

  // Group upcoming by domain
  const byDomain: Record<string, Contact[]> = {};
  for (const c of upcoming) {
    const d = c.relationship_domain;
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(c as Contact);
  }

  const ContactRow = ({ contact }: { contact: Contact }) => (
    <div className="flex flex-col gap-2 py-2.5 border-b border-gray-50 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <a href={`/contacts/${contact.id}`} className="inline-flex min-h-10 min-w-[40px] items-center font-medium text-blue-600 hover:text-blue-800 text-sm [overflow-wrap:anywhere]">
          {contact.name}
        </a>
        {(contact.company || contact.title) && (
          <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
            {contact.title}{contact.title && contact.company && " · "}{contact.company}
          </p>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="text-xs text-gray-400 hover:text-gray-600 [overflow-wrap:anywhere]">{contact.email}</a>
        )}
      </div>
      <div className="flex-shrink-0 sm:ml-4 sm:text-right">
        <p className={`text-sm font-medium ${contact.follow_up_date! < today ? "text-red-600" : "text-gray-700"}`}>
          {contact.follow_up_date}
        </p>
        {contact.last_contacted && (
          <p className="text-xs text-gray-400 mt-0.5">Last: {new Date(contact.last_contacted).toLocaleDateString()}</p>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-xl font-semibold">Follow-Ups</h1>
        <span className="text-sm text-gray-500">Next 14 days</span>
      </div>

      {/* Overdue */}
      {overdue.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5 mb-6">
          <h2 className="font-semibold text-red-800 mb-3">Overdue ({overdue.length})</h2>
          <div>
            {overdue.map((c) => <ContactRow key={c.id} contact={c as Contact} />)}
          </div>
        </div>
      )}

      {/* Going Cold */}
      {(coldContacts?.length ?? 0) > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-6">
          <h2 className="font-semibold text-amber-800 mb-1">Going Cold ({coldContacts!.length})</h2>
          <p className="text-xs text-amber-600 mb-3">Active contacts with no follow-up date and last contact &gt;60 days ago (or never contacted)</p>
          <div>
            {coldContacts!.map((c) => (
              <div key={c.id} className="flex flex-col gap-2 py-2.5 border-b border-amber-100 last:border-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <a href={`/contacts/${c.id}`} className="inline-flex min-h-10 min-w-[40px] items-center font-medium text-blue-600 hover:text-blue-800 text-sm [overflow-wrap:anywhere]">
                    {c.name}
                  </a>
                  {(c.company || c.title) && (
                    <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
                      {c.title}{c.title && c.company && " · "}{c.company}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 sm:ml-4 sm:text-right">
                  <span className={`inline-flex px-1.5 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[c.relationship_domain] ?? "bg-gray-100 text-gray-700"}`}>
                    {DOMAIN_LABELS[c.relationship_domain] ?? c.relationship_domain}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">
                    {c.last_contacted ? `Last: ${new Date(c.last_contacted).toLocaleDateString()}` : "Never contacted"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming by domain */}
      {Object.keys(byDomain).length > 0 ? (
        <div className="space-y-4">
          {Object.entries(byDomain).map(([domain, domainContacts]) => (
            <div key={domain} className="bg-white rounded-lg border border-gray-200 p-5">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DOMAIN_COLORS[domain] ?? "bg-gray-100 text-gray-700"}`}>
                  {DOMAIN_LABELS[domain] ?? domain}
                </span>
                <span className="text-gray-500 font-normal text-sm">({domainContacts.length})</span>
              </h2>
              <div>
                {domainContacts.map((c) => <ContactRow key={c.id} contact={c} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        overdue.length === 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            No follow-ups due in the next 14 days.
          </div>
        )
      )}
    </div>
  );
}
