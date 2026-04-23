import { supabase, Contact, ServiceLog } from "@/lib/supabase";

export default async function ITPage() {
  const [clientsRes, unbilledRes] = await Promise.all([
    supabase
      .from("professional_contacts")
      .select("id, name, company, title, email, phone, follow_up_date, last_contacted, administrative_status")
      .eq("relationship_domain", "it")
      .eq("administrative_status", "active")
      .order("name", { ascending: true }),
    supabase
      .from("it_service_logs")
      .select("id, contact_id, time_spent_minutes")
      .eq("billable", true)
      .eq("billed", false),
  ]);

  const clients = (clientsRes.data ?? []) as Contact[];
  const unbilledLogs = (unbilledRes.data ?? []) as ServiceLog[];

  // Aggregate unbilled time per contact
  const unbilledByContact: Record<string, { count: number; totalMin: number }> = {};
  for (const log of unbilledLogs) {
    if (!unbilledByContact[log.contact_id]) unbilledByContact[log.contact_id] = { count: 0, totalMin: 0 };
    unbilledByContact[log.contact_id].count++;
    unbilledByContact[log.contact_id].totalMin += log.time_spent_minutes ?? 0;
  }

  const totalUnbilledMin = unbilledLogs.reduce((sum, l) => sum + (l.time_spent_minutes ?? 0), 0);
  const clientsWithUnbilled = Object.keys(unbilledByContact).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">IT Clients</h1>
        <span className="text-sm text-gray-500">{clients.length} active client{clients.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Active clients</p>
          <p className="text-2xl font-semibold mt-1">{clients.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Clients with unbilled work</p>
          <p className="text-2xl font-semibold mt-1">{clientsWithUnbilled}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Total unbilled hours</p>
          <p className="text-2xl font-semibold mt-1">{(totalUnbilledMin / 60).toFixed(1)}</p>
        </div>
      </div>

      {/* Unbilled work summary */}
      {clientsWithUnbilled > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-6">
          <h2 className="font-semibold text-amber-800 mb-3">Unbilled Work</h2>
          <div className="space-y-2">
            {clients
              .filter((c) => unbilledByContact[c.id])
              .map((c) => {
                const { count, totalMin } = unbilledByContact[c.id];
                return (
                  <div key={c.id} className="flex items-center justify-between">
                    <a href={`/it/${c.id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                      {c.name}
                    </a>
                    <div className="text-sm text-amber-700">
                      {count} log{count !== 1 ? "s" : ""} · {(totalMin / 60).toFixed(1)} hrs
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Client list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Contact</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Last service</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Unbilled</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const unbilled = unbilledByContact[c.id];
              return (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <a href={`/it/${c.id}`} className="font-medium text-blue-600 hover:text-blue-800">
                      {c.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.company ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.email && <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>}
                    {c.email && c.phone && <span className="mx-1 text-gray-300">·</span>}
                    {c.phone && <span>{c.phone}</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {c.last_contacted ? new Date(c.last_contacted).toLocaleDateString() : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {unbilled ? (
                      <span className="text-amber-700 font-medium">{unbilled.count} log{unbilled.count !== 1 ? "s" : ""} · {(unbilled.totalMin / 60).toFixed(1)}h</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No active IT clients.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
