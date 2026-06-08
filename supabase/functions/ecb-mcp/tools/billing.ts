// Billing tools — IT consulting service log + invoice tracking.
//
// Contract convention: see ./CONVENTION.md.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY, WRITE_TRANSACTIONAL } from "../lib/annotations.ts";
import { errorResult, structuredResult } from "../lib/format.ts";
import { ServiceLogSchema, listOf, writeResult } from "../lib/schemas.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID } = helpers;

  registrar.registerTool(
  "log_service_call",
  {
    title: "Log Service Call",
    description:
      "Log an IT service call for a client and bump their last_contacted date.\n" +
      "Use when: recording IT work done for a client. Not for: a generic touchpoint — use `log_interaction`; invoicing — use `create_billing_entry`.\n" +
      "Side effects: inserts one it_service_logs row and updates last_contacted on the contact (transactional).\n" +
      "Returns: { ok, id, service_type, time_spent_minutes }.",
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
    outputSchema: writeResult({
      service_type: z.string(),
      time_spent_minutes: z.number().nullable(),
    }),
    annotations: WRITE_TRANSACTIONAL,
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
      if (error) return errorResult(`Error: ${error.message}`);

      await supabase
        .from("professional_contacts")
        .update({ last_contacted: today, updated_at: new Date().toISOString() })
        .eq("id", contact_id);

      return structuredResult(
        { ok: true, id: data.id, service_type, time_spent_minutes: time_spent_minutes ?? null },
        `Logged ${service_type} service call for contact ${contact_id} — ID: ${data.id}${time_spent_minutes ? ` (${time_spent_minutes} min)` : ""}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 14: get_client_service_history ────────────────────────────────────
  registrar.registerTool(
  "get_client_service_history",
  {
    title: "Get Client Service History",
    description:
      "Retrieve service logs for an IT client, newest first.\n" +
      "Use when: reviewing what was done for a client. Not for: unbilled-only across clients — use `get_unbilled_work`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { items, count } of service logs.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      limit: z.number().optional().default(20),
    },
    outputSchema: listOf(ServiceLogSchema),
    annotations: READ_ONLY,
  },
  async ({ contact_id, limit }) => {
    try {
      const { data, error } = await supabase
        .from("it_service_logs")
        .select("id, service_date, service_type, description, resolution, time_spent_minutes, billable, billed, follow_up_needed, follow_up_notes")
        .eq("contact_id", contact_id)
        .order("service_date", { ascending: false })
        .limit(limit ?? 20);
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ items: [], count: 0 }, `No service logs found for contact ${contact_id}.`);

      const lines = data.map((l) =>
        `• [${l.service_date}] ${l.service_type.toUpperCase()}${l.time_spent_minutes ? ` ${l.time_spent_minutes}min` : ""} ${l.billable ? (l.billed ? "[billed]" : "[unbilled]") : "[no-bill]"}\n  ${l.description}${l.resolution ? `\n  Resolution: ${l.resolution}` : ""}${l.follow_up_needed ? `\n  Follow-up: ${l.follow_up_notes ?? "needed"}` : ""}\n  ID: ${l.id}`
      );
      return structuredResult({ items: data, count: data.length }, `${data.length} service log(s):\n\n${lines.join("\n\n")}`);
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 15: get_unbilled_work ──────────────────────────────────────────────
  registrar.registerTool(
  "get_unbilled_work",
  {
    title: "Get Unbilled Work",
    description:
      "List billable-but-unbilled service logs (omit contact_id to see all clients).\n" +
      "Use when: preparing invoices / finding what to bill. Not for: a client's full history — use `get_client_service_history`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { items, count, total_minutes } of unbilled logs (each carries its contact's name/company).",
    inputSchema: {
      contact_id: z.string().uuid().optional().describe("Filter to one client; omit for all"),
    },
    outputSchema: {
      items:         z.array(z.record(z.string(), z.unknown())),
      count:         z.number().int(),
      total_minutes: z.number().int(),
    },
    annotations: READ_ONLY,
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
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ items: [], count: 0, total_minutes: 0 }, "No unbilled work found.");

      type LogRow = { id: string; contact_id: string; service_date: string; service_type: string; description: string; time_spent_minutes: number | null; professional_contacts: { name: string; company: string | null }[] };
      const byContact: Record<string, { name: string; logs: LogRow[]; totalMin: number }> = {};
      let totalMinutes = 0;
      for (const l of data as LogRow[]) {
        const cid = l.contact_id;
        if (!byContact[cid]) byContact[cid] = { name: l.professional_contacts[0]?.name ?? cid, logs: [], totalMin: 0 };
        byContact[cid].logs.push(l);
        byContact[cid].totalMin += l.time_spent_minutes ?? 0;
        totalMinutes += l.time_spent_minutes ?? 0;
      }

      const lines: string[] = [`Unbilled work (${data.length} logs across ${Object.keys(byContact).length} client(s)):\n`];
      for (const [cid, { name, logs, totalMin }] of Object.entries(byContact)) {
        lines.push(`── ${name} (${logs.length} logs, ${totalMin} min total) — contact ID: ${cid}`);
        for (const l of logs) {
          lines.push(`  • [${l.service_date}] ${l.service_type} — ${l.description.slice(0, 80)}${l.time_spent_minutes ? ` (${l.time_spent_minutes}min)` : ""} | ID: ${l.id}`);
        }
        lines.push("");
      }
      return structuredResult({ items: data, count: data.length, total_minutes: totalMinutes }, lines.join("\n"));
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 16: create_billing_entry ───────────────────────────────────────────
  registrar.registerTool(
  "create_billing_entry",
  {
    title: "Create Billing Entry",
    description:
      "Create a billing entry and atomically mark all referenced service logs as billed.\n" +
      "Use when: invoicing a batch of unbilled logs. Not for: changing an invoice's status — use `update_billing_status`.\n" +
      "Side effects: create_billing_entry_tx inserts the entry and flips the referenced logs to billed=true (transactional).\n" +
      "Returns: { ok, id, amount, logs_billed }.",
    inputSchema: {
      contact_id: z.string().uuid(),
      service_log_ids: z.array(z.string().uuid()).describe("Service log UUIDs to include in this invoice"),
      amount: z.number().describe("Invoice amount in dollars"),
      description: z.string().optional(),
      invoice_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
      notes: z.string().optional(),
    },
    outputSchema: writeResult({
      amount: z.number(),
      logs_billed: z.number().int(),
    }),
    annotations: WRITE_TRANSACTIONAL,
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
      if (error) return errorResult(`Error: ${error.message}`);
      return structuredResult(
        { ok: true, id: data as string, amount, logs_billed: service_log_ids.length },
        `Created billing entry ID: ${data}\nMarked ${service_log_ids.length} log(s) as billed. Amount: $${amount}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 17: update_billing_status ─────────────────────────────────────────
  registrar.registerTool(
  "update_billing_status",
  {
    title: "Update Billing Status",
    description:
      "Update a billing entry's status to 'sent' or 'paid' (pass paid_date when marking paid).\n" +
      "Use when: moving an invoice through its lifecycle. Not for: creating the invoice — use `create_billing_entry`.\n" +
      "Side effects: updates the it_billing_entries row (transactional).\n" +
      "Returns: { ok, id, status, paid_date }.",
    inputSchema: {
      billing_entry_id: z.string().uuid(),
      status: z.enum(["sent", "paid"]),
      paid_date: z.string().optional().describe("ISO date YYYY-MM-DD — required when status=paid"),
    },
    outputSchema: writeResult({
      status: z.string(),
      paid_date: z.string().nullable(),
    }),
    annotations: WRITE_TRANSACTIONAL,
  },
  async ({ billing_entry_id, status, paid_date }) => {
    try {
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (paid_date) patch.paid_date = paid_date;

      const { error } = await supabase
        .from("it_billing_entries")
        .update(patch)
        .eq("id", billing_entry_id);
      if (error) return errorResult(`Error: ${error.message}`);
      return structuredResult(
        { ok: true, id: billing_entry_id, status, paid_date: paid_date ?? null },
        `Updated billing entry ${billing_entry_id} → ${status}${paid_date ? ` (paid ${paid_date})` : ""}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

};
