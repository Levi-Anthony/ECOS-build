// Opportunities tools — sales pipeline tracking.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID, OPPORTUNITY_STAGES } = helpers;

  registrar.registerTool(
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

};
