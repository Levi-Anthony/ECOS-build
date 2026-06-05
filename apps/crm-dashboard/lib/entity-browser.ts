import type { Entity, EntityLink } from "@/lib/supabase";

export const formatEntityType = (entityType: string): string =>
  entityType
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export const countEntityLinks = (links: EntityLink[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.from_entity_id, (counts.get(link.from_entity_id) ?? 0) + 1);
    counts.set(link.to_entity_id, (counts.get(link.to_entity_id) ?? 0) + 1);
  }
  return counts;
};

export const entityMatchesSearch = (entity: Entity, search: string): boolean => {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return [
    entity.name,
    entity.entity_type,
    entity.description ?? "",
    ...entity.aliases,
    ...entity.tags,
  ].some((value) => value.toLowerCase().includes(normalized));
};
