// Briefing tools — composite operational reports across CRM domain state.
//
// Contract convention: see ./CONVENTION.md.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { READ_ONLY } from "../lib/annotations.ts";
import { errorResult, structuredResult } from "../lib/format.ts";
import { OpportunityBriefSchema } from "../lib/schemas.ts";

export const register: RegisterFn = (registrar, supabase, _helpers) => {

  registrar.registerTool(
  "get_briefing_context",
  {
    title: "Get Briefing Context",
    description:
      "Composite operational briefing: follow-ups due in the next N days (overdue/upcoming), open opportunities by stage, and the most recent interaction per domain. Designed for N2 Heartbeat.\n" +
      "Use when: generating a standup/heartbeat across the whole CRM. Not for: a single contact — use `get_contact_history`/`get_person_card`; just follow-ups — use `get_follow_ups_due`.\n" +
      "Side effects: none; read only.\n" +
      "Returns: { follow_ups:{overdue,upcoming}, opportunities[], recent_interactions_by_domain[] }.",
    inputSchema: {
      follow_up_days: z.number().optional().default(7),
    },
    outputSchema: {
      follow_ups: z.object({
        overdue:  z.array(z.record(z.string(), z.unknown())),
        upcoming: z.array(z.record(z.string(), z.unknown())),
      }),
      opportunities: z.array(OpportunityBriefSchema),
      recent_interactions_by_domain: z.array(z.record(z.string(), z.unknown())),
    },
    annotations: READ_ONLY,
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
      type InteractionRow = { contact_id: string; interaction_type: string; summary: string | null; occurred_at: string; professional_contacts: { relationship_domain: string; name: string }[] };
      const interactions = (interactionsRes.data ?? []) as InteractionRow[];
      const seenDomains = new Set<string>();
      const recentByDomain: InteractionRow[] = [];
      for (const i of interactions) {
        const domain = i.professional_contacts[0]?.relationship_domain;
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
          lines.push(`${i.professional_contacts[0]?.relationship_domain}: ${i.professional_contacts[0]?.name} — ${i.interaction_type} [${d}]${i.summary ? ` "${i.summary}"` : ""}`);
        }
      }

      const recentInteractionsByDomain = recentByDomain.map((i) => ({
        domain:           i.professional_contacts[0]?.relationship_domain ?? null,
        name:             i.professional_contacts[0]?.name ?? null,
        contact_id:       i.contact_id,
        interaction_type: i.interaction_type,
        summary:          i.summary,
        occurred_at:      i.occurred_at,
      }));

      return structuredResult(
        {
          follow_ups: { overdue, upcoming },
          opportunities: opps,
          recent_interactions_by_domain: recentInteractionsByDomain,
        },
        lines.join("\n"),
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

};
