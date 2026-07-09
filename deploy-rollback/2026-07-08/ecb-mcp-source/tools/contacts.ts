// Contacts tools — CRM contact management.
//
// Contract convention: see ./CONVENTION.md. Every tool here sets a description
// (structured template), an annotations preset, and an outputSchema; success
// paths return structuredResult(payload, humanText) so structured content is
// additive and the prior human-readable text is byte-for-byte preserved.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY, WRITE_APPEND, WRITE_TRANSACTIONAL } from "../lib/annotations.ts";
import { errorResult, structuredResult } from "../lib/format.ts";
import {
  ContactSchema,
  ContactSummarySchema,
  InteractionSchema,
  OpportunitySchema,
  listOf,
  writeResult,
} from "../lib/schemas.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID, RELATIONSHIP_DOMAINS, ADMIN_STATUSES } = helpers;

  registrar.registerTool(
  "add_contact",
  {
    title: "Add Contact",
    description:
      "Create a new CRM contact.\n" +
      "Use when: a person should be tracked in the CRM. Not for: editing an existing contact — use `update_contact`; logging a touchpoint — use `log_interaction`.\n" +
      "Side effects: inserts one professional_contacts row (append).\n" +
      "Returns: { ok, id, name, relationship_domain } for the created contact.",
    inputSchema: {
      name: z.string().describe("Full name"),
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS).describe("Primary domain: tango, ttc, outreach, it, music, personal, general"),
      company: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional().describe("Free-form tags"),
      notes: z.string().optional(),
      follow_up_date: z.string().optional().describe("ISO date string YYYY-MM-DD"),
    },
    outputSchema: writeResult({
      name: z.string(),
      relationship_domain: z.string(),
    }),
    annotations: WRITE_APPEND,
  },
  async ({ name, relationship_domain, company, title, email, phone, tags, notes, follow_up_date }) => {
    try {
      const { data, error } = await supabase
        .from("professional_contacts")
        .insert({
          user_id: ECOS_USER_ID,
          name,
          relationship_domain,
          company: company ?? null,
          title: title ?? null,
          email: email ?? null,
          phone: phone ?? null,
          tags: tags ?? [],
          notes: notes ?? null,
          follow_up_date: follow_up_date ?? null,
        })
        .select("id, name, relationship_domain")
        .single();
      if (error) return errorResult(`Error: ${error.message}`);
      return structuredResult(
        { ok: true, id: data.id, name: data.name, relationship_domain: data.relationship_domain },
        `Added contact: ${data.name} (${data.relationship_domain}) — ID: ${data.id}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 2: search_contacts ─────────────────────────────────────────────────
  registrar.registerTool(
  "search_contacts",
  {
    title: "Search Contacts",
    description:
      "Find contacts by a text match on name, company, or title.\n" +
      "Use when: locating a contact by who/where they are. Not for: listing a whole domain — use `get_contacts_by_domain`; full profile + timeline — use `get_contact_history`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { items, count } of contact summaries.",
    inputSchema: {
      query: z.string().describe("Text to search in name, company, or title"),
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS).optional(),
      administrative_status: z.enum(ADMIN_STATUSES).optional(),
      limit: z.number().optional().default(20),
    },
    outputSchema: listOf(ContactSummarySchema),
    annotations: READ_ONLY,
  },
  async ({ query, relationship_domain, administrative_status, limit }) => {
    try {
      let q = supabase
        .from("professional_contacts")
        .select("id, name, company, title, email, relationship_domain, administrative_status, follow_up_date, last_contacted, tags")
        .or(`name.ilike.%${query}%,company.ilike.%${query}%,title.ilike.%${query}%`)
        .limit(limit);
      if (relationship_domain) q = q.eq("relationship_domain", relationship_domain);
      if (administrative_status) q = q.eq("administrative_status", administrative_status);
      const { data, error } = await q;
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ items: [], count: 0 }, `No contacts found matching "${query}".`);
      const lines = data.map((c) =>
        `• ${c.name}${c.company ? ` @ ${c.company}` : ""}${c.title ? ` (${c.title})` : ""} — ${c.relationship_domain} / ${c.administrative_status}${c.follow_up_date ? ` | follow-up: ${c.follow_up_date}` : ""}\n  ID: ${c.id}`
      );
      return structuredResult(
        { items: data, count: data.length },
        `${data.length} contact(s):\n\n${lines.join("\n")}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 3: log_interaction ─────────────────────────────────────────────────
  registrar.registerTool(
  "log_interaction",
  {
    title: "Log Interaction",
    description:
      "Record a touchpoint with a contact and bump their last_contacted date.\n" +
      "Use when: an email/call/meeting/etc. happened. Not for: a status change — use `set_administrative_status`; an analytical note about the person — use `add_person_observation`.\n" +
      "Side effects: inserts one contact_interactions row and updates last_contacted on the contact.\n" +
      "Returns: { ok, id (contact_id), interaction_type } (with `warning` if last_contacted update failed).",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      interaction_type: z.string().describe("e.g. email, call, meeting, video_call, message, in_person, note, slack, text, coffee, lunch, status_change"),
      summary: z.string().describe("One-line summary (required)"),
      follow_up_notes: z.string().optional().describe("Follow-up notes"),
      follow_up_needed: z.boolean().optional().default(false),
      occurred_at: z.string().optional().describe("ISO datetime — defaults to now"),
    },
    outputSchema: writeResult({
      interaction_type: z.string(),
      summary: z.string().nullable().optional(),
      warning: z.string().optional(),
    }),
    annotations: WRITE_TRANSACTIONAL,
  },
  async ({ contact_id, interaction_type, summary, follow_up_notes, follow_up_needed, occurred_at }) => {
    try {
      const { error: insertErr } = await supabase
        .from("contact_interactions")
        .insert({
          contact_id,
          user_id: ECOS_USER_ID,
          interaction_type,
          summary: summary ?? null,
          follow_up_notes: follow_up_notes ?? null,
          follow_up_needed: follow_up_needed ?? false,
          occurred_at: occurred_at ?? new Date().toISOString(),
        });
      if (insertErr) return errorResult(`Error: ${insertErr.message}`);

      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ last_contacted: new Date().toISOString().split("T")[0], updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return structuredResult(
        { ok: true, id: contact_id, interaction_type, summary: summary ?? null, warning: `failed to update last_contacted: ${updateErr.message}` },
        `Interaction logged but failed to update last_contacted: ${updateErr.message}`,
      );

      return structuredResult(
        { ok: true, id: contact_id, interaction_type, summary: summary ?? null },
        `Logged ${interaction_type} interaction for contact ${contact_id}${summary ? ` — "${summary}"` : ""}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 4: get_contact_history ─────────────────────────────────────────────
  registrar.registerTool(
  "get_contact_history",
  {
    title: "Get Contact History",
    description:
      "Full profile for one contact: details, interaction timeline (newest first, max 20), and open opportunities.\n" +
      "Use when: you need the whole picture for a known contact_id. Not for: finding the contact — use `search_contacts` first.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { contact, interactions[], opportunities[] }.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
    },
    outputSchema: {
      contact: ContactSchema,
      interactions: z.array(InteractionSchema),
      opportunities: z.array(OpportunitySchema),
    },
    annotations: READ_ONLY,
  },
  async ({ contact_id }) => {
    try {
      const [contactRes, interactionsRes, oppsRes] = await Promise.all([
        supabase
          .from("professional_contacts")
          .select("*")
          .eq("id", contact_id)
          .single(),
        supabase
          .from("contact_interactions")
          .select("id, interaction_type, summary, follow_up_notes, occurred_at")
          .eq("contact_id", contact_id)
          .order("occurred_at", { ascending: false })
          .limit(20),
        supabase
          .from("opportunities")
          .select("id, title, stage, value, close_date, notes")
          .eq("contact_id", contact_id)
          .not("stage", "in", '("closed_won","closed_lost")')
          .order("created_at", { ascending: false }),
      ]);
      if (contactRes.error) return errorResult(`Contact not found: ${contactRes.error.message}`, "NOT_FOUND");
      const c = contactRes.data;
      const opps = oppsRes.data ?? [];
      const interactions = interactionsRes.data ?? [];
      const lines = [
        `=== ${c.name} ===`,
        c.company ? `Company: ${c.company}` : "",
        c.title ? `Title: ${c.title}` : "",
        c.email ? `Email: ${c.email}` : "",
        c.phone ? `Phone: ${c.phone}` : "",
        `Domain: ${c.relationship_domain} | Status: ${c.administrative_status}`,
        c.follow_up_date ? `Follow-up: ${c.follow_up_date}` : "",
        c.last_contacted ? `Last contacted: ${c.last_contacted}` : "",
        c.tags?.length ? `Tags: ${c.tags.join(", ")}` : "",
        c.notes ? `Notes: ${c.notes}` : "",
        "",
      ].filter((l) => l !== "");

      if (opps.length) {
        lines.push("--- Open Opportunities ---");
        for (const o of opps) {
          lines.push(`• [${o.stage}] ${o.title}${o.value ? ` ($${o.value})` : ""}${o.close_date ? ` — closes ${o.close_date}` : ""}`);
        }
        lines.push("");
      }

      if (interactions.length) {
        lines.push("--- Interactions ---");
        for (const i of interactions) {
          lines.push(`• [${new Date(i.occurred_at).toLocaleDateString()}] ${i.interaction_type}${i.summary ? ` — ${i.summary}` : ""}${i.follow_up_notes ? `\n  Follow-up: ${i.follow_up_notes}` : ""}`);
        }
      } else {
        lines.push("No interactions logged.");
      }

      return structuredResult(
        { contact: c, interactions, opportunities: opps },
        lines.join("\n"),
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);


  registrar.registerTool(
  "get_follow_ups_due",
  {
    title: "Get Follow-Ups Due",
    description:
      "Active contacts with a follow-up date within the next N days, split into overdue and upcoming.\n" +
      "Use when: triaging who needs outreach now. Not for: arbitrary contact lookup — use `search_contacts`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { overdue[], upcoming[], count } of contact summaries.",
    inputSchema: {
      days: z.number().optional().default(7).describe("Look-ahead window in days"),
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS).optional(),
    },
    outputSchema: {
      overdue: z.array(ContactSummarySchema),
      upcoming: z.array(ContactSummarySchema),
      count: z.number().int(),
    },
    annotations: READ_ONLY,
  },
  async ({ days, relationship_domain }) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const future = new Date();
      future.setDate(future.getDate() + (days ?? 7));
      const futureStr = future.toISOString().split("T")[0];

      let q = supabase
        .from("professional_contacts")
        .select("id, name, company, relationship_domain, follow_up_date, last_contacted")
        .lte("follow_up_date", futureStr)
        .not("follow_up_date", "is", null)
        .eq("administrative_status", "active")
        .order("follow_up_date", { ascending: true });
      if (relationship_domain) q = q.eq("relationship_domain", relationship_domain);

      const { data, error } = await q;
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ overdue: [], upcoming: [], count: 0 }, `No follow-ups due in the next ${days} days.`);

      const overdue = data.filter((c) => c.follow_up_date < today);
      const upcoming = data.filter((c) => c.follow_up_date >= today);

      const fmt = (c: { name: string; company?: string; relationship_domain: string; follow_up_date: string; id: string }) =>
        `• ${c.name}${c.company ? ` @ ${c.company}` : ""} [${c.relationship_domain}] — ${c.follow_up_date} | ID: ${c.id}`;

      const lines: string[] = [];
      if (overdue.length) {
        lines.push(`⚠ Overdue (${overdue.length}):`);
        lines.push(...overdue.map(fmt));
        lines.push("");
      }
      if (upcoming.length) {
        lines.push(`Upcoming (${upcoming.length}, next ${days} days):`);
        lines.push(...upcoming.map(fmt));
      }
      return structuredResult(
        { overdue, upcoming, count: data.length },
        lines.join("\n"),
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 7: update_contact ──────────────────────────────────────────────────
  registrar.registerTool(
  "update_contact",
  {
    title: "Update Contact",
    description:
      "Update any field(s) on an existing contact by ID.\n" +
      "Use when: correcting or enriching contact details. Not for: changing administrative_status — use `set_administrative_status`; creating a contact — use `add_contact`.\n" +
      "Side effects: updates the professional_contacts row (transactional).\n" +
      "Returns: { ok, id, updated_fields }.",
    inputSchema: {
      contact_id: z.string().uuid(),
      name: z.string().optional(),
      company: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
      follow_up_date: z.string().optional().describe("ISO date YYYY-MM-DD or null to clear"),
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS).optional(),
    },
    outputSchema: writeResult({
      updated_fields: z.array(z.string()).describe("Field names that were changed"),
    }),
    annotations: WRITE_TRANSACTIONAL,
  },
  async ({ contact_id, ...fields }) => {
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) patch[k] = v;
      }
      const { error } = await supabase
        .from("professional_contacts")
        .update(patch)
        .eq("id", contact_id);
      if (error) return errorResult(`Error: ${error.message}`);
      const updatedFields = Object.keys(patch).filter(k => k !== "updated_at");
      return structuredResult(
        { ok: true, id: contact_id, updated_fields: updatedFields },
        `Updated contact ${contact_id}: ${updatedFields.join(", ")}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 8: get_contacts_by_domain ─────────────────────────────────────────
  registrar.registerTool(
  "get_contacts_by_domain",
  {
    title: "Get Contacts by Domain",
    description:
      "List all contacts in a relationship domain at a given administrative status.\n" +
      "Use when: browsing/roster of a whole domain. Not for: text search — use `search_contacts`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { items, count } of contact summaries.",
    inputSchema: {
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS),
      administrative_status: z.enum(ADMIN_STATUSES).optional().default("active"),
      limit: z.number().optional().default(50),
    },
    outputSchema: listOf(ContactSummarySchema),
    annotations: READ_ONLY,
  },
  async ({ relationship_domain, administrative_status, limit }) => {
    try {
      let q = supabase
        .from("professional_contacts")
        .select("id, name, company, title, administrative_status, follow_up_date, last_contacted, tags")
        .eq("relationship_domain", relationship_domain)
        .order("name", { ascending: true })
        .limit(limit);
      if (administrative_status) q = q.eq("administrative_status", administrative_status);

      const { data, error } = await q;
      if (error) return errorResult(`Error: ${error.message}`);
      if (!data?.length) return structuredResult({ items: [], count: 0 }, `No contacts in domain "${relationship_domain}".`);

      const items = data.map((c) => ({ ...c, relationship_domain }));
      const lines = data.map((c) =>
        `• ${c.name}${c.company ? ` @ ${c.company}` : ""}${c.title ? ` (${c.title})` : ""} [${c.administrative_status}]${c.follow_up_date ? ` | follow-up: ${c.follow_up_date}` : ""}\n  ID: ${c.id}`
      );
      return structuredResult(
        { items, count: items.length },
        `${data.length} contact(s) in ${relationship_domain}:\n\n${lines.join("\n")}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

// ─── Tool 9: set_administrative_status ───────────────────────────────────────
  registrar.registerTool(
  "set_administrative_status",
  {
    title: "Set Administrative Status",
    description:
      "Change a contact's administrative_status (active/passive/administrative_closed/community), optionally logging the reason as an interaction.\n" +
      "Use when: a relationship's lifecycle state changes. Not for: editing other fields — use `update_contact`.\n" +
      "Side effects: updates the contact row; if `note` is given, also appends a status_change interaction.\n" +
      "Returns: { ok, id, status, note_logged }.",
    inputSchema: {
      contact_id: z.string().uuid(),
      status: z.enum(ADMIN_STATUSES),
      note: z.string().optional().describe("Optional reason to log as an interaction"),
    },
    outputSchema: writeResult({
      status: z.string(),
      note_logged: z.boolean(),
    }),
    annotations: WRITE_TRANSACTIONAL,
  },
  async ({ contact_id, status, note }) => {
    try {
      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ administrative_status: status, updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return errorResult(`Error: ${updateErr.message}`);

      if (note) {
        await supabase.from("contact_interactions").insert({
          contact_id,
          user_id: ECOS_USER_ID,
          interaction_type: "status_change",
          summary: `Status set to ${status}`,
          follow_up_notes: note,
          occurred_at: new Date().toISOString(),
        });
      }

      return structuredResult(
        { ok: true, id: contact_id, status, note_logged: !!note },
        `Set contact ${contact_id} → ${status}${note ? ` (logged: "${note}")` : ""}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

};
