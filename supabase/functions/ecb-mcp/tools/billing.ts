// Billing tools — IT consulting service log + invoice tracking.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID } = helpers;

  registrar.registerTool(
  "log_service_call",
  {
    title: "Log Service Call",
    description: "Log an IT service call for a client. Inserts into it_service_logs and updates last_contacted on the contact.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID of the IT client"),
      service_type: z.enum(["onsite", "remote", "phone", "email", "project", "maintenance"]),
      description: z.string().describe("What was done"),
      service_date: z.string().optional().describe("ISO date YYYY-MM-DD — defaults to today"),
      time_spent_minutes: z.number().optional(),
      billable: z.boolean().optional().default(true),
      resolution: z.string().optional(),
      follow_up_needed: z.boolean().optional().default(false),
      follow_up_notes: z.string().optional(),
    },
  },
  async ({ contact_id, service_type, description, service_date, time_spent_minutes, billable, resolution, follow_up_needed, follow_up_notes }) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("it_service_logs")
        .insert({
          user_id: ECOS_USER_ID,
          contact_id,
          service_type,
          description,
          service_date: service_date ?? today,
          time_spent_minutes: time_spent_minutes ?? null,
          billable: billable ?? true,
          resolution: resolution ?? null,
          follow_up_needed: follow_up_needed ?? false,
          follow_up_notes: follow_up_notes ?? null,
        })
        .select("id")
        .single();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };

      await supabase
        .from("professional_contacts")
        .update({ last_contacted: today, updated_at: new Date().toISOString() })
        .eq("id", contact_id);

      return { content: [{ type: "text" as const, text: `Logged ${service_type} service call for contact ${contact_id} — ID: ${data.id}${time_spent_minutes ? ` (${time_spent_minutes} min)` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 14: get_client_service_history ────────────────────────────────────
  registrar.registerTool(
  "get_client_service_history",
  {
    title: "Get Client Service History",
    description: "Retrieve service logs for an IT client, newest first.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ contact_id, limit }) => {
    try {
      const { data, error } = await supabase
        .from("it_service_logs")
        .select("id, service_date, service_type, description, resolution, time_spent_minutes, billable, billed, follow_up_needed, follow_up_notes")
        .eq("contact_id", contact_id)
        .order("service_date", { ascending: false })
        .limit(limit ?? 20);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No service logs found for contact ${contact_id}.` }] };

      const lines = data.map((l) =>
        `• [${l.service_date}] ${l.service_type.toUpperCase()}${l.time_spent_minutes ? ` ${l.time_spent_minutes}min` : ""} ${l.billable ? (l.billed ? "[billed]" : "[unbilled]") : "[no-bill]"}\n  ${l.description}${l.resolution ? `\n  Resolution: ${l.resolution}` : ""}${l.follow_up_needed ? `\n  Follow-up: ${l.follow_up_notes ?? "needed"}` : ""}\n  ID: ${l.id}`
      );
      return { content: [{ type: "text" as const, text: `${data.length} service log(s):\n\n${lines.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 15: get_unbilled_work ──────────────────────────────────────────────
  registrar.registerTool(
  "get_unbilled_work",
  {
    title: "Get Unbilled Work",
    description: "List billable but unbilled service logs. Omit contact_id to see all clients.",
    inputSchema: {
      contact_id: z.string().uuid().optional().describe("Filter to one client; omit for all"),
    },
  },
  async ({ contact_id }) => {
    try {
      let q = supabase
        .from("it_service_logs")
        .select("id, contact_id, service_date, service_type, description, time_spent_minutes, professional_contacts!inner(name, company)")
        .eq("user_id", ECOS_USER_ID)
        .eq("billable", true)
        .eq("billed", false)
        .order("service_date", { ascending: false });
      if (contact_id) q = q.eq("contact_id", contact_id);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: "No unbilled work found." }] };

      type LogRow = { id: string; contact_id: string; service_date: string; service_type: string; description: string; time_spent_minutes: number | null; professional_contacts: { name: string; company: string | null }[] };
      const byContact: Record<string, { name: string; logs: LogRow[]; totalMin: number }> = {};
      for (const l of data as LogRow[]) {
        const cid = l.contact_id;
        if (!byContact[cid]) byContact[cid] = { name: l.professional_contacts[0]?.name ?? cid, logs: [], totalMin: 0 };
        byContact[cid].logs.push(l);
        byContact[cid].totalMin += l.time_spent_minutes ?? 0;
      }

      const lines: string[] = [`Unbilled work (${data.length} logs across ${Object.keys(byContact).length} client(s)):\n`];
      for (const [cid, { name, logs, totalMin }] of Object.entries(byContact)) {
        lines.push(`── ${name} (${logs.length} logs, ${totalMin} min total) — contact ID: ${cid}`);
        for (const l of logs) {
          lines.push(`  • [${l.service_date}] ${l.service_type} — ${l.description.slice(0, 80)}${l.time_spent_minutes ? ` (${l.time_spent_minutes}min)` : ""} | ID: ${l.id}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 16: create_billing_entry ───────────────────────────────────────────
  registrar.registerTool(
  "create_billing_entry",
  {
    title: "Create Billing Entry",
    description: "Create a billing entry and atomically mark all referenced service logs as billed via create_billing_entry_tx.",
    inputSchema: {
      contact_id: z.string().uuid(),
      service_log_ids: z.array(z.string().uuid()).describe("Service log UUIDs to include in this invoice"),
      amount: z.number().describe("Invoice amount in dollars"),
      description: z.string().optional(),
      invoice_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
      notes: z.string().optional(),
    },
  },
  async ({ contact_id, service_log_ids, amount, description, invoice_date, notes }) => {
    try {
      const { data, error } = await supabase.rpc("create_billing_entry_tx", {
        p_user_id: ECOS_USER_ID,
        p_contact_id: contact_id,
        p_log_ids: service_log_ids,
        p_amount: amount,
        p_description: description ?? null,
        p_invoice_date: invoice_date ?? null,
        p_notes: notes ?? null,
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Created billing entry ID: ${data}\nMarked ${service_log_ids.length} log(s) as billed. Amount: $${amount}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 17: update_billing_status ─────────────────────────────────────────
  registrar.registerTool(
  "update_billing_status",
  {
    title: "Update Billing Status",
    description: "Update the status of a billing entry to 'sent' or 'paid'. Pass paid_date when marking paid.",
    inputSchema: {
      billing_entry_id: z.string().uuid(),
      status: z.enum(["sent", "paid"]),
      paid_date: z.string().optional().describe("ISO date YYYY-MM-DD — required when status=paid"),
    },
  },
  async ({ billing_entry_id, status, paid_date }) => {
    try {
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (paid_date) patch.paid_date = paid_date;

      const { error } = await supabase
        .from("it_billing_entries")
        .update(patch)
        .eq("id", billing_entry_id);
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Updated billing entry ${billing_entry_id} → ${status}${paid_date ? ` (paid ${paid_date})` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

};
