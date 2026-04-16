import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const RELATIONSHIP_DOMAINS = ["tango", "ttc", "outreach", "it", "music", "personal", "general"] as const;
const ADMIN_STATUSES = ["active", "passive", "administrative_closed", "community"] as const;
const OPPORTUNITY_STAGES = ["prospect", "qualified", "proposal", "closed_won", "closed_lost"] as const;

// Fixed UUID representing the single ECOS user (Levi). This system has one
// user and uses service-role auth — no Supabase auth users exist.
const ECOS_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// --- MCP Server ---
const server = new McpServer({
  name: "ecos-crm",
  version: "1.0.0",
});

// ─── Tool 1: add_contact ──────────────────────────────────────────────────────
server.registerTool(
  "add_contact",
  {
    title: "Add Contact",
    description: "Add a new contact to the CRM. relationship_domain is required.",
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
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Added contact: ${data.name} (${data.relationship_domain}) — ID: ${data.id}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 2: search_contacts ─────────────────────────────────────────────────
server.registerTool(
  "search_contacts",
  {
    title: "Search Contacts",
    description: "Search contacts by name, company, or title. Optionally filter by domain or admin status.",
    inputSchema: {
      query: z.string().describe("Text to search in name, company, or title"),
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS).optional(),
      administrative_status: z.enum(ADMIN_STATUSES).optional(),
      limit: z.number().optional().default(20),
    },
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
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No contacts found matching "${query}".` }] };
      const lines = data.map((c) =>
        `• ${c.name}${c.company ? ` @ ${c.company}` : ""}${c.title ? ` (${c.title})` : ""} — ${c.relationship_domain} / ${c.administrative_status}${c.follow_up_date ? ` | follow-up: ${c.follow_up_date}` : ""}\n  ID: ${c.id}`
      );
      return { content: [{ type: "text" as const, text: `${data.length} contact(s):\n\n${lines.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 3: log_interaction ─────────────────────────────────────────────────
server.registerTool(
  "log_interaction",
  {
    title: "Log Interaction",
    description: "Record an interaction with a contact. Also updates last_contacted on the contact.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      interaction_type: z.string().describe("e.g. email, call, meeting, video_call, message, in_person, note, slack, text, coffee, lunch, status_change"),
      summary: z.string().describe("One-line summary (required)"),
      follow_up_notes: z.string().optional().describe("Follow-up notes"),
      follow_up_needed: z.boolean().optional().default(false),
      occurred_at: z.string().optional().describe("ISO datetime — defaults to now"),
    },
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
      if (insertErr) return { content: [{ type: "text" as const, text: `Error: ${insertErr.message}` }], isError: true };

      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ last_contacted: new Date().toISOString().split("T")[0], updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return { content: [{ type: "text" as const, text: `Interaction logged but failed to update last_contacted: ${updateErr.message}` }] };

      return { content: [{ type: "text" as const, text: `Logged ${interaction_type} interaction for contact ${contact_id}${summary ? ` — "${summary}"` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 4: get_contact_history ─────────────────────────────────────────────
server.registerTool(
  "get_contact_history",
  {
    title: "Get Contact History",
    description: "Full profile for a contact: details, interaction timeline (newest first), and open opportunities.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
    },
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
          .select("id, title, stage, value, expected_close_date, notes")
          .eq("contact_id", contact_id)
          .not("stage", "in", '("closed_won","closed_lost")')
          .order("created_at", { ascending: false }),
      ]);
      if (contactRes.error) return { content: [{ type: "text" as const, text: `Contact not found: ${contactRes.error.message}` }], isError: true };
      const c = contactRes.data;
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

      if (oppsRes.data?.length) {
        lines.push("--- Open Opportunities ---");
        for (const o of oppsRes.data) {
          lines.push(`• [${o.stage}] ${o.title}${o.value ? ` ($${o.value})` : ""}${o.expected_close_date ? ` — closes ${o.expected_close_date}` : ""}`);
        }
        lines.push("");
      }

      if (interactionsRes.data?.length) {
        lines.push("--- Interactions ---");
        for (const i of interactionsRes.data) {
          lines.push(`• [${new Date(i.occurred_at).toLocaleDateString()}] ${i.interaction_type}${i.summary ? ` — ${i.summary}` : ""}${i.follow_up_notes ? `\n  Follow-up: ${i.follow_up_notes}` : ""}`);
        }
      } else {
        lines.push("No interactions logged.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 5: create_opportunity ──────────────────────────────────────────────
server.registerTool(
  "create_opportunity",
  {
    title: "Create Opportunity",
    description: "Attach an opportunity to a contact.",
    inputSchema: {
      contact_id: z.string().uuid(),
      title: z.string().describe("Opportunity title"),
      stage: z.enum(OPPORTUNITY_STAGES).optional().default("prospect"),
      value: z.number().optional().describe("Estimated value in dollars"),
      expected_close_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
      notes: z.string().optional(),
    },
  },
  async ({ contact_id, title, stage, value, expected_close_date, notes }) => {
    try {
      const { data, error } = await supabase
        .from("opportunities")
        .insert({
          contact_id,
          user_id: ECOS_USER_ID,
          title,
          stage: stage ?? "prospect",
          value: value ?? null,
          expected_close_date: expected_close_date ?? null,
          notes: notes ?? null,
        })
        .select("id, title, stage")
        .single();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Created opportunity: "${data.title}" (${data.stage}) — ID: ${data.id}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 6: get_follow_ups_due ──────────────────────────────────────────────
server.registerTool(
  "get_follow_ups_due",
  {
    title: "Get Follow-Ups Due",
    description: "Contacts with a follow-up date within the next N days, split into overdue and upcoming.",
    inputSchema: {
      days: z.number().optional().default(7).describe("Look-ahead window in days"),
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS).optional(),
    },
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
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No follow-ups due in the next ${days} days.` }] };

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
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 7: update_contact ──────────────────────────────────────────────────
server.registerTool(
  "update_contact",
  {
    title: "Update Contact",
    description: "Update any field(s) on a contact by ID.",
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
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Updated contact ${contact_id}: ${Object.keys(patch).filter(k => k !== "updated_at").join(", ")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 8: get_contacts_by_domain ─────────────────────────────────────────
server.registerTool(
  "get_contacts_by_domain",
  {
    title: "Get Contacts by Domain",
    description: "List all contacts in a relationship domain.",
    inputSchema: {
      relationship_domain: z.enum(RELATIONSHIP_DOMAINS),
      administrative_status: z.enum(ADMIN_STATUSES).optional().default("active"),
      limit: z.number().optional().default(50),
    },
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
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No contacts in domain "${relationship_domain}".` }] };

      const lines = data.map((c) =>
        `• ${c.name}${c.company ? ` @ ${c.company}` : ""}${c.title ? ` (${c.title})` : ""} [${c.administrative_status}]${c.follow_up_date ? ` | follow-up: ${c.follow_up_date}` : ""}\n  ID: ${c.id}`
      );
      return { content: [{ type: "text" as const, text: `${data.length} contact(s) in ${relationship_domain}:\n\n${lines.join("\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 9: set_administrative_status ───────────────────────────────────────
server.registerTool(
  "set_administrative_status",
  {
    title: "Set Administrative Status",
    description: "Update the administrative_status of a contact. Optionally log a note to interactions.",
    inputSchema: {
      contact_id: z.string().uuid(),
      status: z.enum(ADMIN_STATUSES),
      note: z.string().optional().describe("Optional reason to log as an interaction"),
    },
  },
  async ({ contact_id, status, note }) => {
    try {
      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ administrative_status: status, updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return { content: [{ type: "text" as const, text: `Error: ${updateErr.message}` }], isError: true };

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

      return { content: [{ type: "text" as const, text: `Set contact ${contact_id} → ${status}${note ? ` (logged: "${note}")` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 10: link_thought_to_contact ────────────────────────────────────────
server.registerTool(
  "link_thought_to_contact",
  {
    title: "Link Thought to Contact",
    description: "Attach a BRAIN thought to a contact by appending its ID and preview to the thought_links JSONB array. Does not touch the notes field.",
    inputSchema: {
      contact_id: z.string().uuid(),
      thought_id: z.string().uuid().describe("UUID of the thought in the thoughts table"),
    },
  },
  async ({ contact_id, thought_id }) => {
    try {
      const { data: thought, error: thoughtErr } = await supabase
        .from("thoughts")
        .select("id, content")
        .eq("id", thought_id)
        .single();
      if (thoughtErr || !thought) return { content: [{ type: "text" as const, text: `Thought not found: ${thoughtErr?.message ?? "no row"}` }], isError: true };

      const content_preview = thought.content.slice(0, 140) + (thought.content.length > 140 ? "…" : "");

      const { data: contact, error: contactErr } = await supabase
        .from("professional_contacts")
        .select("thought_links")
        .eq("id", contact_id)
        .single();
      if (contactErr || !contact) return { content: [{ type: "text" as const, text: `Contact not found: ${contactErr?.message ?? "no row"}` }], isError: true };

      const existing: unknown[] = Array.isArray(contact.thought_links) ? contact.thought_links : [];
      const newEntry = { thought_id, content_preview, linked_at: new Date().toISOString() };
      const updated = [...existing, newEntry];

      const { error: updateErr } = await supabase
        .from("professional_contacts")
        .update({ thought_links: updated, updated_at: new Date().toISOString() })
        .eq("id", contact_id);
      if (updateErr) return { content: [{ type: "text" as const, text: `Error: ${updateErr.message}` }], isError: true };

      return { content: [{ type: "text" as const, text: `Linked thought ${thought_id} to contact ${contact_id}\nPreview: "${content_preview}"` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 11: get_briefing_context ───────────────────────────────────────────
server.registerTool(
  "get_briefing_context",
  {
    title: "Get Briefing Context",
    description: "Returns a structured briefing: follow-ups due in next 7 days, open opportunities by stage, and most recent interaction per domain. Designed for N2 Heartbeat.",
    inputSchema: {
      follow_up_days: z.number().optional().default(7),
    },
  },
  async ({ follow_up_days }) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const future = new Date();
      future.setDate(future.getDate() + (follow_up_days ?? 7));
      const futureStr = future.toISOString().split("T")[0];

      const [followUpsRes, oppsRes, interactionsRes] = await Promise.all([
        supabase
          .from("professional_contacts")
          .select("id, name, company, relationship_domain, follow_up_date")
          .lte("follow_up_date", futureStr)
          .not("follow_up_date", "is", null)
          .eq("administrative_status", "active")
          .order("follow_up_date", { ascending: true }),
        supabase
          .from("opportunities")
          .select("id, title, stage, value, expected_close_date, contact_id")
          .not("stage", "in", '("closed_won","closed_lost")')
          .order("expected_close_date", { ascending: true }),
        supabase
          .from("contact_interactions")
          .select("contact_id, interaction_type, summary, occurred_at, professional_contacts!inner(relationship_domain, name)")
          .order("occurred_at", { ascending: false })
          .limit(100),
      ]);

      const lines: string[] = ["=== ECOS CRM Briefing ===", ""];

      // Follow-ups
      const followUps = followUpsRes.data ?? [];
      const overdue = followUps.filter((c) => c.follow_up_date < today);
      const upcoming = followUps.filter((c) => c.follow_up_date >= today);
      lines.push(`── Follow-Ups (next ${follow_up_days} days) ──`);
      if (!followUps.length) {
        lines.push("None due.");
      } else {
        if (overdue.length) lines.push(`Overdue (${overdue.length}): ${overdue.map((c) => `${c.name} [${c.follow_up_date}]`).join(", ")}`);
        if (upcoming.length) lines.push(`Upcoming (${upcoming.length}): ${upcoming.map((c) => `${c.name} [${c.follow_up_date}]`).join(", ")}`);
      }
      lines.push("");

      // Opportunities by stage
      const opps = oppsRes.data ?? [];
      lines.push(`── Open Opportunities (${opps.length}) ──`);
      if (!opps.length) {
        lines.push("None.");
      } else {
        const byStage: Record<string, typeof opps> = {};
        for (const o of opps) byStage[o.stage] = [...(byStage[o.stage] ?? []), o];
        for (const [stage, items] of Object.entries(byStage)) {
          lines.push(`${stage} (${items.length}): ${items.map((o: {title: string; value?: number; expected_close_date?: string}) => `${o.title}${o.value ? ` $${o.value}` : ""}${o.expected_close_date ? ` [${o.expected_close_date}]` : ""}`).join(" | ")}`);
        }
      }
      lines.push("");

      // Most recent interaction per domain
      type InteractionRow = { contact_id: string; interaction_type: string; summary: string | null; occurred_at: string; professional_contacts: { relationship_domain: string; name: string } | null };
      const interactions = (interactionsRes.data ?? []) as InteractionRow[];
      const seenDomains = new Set<string>();
      const recentByDomain: InteractionRow[] = [];
      for (const i of interactions) {
        const domain = i.professional_contacts?.relationship_domain;
        if (domain && !seenDomains.has(domain)) {
          seenDomains.add(domain);
          recentByDomain.push(i);
        }
      }
      lines.push("── Recent Interaction per Domain ──");
      if (!recentByDomain.length) {
        lines.push("None.");
      } else {
        for (const i of recentByDomain) {
          const d = new Date(i.occurred_at).toLocaleDateString();
          lines.push(`${i.professional_contacts?.relationship_domain}: ${i.professional_contacts?.name} — ${i.interaction_type} [${d}]${i.summary ? ` "${i.summary}"` : ""}`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 12: get_linked_thoughts ────────────────────────────────────────────
server.registerTool(
  "get_linked_thoughts",
  {
    title: "Get Linked Thoughts",
    description: "Return the BRAIN thought_links array for a contact — the return lane of the BRAIN↔CRM bridge.",
    inputSchema: {
      contact_id: z.string().uuid(),
    },
  },
  async ({ contact_id }) => {
    try {
      const { data, error } = await supabase
        .from("professional_contacts")
        .select("name, thought_links")
        .eq("id", contact_id)
        .single();
      if (error || !data) return { content: [{ type: "text" as const, text: `Contact not found: ${error?.message ?? "no row"}` }], isError: true };

      const links: unknown[] = Array.isArray(data.thought_links) ? data.thought_links : [];
      if (!links.length) return { content: [{ type: "text" as const, text: `No BRAIN thoughts linked to ${data.name}.` }] };

      type ThoughtLink = { thought_id: string; content_preview: string; linked_at: string };
      const lines = (links as ThoughtLink[]).map((l, i) =>
        `${i + 1}. [${new Date(l.linked_at).toLocaleDateString()}] ${l.thought_id}\n   "${l.content_preview}"`
      );
      return { content: [{ type: "text" as const, text: `${links.length} linked thought(s) for ${data.name}:\n\n${lines.join("\n\n")}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// --- Hono App with Auth Check ---
const app = new Hono();

app.all("*", async (c) => {
  const provided = c.req.header("x-brain-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing access key" }, 401);
  }
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
