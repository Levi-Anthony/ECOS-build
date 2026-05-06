// Briefing tools — composite operational reports across CRM domain state.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID, RELATIONSHIP_DOMAINS } = helpers;

  registrar.registerTool(
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

};
