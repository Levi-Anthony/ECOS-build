// Opportunities tools — sales pipeline tracking.
//
// Contract convention: see ./CONVENTION.md.

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";
import { WRITE_APPEND } from "../lib/annotations.ts";
import { errorResult, structuredResult } from "../lib/format.ts";
import { writeResult } from "../lib/schemas.ts";

export const register: RegisterFn = (registrar, supabase, helpers) => {
  const { ECOS_USER_ID, OPPORTUNITY_STAGES } = helpers;

  registrar.registerTool(
  "create_opportunity",
  {
    title: "Create Opportunity",
    description:
      "Attach a pipeline opportunity to a contact.\n" +
      "Use when: tracking a deal/engagement for a contact. Not for: logging a touchpoint — use `log_interaction`.\n" +
      "Side effects: inserts one opportunities row (append).\n" +
      "Returns: { ok, id, title, stage }.",
    inputSchema: {
      contact_id: z.string().uuid(),
      title: z.string().describe("Opportunity title"),
      stage: z.enum(OPPORTUNITY_STAGES).optional().default("prospect"),
      value: z.number().optional().describe("Estimated value in dollars"),
      close_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
      notes: z.string().optional(),
    },
    outputSchema: writeResult({
      title: z.string(),
      stage: z.string(),
    }),
    annotations: WRITE_APPEND,
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
      if (error) return errorResult(`Error: ${error.message}`);
      return structuredResult(
        { ok: true, id: data.id, title: data.title, stage: data.stage },
        `Created opportunity: "${data.title}" (${data.stage}) — ID: ${data.id}`,
      );
    } catch (err: unknown) {
      return errorResult(`Error: ${(err as Error).message}`);
    }
  }
);

};
