import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

const RELATIONSHIP_DOMAINS = ["tango", "ttc", "outreach", "it", "music", "personal", "general"] as const;
const ADMIN_STATUSES = ["active", "passive", "administrative_closed", "community"] as const;
const OPPORTUNITY_STAGES = ["prospect", "qualified", "proposal", "closed_won", "closed_lost"] as const;

// Fixed UUID representing the single ECOS user (Levi). This system has one
// user and uses service-role auth — no Supabase auth users exist.
const ECOS_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

// --- MCP Server ---
const server = new McpServer({
  name: "ecos-mcp",
  version: "1.1.0",
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
          .select("id, title, stage, value, close_date, notes")
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
          lines.push(`• [${o.stage}] ${o.title}${o.value ? ` ($${o.value})` : ""}${o.close_date ? ` — closes ${o.close_date}` : ""}`);
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
      close_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
      notes: z.string().optional(),
    },
  },
  async ({ contact_id, title, stage, value, close_date, notes }) => {
    try {
      const { data, error } = await supabase
        .from("opportunities")
        .insert({
          contact_id,
          user_id: ECOS_USER_ID,
          title,
          stage: stage ?? "prospect",
          value: value ?? null,
          close_date: close_date ?? null,
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
          .select("id, title, stage, value, close_date, contact_id")
          .not("stage", "in", '("closed_won","closed_lost")')
          .order("close_date", { ascending: true }),
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
          lines.push(`${stage} (${items.length}): ${items.map((o: {title: string; value?: number; close_date?: string}) => `${o.title}${o.value ? ` $${o.value}` : ""}${o.close_date ? ` [${o.close_date}]` : ""}`).join(" | ")}`);
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

// ─── Tool 13: log_service_call ───────────────────────────────────────────────
server.registerTool(
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
server.registerTool(
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
server.registerTool(
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

      type LogRow = { id: string; contact_id: string; service_date: string; service_type: string; description: string; time_spent_minutes: number | null; professional_contacts: { name: string; company: string | null } | null };
      const byContact: Record<string, { name: string; logs: LogRow[]; totalMin: number }> = {};
      for (const l of data as LogRow[]) {
        const cid = l.contact_id;
        if (!byContact[cid]) byContact[cid] = { name: l.professional_contacts?.name ?? cid, logs: [], totalMin: 0 };
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
server.registerTool(
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
server.registerTool(
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

// ─── Tool 18: add_person_observation ────────────────────────────────────────
server.registerTool(
  "add_person_observation",
  {
    title: "Add Person Observation",
    description: "Record an analytical observation about a contact — pattern insight, interpretation, hypothesis, or strategy. Separate from interaction event logging.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      observation_type: z.enum(["fact", "observation", "interpretation", "hypothesis", "strategy"]),
      content: z.string().describe("The observation — a standalone statement that makes sense without surrounding context"),
      confidence: z.number().int().min(1).max(5).describe("Confidence 1-5"),
      domain_context: z.string().optional().describe("Domain this observation is scoped to, e.g. 'tango', 'ttc'"),
      observed_at: z.string().optional().describe("ISO timestamp — defaults to now"),
      source: z.string().optional().describe("Source client — defaults to 'claude-code'"),
      linked_thought_id: z.string().uuid().optional().describe("UUID of a BRAIN thought this observation is linked to"),
    },
  },
  async ({ contact_id, observation_type, content, confidence, domain_context, observed_at, source, linked_thought_id }) => {
    try {
      const { data, error } = await supabase
        .from("person_observations")
        .insert({
          contact_id,
          observation_type,
          content,
          confidence,
          domain_context: domain_context ?? null,
          observed_at: observed_at ?? new Date().toISOString(),
          source: source ?? "claude-code",
          linked_thought_id: linked_thought_id ?? null,
        })
        .select("id")
        .single();
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Observation recorded — ID: ${data.id}\nType: ${observation_type} | Confidence: ${confidence}/5${domain_context ? ` | Domain: ${domain_context}` : ""}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 19: get_person_observations ───────────────────────────────────────
server.registerTool(
  "get_person_observations",
  {
    title: "Get Person Observations",
    description: "Retrieve analytical observations for a contact, grouped by type. Separate from interaction history.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      observation_type: z.enum(["fact", "observation", "interpretation", "hypothesis", "strategy"]).optional().describe("Filter to one type"),
      limit: z.number().optional().default(20),
    },
  },
  async ({ contact_id, observation_type, limit }) => {
    try {
      let q = supabase
        .from("person_observations")
        .select("id, observation_type, content, confidence, domain_context, observed_at, linked_thought_id")
        .eq("contact_id", contact_id)
        .order("observed_at", { ascending: false })
        .limit(limit ?? 20);
      if (observation_type) q = q.eq("observation_type", observation_type);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No observations found for contact ${contact_id}${observation_type ? ` of type ${observation_type}` : ""}.` }] };

      type Obs = { id: string; observation_type: string; content: string; confidence: number; domain_context: string | null; observed_at: string; linked_thought_id: string | null };
      const grouped: Record<string, Obs[]> = {};
      for (const o of data as Obs[]) {
        if (!grouped[o.observation_type]) grouped[o.observation_type] = [];
        grouped[o.observation_type].push(o);
      }

      const lines: string[] = [`${data.length} observation(s) for contact ${contact_id}:\n`];
      for (const [type, items] of Object.entries(grouped)) {
        lines.push(`── ${type.toUpperCase()} (${items.length}) ──`);
        for (const o of items) {
          lines.push(`• [${o.confidence}/5] ${o.content}${o.domain_context ? ` [${o.domain_context}]` : ""}${o.linked_thought_id ? ` ◆ ${o.linked_thought_id}` : ""}`);
          lines.push(`  ${new Date(o.observed_at).toLocaleDateString()} | ID: ${o.id}`);
        }
        lines.push("");
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 20: compile_person_snapshot ───────────────────────────────────────
server.registerTool(
  "compile_person_snapshot",
  {
    title: "Compile Person Snapshot",
    description: "Write a versioned compiled person card for a contact. Uses compile_snapshot_tx to atomically flip the previous snapshot to is_current=false.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
      snapshot_content: z.string().describe("The compiled person card — readable prose summary"),
      domains_covered: z.array(z.string()).optional().describe("Domains this snapshot covers"),
      source_observation_ids: z.array(z.string().uuid()).optional().describe("person_observations UUIDs used as source"),
      source_thought_ids: z.array(z.string().uuid()).optional().describe("BRAIN thought UUIDs used as source"),
    },
  },
  async ({ contact_id, snapshot_content, domains_covered, source_observation_ids, source_thought_ids }) => {
    try {
      const { data, error } = await supabase.rpc("compile_snapshot_tx", {
        p_contact_id: contact_id,
        p_snapshot_content: snapshot_content,
        p_domains_covered: domains_covered ?? [],
        p_source_observation_ids: source_observation_ids ?? [],
        p_source_thought_ids: source_thought_ids ?? [],
        p_compiled_by: "claude-code",
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Person snapshot compiled — ID: ${data}\nContact: ${contact_id}` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 21: get_person_card ────────────────────────────────────────────────
server.registerTool(
  "get_person_card",
  {
    title: "Get Person Card",
    description: "Composite person card: contact header, latest compiled snapshot, recent observations grouped by type, and linked BRAIN thoughts. Primary agent entry point for pre-meeting context.",
    inputSchema: {
      contact_id: z.string().uuid().describe("Contact UUID"),
    },
  },
  async ({ contact_id }) => {
    try {
      const [contactRes, snapshotRes, observationsRes] = await Promise.all([
        supabase.from("professional_contacts").select("*").eq("id", contact_id).single(),
        supabase.from("person_snapshots").select("snapshot_content, domains_covered, compiled_by, version, created_at").eq("contact_id", contact_id).eq("is_current", true).maybeSingle(),
        supabase.from("person_observations").select("observation_type, content, confidence, domain_context, observed_at, linked_thought_id").eq("contact_id", contact_id).order("observed_at", { ascending: false }).limit(10),
      ]);

      if (contactRes.error || !contactRes.data) return { content: [{ type: "text" as const, text: `Contact not found: ${contactRes.error?.message ?? "no row"}` }], isError: true };
      const c = contactRes.data;

      const lines: string[] = [
        `=== ${c.name} ===`,
        c.company ? `Company: ${c.company}` : "",
        c.title ? `Title: ${c.title}` : "",
        `Domain: ${c.relationship_domain} | Status: ${c.administrative_status}`,
        c.email ? `Email: ${c.email}` : "",
        c.phone ? `Phone: ${c.phone}` : "",
        c.follow_up_date ? `Follow-up: ${c.follow_up_date}` : "",
        "",
      ].filter(l => l !== "");

      // Snapshot
      const snap = snapshotRes.data;
      lines.push("── Person Card ──");
      if (snap) {
        lines.push(`v${snap.version} · ${new Date(snap.created_at).toLocaleDateString()} · ${snap.compiled_by}`);
        lines.push(snap.snapshot_content);
      } else {
        lines.push("No compiled snapshot yet.");
      }
      lines.push("");

      // Observations
      type Obs = { observation_type: string; content: string; confidence: number; domain_context: string | null; observed_at: string; linked_thought_id: string | null };
      const obs = (observationsRes.data ?? []) as Obs[];
      if (obs.length) {
        lines.push("── Observations ──");
        const grouped: Record<string, Obs[]> = {};
        for (const o of obs) {
          if (!grouped[o.observation_type]) grouped[o.observation_type] = [];
          grouped[o.observation_type].push(o);
        }
        for (const [type, items] of Object.entries(grouped)) {
          lines.push(`${type}:`);
          for (const o of items) {
            lines.push(`  [${o.confidence}/5] ${o.content}${o.domain_context ? ` [${o.domain_context}]` : ""}`);
          }
        }
        lines.push("");
      }

      // Linked BRAIN thoughts
      const thoughtLinks: unknown[] = Array.isArray(c.thought_links) ? c.thought_links : [];
      if (thoughtLinks.length) {
        lines.push("── BRAIN Links ──");
        type TL = { thought_id: string; content_preview: string; linked_at: string };
        for (const l of thoughtLinks as TL[]) {
          lines.push(`• ${l.thought_id}\n  "${l.content_preview}"`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 22: search_brain_for_contact ──────────────────────────────────────
server.registerTool(
  "search_brain_for_contact",
  {
    title: "Search BRAIN for Contact",
    description: "Semantic search of BRAIN thoughts using a contact's name and optional domain. Uses threshold 0.30 by default — lower than standard to surface analytical/framework entries about people.",
    inputSchema: {
      contact_name: z.string().describe("Person's name to search for, e.g. 'Victoria Hermosilla'"),
      domain_context: z.string().optional().describe("Optional domain filter, e.g. 'tango', 'ttc'"),
      limit: z.number().optional().default(10),
      threshold: z.number().optional().default(0.30),
    },
  },
  async ({ contact_name, domain_context, limit, threshold }) => {
    try {
      if (!OPENROUTER_API_KEY) {
        return { content: [{ type: "text" as const, text: "Error: OPENROUTER_API_KEY not configured in ecos-crm-mcp secrets. Add it via Supabase Dashboard → Edge Functions → ecos-crm-mcp → Secrets." }], isError: true };
      }
      const query = `${contact_name}${domain_context ? " " + domain_context : ""} person notes observations pattern behavior`;
      const embedding = await getEmbedding(query);

      const { data, error } = await supabase.rpc("match_thoughts", {
        query_embedding: embedding,
        match_threshold: threshold ?? 0.30,
        match_count: limit ?? 10,
        filter: {},
      });
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: `No BRAIN entries found for "${contact_name}" at threshold ${threshold ?? 0.30}.` }] };

      type ThoughtMatch = { id: string; content: string; similarity: number; metadata?: { domain?: string; type?: string; signal_type?: string } };
      const results = data as ThoughtMatch[];
      const lines: string[] = [`${results.length} BRAIN entry(ies) for "${contact_name}":\n`];
      for (const t of results) {
        const sim = (t.similarity * 100).toFixed(1);
        const meta = t.metadata ?? {};
        lines.push(`• [${sim}%] ${meta.type ?? ""}${meta.domain ? " · " + meta.domain : ""}${meta.signal_type ? " · " + meta.signal_type : ""}`);
        lines.push(`  ${t.content.slice(0, 200)}${t.content.length > 200 ? "…" : ""}`);
        lines.push(`  ID: ${t.id}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// === TASTE preferences ===========================================================
// taste_preferences is the structured extension table for taste signals.
// capture_taste_preference dual-writes: a structured row + a thoughts mirror
// (so semantic search continues to surface taste preferences). update_taste_preference
// logs every change to taste_evolution as audit history.

server.registerTool(
  "capture_taste_preference",
  {
    title: "Capture Taste Preference",
    description:
      "Capture a TASTE preference as a structured taste_preferences row, with a thoughts mirror for semantic search. Use after the Taste Harvest Protocol surfaces a candidate and Levi approves it. The Prompt-4 fields are: Preference Name, Domain, Reject (specific and observable), Want (specific and observable), Type (free-form slash-format like 'Session discipline / Process').",
    inputSchema: {
      preference_name: z.string().describe("Short name for the preference"),
      domain: z.string().describe("Where this preference applies"),
      reject: z.string().describe("What to reject — specific and observable"),
      want: z.string().describe("What to do instead — specific and observable"),
      type_label: z.string().describe("Free-form type label, often slash-format (e.g., 'Session discipline / Process')"),
      contact_id: z.string().uuid().optional().describe("Optionally scope this preference to a specific contact"),
      source: z.string().optional().describe("Where this signal came from (defaults to 'mcp:capture_taste_preference')"),
    },
  },
  async ({ preference_name, domain, reject, want, type_label, contact_id, source }) => {
    try {
      const content = `TASTE:: Preference Name: ${preference_name}. Domain: ${domain}. Reject: ${reject} Want: ${want} Type: ${type_label}.`;

      const { data: tasteRow, error: tasteErr } = await supabase
        .from("taste_preferences")
        .insert({
          user_id: ECOS_USER_ID,
          preference_name,
          domain,
          reject,
          want,
          type_label,
          constraint_text: content,
          source: source ?? "mcp:capture_taste_preference",
          contact_id: contact_id ?? null,
          status: "active",
        })
        .select("id")
        .single();
      if (tasteErr || !tasteRow) {
        return { content: [{ type: "text" as const, text: `Failed to insert taste_preferences row: ${tasteErr?.message ?? "no row returned"}` }], isError: true };
      }

      const embedding = await getEmbedding(content);
      const { data: thoughtRow, error: thoughtErr } = await supabase
        .from("thoughts")
        .insert({
          content,
          original_content: content,
          embedding,
          metadata: {
            signal_type: "taste",
            domain,
            type: "observation",
            topics: [domain, "taste-preference"],
            taste_preference_id: tasteRow.id,
            source: "mcp:capture_taste_preference",
          },
        })
        .select("id")
        .single();
      if (thoughtErr || !thoughtRow) {
        return { content: [{ type: "text" as const, text: `taste_preferences row inserted (${tasteRow.id}) but thoughts mirror failed: ${thoughtErr?.message ?? "no row returned"}` }], isError: true };
      }

      const { error: linkErr } = await supabase
        .from("taste_preferences")
        .update({ thought_id: thoughtRow.id })
        .eq("id", tasteRow.id);
      if (linkErr) {
        return { content: [{ type: "text" as const, text: `Both rows created (taste=${tasteRow.id}, thought=${thoughtRow.id}) but back-link failed: ${linkErr.message}` }], isError: true };
      }

      return {
        content: [{
          type: "text" as const,
          text: `Captured taste preference ${tasteRow.id} ↔ thought ${thoughtRow.id}\nName: ${preference_name}\nDomain: ${domain}\nType: ${type_label}`,
        }],
      };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.registerTool(
  "update_taste_preference",
  {
    title: "Update Taste Preference",
    description:
      "Update a taste_preferences row. Logs the change to taste_evolution as an audit row (taste_id, change_type, old_value, new_value, reason). Use change_type 'refined' for content changes, 'archived' to retire, 'upgraded'/'downgraded' for status shifts.",
    inputSchema: {
      id: z.string().uuid(),
      changes: z.object({
        preference_name: z.string().optional(),
        domain: z.string().optional(),
        reject: z.string().optional(),
        want: z.string().optional(),
        type_label: z.string().optional(),
        status: z.enum(["active", "archived", "superseded"]).optional(),
        invocation_count: z.number().int().nonnegative().optional(),
      }),
      change_type: z.enum(["upgraded", "downgraded", "refined", "archived"]),
      reason: z.string().describe("Why this change is being made"),
    },
  },
  async ({ id, changes, change_type, reason }) => {
    try {
      const { data: existing, error: fetchErr } = await supabase
        .from("taste_preferences")
        .select("*")
        .eq("id", id)
        .single();
      if (fetchErr || !existing) {
        return { content: [{ type: "text" as const, text: `Not found: ${fetchErr?.message ?? "no row"}` }], isError: true };
      }

      const newValue = { ...existing, ...changes };
      const { error: evoErr } = await supabase.from("taste_evolution").insert({
        taste_id: id,
        change_type,
        old_value: JSON.stringify(existing),
        new_value: JSON.stringify(newValue),
        reason,
        approved: true,
        applied_at: new Date().toISOString(),
      });
      if (evoErr) {
        return { content: [{ type: "text" as const, text: `Failed to log evolution row: ${evoErr.message}` }], isError: true };
      }

      const { error: updateErr } = await supabase
        .from("taste_preferences")
        .update(changes)
        .eq("id", id);
      if (updateErr) {
        return { content: [{ type: "text" as const, text: `Evolution logged but update failed: ${updateErr.message}` }], isError: true };
      }

      return { content: [{ type: "text" as const, text: `Updated taste preference ${id} (${change_type}); audit row logged.` }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

server.registerTool(
  "list_taste_preferences",
  {
    title: "List Taste Preferences",
    description:
      "List taste preferences with optional filters. Returns active preferences first by default, sorted by invocation_count DESC then most recent. Use this to retrieve the operative taste profile before sessions or to find candidates for refinement.",
    inputSchema: {
      domain: z.string().optional().describe("Filter by domain"),
      status: z.enum(["active", "archived", "superseded"]).optional().describe("Filter by status (defaults to all)"),
      limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)"),
    },
  },
  async ({ domain, status, limit }) => {
    try {
      let q = supabase
        .from("taste_preferences")
        .select("id, preference_name, domain, reject, want, type_label, status, invocation_count, last_invoked_at, created_at, thought_id")
        .order("status", { ascending: true })
        .order("invocation_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit ?? 50);
      if (domain) q = q.eq("domain", domain);
      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
      if (!data?.length) return { content: [{ type: "text" as const, text: "No taste preferences found." }] };

      const lines: string[] = [`${data.length} taste preference(s):\n`];
      for (const row of data as Array<{ id: string; preference_name: string | null; domain: string | null; type_label: string | null; status: string; invocation_count: number; reject: string | null; want: string | null }>) {
        lines.push(`• [${row.status}] ${row.preference_name ?? "(unnamed)"} — ${row.type_label ?? ""}${row.domain ? " · " + row.domain : ""}`);
        if (row.reject) lines.push(`  Reject: ${row.reject.slice(0, 120)}${row.reject.length > 120 ? "…" : ""}`);
        if (row.want) lines.push(`  Want: ${row.want.slice(0, 120)}${row.want.length > 120 ? "…" : ""}`);
        lines.push(`  ID: ${row.id} · invocations: ${row.invocation_count}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  },
);

// --- Hono App with Auth Check ---
const app = new Hono();

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS", "DELETE"],
  allowHeaders: ["Content-Type", "x-brain-key", "Authorization", "mcp-session-id"],
  maxAge: 86400,
}));

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
