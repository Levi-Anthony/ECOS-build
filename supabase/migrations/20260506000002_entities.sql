-- entities: general entity substrate additive layer.
-- Keeps professional_contacts intact; entities are the layer underneath.
-- Contacts get an optional entity_id FK for future backfill — nullable, no migration required.
--
-- Tables: entities, entity_links
-- Patch:  professional_contacts.entity_id (nullable FK)
--
-- Depends on: 20260506000001 (set_artifact_updated_at function)

-- ─── entities ─────────────────────────────────────────────────────────────────
CREATE TABLE entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  entity_type  TEXT NOT NULL
    CHECK (entity_type IN (
      'person','organization','governance_body','domain','project','team','faction',
      'artifact','asset','client_account','software','hardware','service_environment',
      'location','event','book'
    )),
  aliases      TEXT[] DEFAULT '{}',
  description  TEXT,
  metadata     JSONB DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  tags         TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─── entity_links ─────────────────────────────────────────────────────────────
CREATE TABLE entity_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id    UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id      UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL
    CHECK (relationship_type IN (
      'member_of','part_of','owns','manages','affiliated_with',
      'employed_by','founded','governs','adjacent_to'
    )),
  notes             TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ─── Backlink from contacts → entities (nullable; backfill separately) ────────
ALTER TABLE professional_contacts
  ADD COLUMN entity_id UUID REFERENCES entities(id) ON DELETE SET NULL;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_entities_type     ON entities (entity_type);
CREATE INDEX idx_entities_status   ON entities (status);
-- GIN indexes for array + JSONB fields
CREATE INDEX idx_entities_aliases  ON entities USING gin (aliases);
CREATE INDEX idx_entities_tags     ON entities USING gin (tags);
CREATE INDEX idx_entities_metadata ON entities USING gin (metadata);
CREATE INDEX idx_entity_links_from ON entity_links (from_entity_id);
CREATE INDEX idx_entity_links_to   ON entity_links (to_entity_id);
-- Partial index on contacts.entity_id (sparse — most contacts won't have one yet)
CREATE INDEX idx_contacts_entity   ON professional_contacts (entity_id)
  WHERE entity_id IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE entities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_links  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON entities      FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON entity_links  FOR ALL USING (auth.role() = 'service_role');

GRANT ALL ON entities      TO service_role;
GRANT ALL ON entity_links  TO service_role;

-- ─── Trigger: updated_at (reuses function from canonical_artifacts migration) ─
CREATE TRIGGER trg_entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION set_artifact_updated_at();
