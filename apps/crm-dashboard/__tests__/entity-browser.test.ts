import { describe, expect, it } from "vitest";
import { countEntityLinks, entityMatchesSearch, formatEntityType } from "@/lib/entity-browser";
import type { Entity, EntityLink } from "@/lib/supabase";

const entity: Entity = {
  id: "e1",
  name: "Tucson Tango Collective",
  entity_type: "governance_body",
  aliases: ["TTC"],
  description: "A community governance body.",
  metadata: {},
  status: "active",
  tags: ["tango", "governance"],
  created_at: "2026-06-05",
  updated_at: "2026-06-05",
};

const link = (id: string, from: string, to: string): EntityLink => ({
  id,
  from_entity_id: from,
  to_entity_id: to,
  relationship_type: "part_of",
  notes: null,
  metadata: {},
  created_at: "2026-06-05",
});

describe("entity browser helpers", () => {
  it("formats entity types for humans", () => {
    expect(formatEntityType("governance_body")).toBe("Governance Body");
  });

  it("searches names, descriptions, aliases, and tags", () => {
    expect(entityMatchesSearch(entity, "TTC")).toBe(true);
    expect(entityMatchesSearch(entity, "community")).toBe(true);
    expect(entityMatchesSearch(entity, "governance")).toBe(true);
    expect(entityMatchesSearch(entity, "hardware")).toBe(false);
  });

  it("counts incoming and outgoing relationships", () => {
    const counts = countEntityLinks([
      link("l1", "e1", "e2"),
      link("l2", "e3", "e1"),
    ]);
    expect(counts.get("e1")).toBe(2);
    expect(counts.get("e2")).toBe(1);
    expect(counts.get("e3")).toBe(1);
  });
});
