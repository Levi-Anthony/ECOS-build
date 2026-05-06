// Entities tools — general entity substrate.
// 3 tools: add_entity, search_entities, link_entities.
//
// Additive layer: professional_contacts stay intact.
// Entities generalize beyond people: organizations, governance bodies, domains,
// projects, assets, books, locations, events, etc.
// Contacts get an optional entity_id FK (see migration 20260506000002).

import { z } from "zod";
import type { RegisterFn } from "../helpers.ts";

const ENTITY_TYPES = [
  "person","organization","governance_body","domain","project","team","faction",
  "artifact","asset","client_account","software","hardware","service_environment",
  "location","event","book",
] as const;

const LINK_RELATIONSHIP_TYPES = [
  "member_of","part_of","owns","manages","affiliated_with",
  "employed_by","founded","governs","adjacent_to",
] as const;

export const register: RegisterFn = (registrar, supabase, _helpers) => {

  // ── Tool 1: add_entity ────────────────────────────────────────────────────
  registrar.registerTool(
    "add_entity",
    {
      title: "Add Entity",
      description:
        "Create a new entity — organization, governance body, domain, project, person, asset, etc. Use when a non-contact entity needs to be tracked and linked to thoughts, artifacts, or contacts.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        name:        z.string().describe("Entity name"),
        entity_type: z.enum(ENTITY_TYPES).describe("person | organization | governance_body | domain | project | team | faction | artifact | asset | client_account | software | hardware | service_environment | location | event | book"),
        description: z.string().optional().describe("Short description of what this entity is"),
        aliases:     z.array(z.string()).optional().describe("Alternative names or abbreviations"),
        tags:        z.array(z.string()).optional(),
        metadata:    z.record(z.unknown()).optional().describe("Additional structured fields"),
      },
    },
    async ({ name, entity_type, description, aliases, tags, metadata }) => {
      try {
        const { data, error } = await supabase
          .from("entities")
          .insert({
            name,
            entity_type,
            description: description ?? null,
            aliases:  aliases  ?? [],
            tags:     tags     ?? [],
            metadata: metadata ?? {},
            status: "active",
          })
          .select("id")
          .single();
        if (error || !data) {
          return { content: [{ type: "text" as const, text: `Failed to create entity: ${error?.message ?? "no row"}` }], isError: true };
        }
        return {
          content: [{
            type: "text" as const,
            text: [
              `Created entity ${(data as { id: string }).id}`,
              `  Name: ${name} [${entity_type}]`,
              description ? `  ${description}` : null,
            ].filter(Boolean).join("\n"),
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 2: search_entities ───────────────────────────────────────────────
  registrar.registerTool(
    "search_entities",
    {
      title: "Search Entities",
      description:
        "Search entities by name or description substring. Returns active entities by default. Optionally filter by entity_type. Use to look up organizations, governance bodies, domains, projects, and other non-person entities.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query:       z.string().describe("Name or description to match"),
        entity_type: z.enum(ENTITY_TYPES).optional().describe("Filter by type"),
        status:      z.enum(["active","archived"]).optional().describe("Filter by status (default: active)"),
        limit:       z.number().int().min(1).max(50).optional().default(20),
      },
    },
    async ({ query, entity_type, status, limit }) => {
      try {
        let q = supabase
          .from("entities")
          .select("id, name, entity_type, description, aliases, tags, status, created_at")
          .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
          .eq("status", status ?? "active")
          .order("name", { ascending: true })
          .limit(limit ?? 20);
        if (entity_type) q = q.eq("entity_type", entity_type);

        const { data, error } = await q;
        if (error) return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
        if (!data?.length) return { content: [{ type: "text" as const, text: `No entities found matching "${query}".` }] };

        type EntityRow = { id: string; name: string; entity_type: string; description: string | null; aliases: string[]; tags: string[]; status: string; created_at: string };
        const lines = [`${data.length} entity/entities:\n`];
        for (const e of data as EntityRow[]) {
          lines.push(`• ${e.name} [${e.entity_type}]${e.status !== "active" ? ` (${e.status})` : ""}`);
          if (e.description) lines.push(`  ${e.description}`);
          if (e.aliases?.length) lines.push(`  Aliases: ${e.aliases.join(", ")}`);
          if (e.tags?.length) lines.push(`  Tags: ${e.tags.join(", ")}`);
          lines.push(`  ID: ${e.id} | Created: ${new Date(e.created_at).toLocaleDateString()}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // ── Tool 3: link_entities ─────────────────────────────────────────────────
  registrar.registerTool(
    "link_entities",
    {
      title: "Link Entities",
      description:
        "Create a directed relationship between two entities. Examples: (TTC board member) member_of (TTC), (Levi) governs (ECTango), (ECOS) part_of (BRAIN).",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        from_entity_id:    z.string().uuid().describe("Source entity ID"),
        to_entity_id:      z.string().uuid().describe("Target entity ID"),
        relationship_type: z.enum(LINK_RELATIONSHIP_TYPES).describe("member_of | part_of | owns | manages | affiliated_with | employed_by | founded | governs | adjacent_to"),
        notes:             z.string().optional(),
      },
    },
    async ({ from_entity_id, to_entity_id, relationship_type, notes }) => {
      try {
        const { data, error } = await supabase
          .from("entity_links")
          .insert({
            from_entity_id,
            to_entity_id,
            relationship_type,
            notes: notes ?? null,
          })
          .select("id")
          .single();
        if (error || !data) {
          return { content: [{ type: "text" as const, text: `Failed to create entity link: ${error?.message ?? "no row"}` }], isError: true };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Entity link created: ${from_entity_id} —[${relationship_type}]→ ${to_entity_id}. Link ID: ${(data as { id: string }).id}`,
          }],
        };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    },
  );
};
