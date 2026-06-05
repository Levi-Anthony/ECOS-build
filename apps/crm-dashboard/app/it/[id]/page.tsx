import { supabase } from "@/lib/supabase-server";
import type { Contact, ServiceLog, BillingEntry } from "@/lib/supabase";
import { notFound } from "next/navigation";

const SERVICE_TYPE_COLORS: Record<string, string> = {
  onsite: "bg-blue-100 text-blue-800",
  remote: "bg-indigo-100 text-indigo-800",
  phone: "bg-sky-100 text-sky-800",
  email: "bg-gray-100 text-gray-700",
  project: "bg-purple-100 text-purple-800",
  maintenance: "bg-teal-100 text-teal-800",
};

const BILLING_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-yellow-100 text-yellow-800",
  paid: "bg-emerald-100 text-emerald-800",
};

export default async function ITClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contactRes, logsRes, billingRes] = await Promise.all([
    supabase
      .from("professional_contacts")
      .select("*")
      .eq("id", id)
      .single(),
    supabase
      .from("it_service_logs")
      .select("*")
      .eq("contact_id", id)
      .order("service_date", { ascending: false })
      .limit(30),
    supabase
      .from("it_billing_entries")
      .select("*")
      .eq("contact_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (contactRes.error || !contactRes.data) notFound();

  const contact = contactRes.data as Contact;
  const serviceLogs = (logsRes.data ?? []) as ServiceLog[];
  const billingEntries = (billingRes.data ?? []) as BillingEntry[];

  const openFollowUps = serviceLogs.filter((l) => l.follow_up_needed);
  const unbilledLogs = serviceLogs.filter((l) => l.billable && !l.billed);
  const unbilledMin = unbilledLogs.reduce((sum, l) => sum + (l.time_spent_minutes ?? 0), 0);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-4">
        <a href="/it" className="text-sm text-gray-500 hover:text-gray-700">← IT Clients</a>
        <a href={`/contacts/${contact.id}`} className="text-sm text-blue-500 hover:underline">View full contact profile →</a>
      </div>

      {/* Contact header */}
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
          {unbilledLogs.length > 0 && (
            <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-sm font-medium">
              {unbilledLogs.length} unbilled · {(unbilledMin / 60).toFixed(1)}h
            </span>
          )}
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
          {contact.last_contacted && (
            <div>
              <span className="text-gray-500">Last service</span>
              <p>{new Date(contact.last_contacted).toLocaleDateString()}</p>
            </div>
          )}
        </div>
      </div>

      {/* Follow-up section */}
      {openFollowUps.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-6">
          <h2 className="font-semibold text-amber-800 mb-3">Open Follow-Ups ({openFollowUps.length})</h2>
          <div className="space-y-2">
            {openFollowUps.map((l) => (
              <div key={l.id} className="text-sm">
                <span className="text-gray-600">[{l.service_date}]</span>{" "}
                <span className="text-gray-800">{l.follow_up_notes || l.description.slice(0, 100)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Billing entries */}
      {billingEntries.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold mb-3">Invoices ({billingEntries.length})</h2>
          <div className="space-y-2">
            {billingEntries.map((b: BillingEntry) => (
              <div key={b.id} className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {b.description ?? `Invoice — ${b.service_log_ids.length} log(s)`}
                  </p>
                  {b.invoice_date && <p className="text-xs text-gray-500 mt-0.5">Issued: {b.invoice_date}</p>}
                  {b.paid_date && <p className="text-xs text-gray-500">Paid: {b.paid_date}</p>}
                  {b.notes && <p className="text-xs text-gray-400 mt-0.5">{b.notes}</p>}
                </div>
                <div className="text-right flex-shrink-0 ml-4">
                  {b.amount != null && (
                    <p className="text-sm font-semibold text-gray-900">${b.amount.toLocaleString()}</p>
                  )}
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${BILLING_STATUS_COLORS[b.status] ?? "bg-gray-100 text-gray-700"}`}>
                    {b.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Service log timeline */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-semibold mb-4">Service History ({serviceLogs.length})</h2>
        {serviceLogs.length === 0 ? (
          <p className="text-gray-400 text-sm">No service logs yet.</p>
        ) : (
          <div className="space-y-3">
            {serviceLogs.map((l: ServiceLog) => (
              <div key={l.id} className="flex gap-3">
                <div className="flex-shrink-0 w-2 h-2 mt-2 rounded-full bg-blue-400"></div>
                <div className="flex-1 pb-3 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${SERVICE_TYPE_COLORS[l.service_type] ?? "bg-gray-100 text-gray-700"}`}>
                      {l.service_type}
                    </span>
                    <span className="text-xs text-gray-400">{l.service_date}</span>
                    {l.time_spent_minutes && (
                      <span className="text-xs text-gray-400">{l.time_spent_minutes} min</span>
                    )}
                    {l.billable && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${l.billed ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>
                        {l.billed ? "billed" : "unbilled"}
                      </span>
                    )}
                    {!l.billable && (
                      <span className="text-xs text-gray-300">no-bill</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-800">{l.description}</p>
                  {l.resolution && (
                    <p className="text-xs text-green-700 mt-1">✓ {l.resolution}</p>
                  )}
                  {l.follow_up_needed && l.follow_up_notes && (
                    <p className="text-xs text-amber-700 mt-1">Follow-up: {l.follow_up_notes}</p>
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
