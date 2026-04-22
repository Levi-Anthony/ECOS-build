-- person_snapshots: versioned compiled person cards
-- Append-only. is_current=true marks the latest version per contact.
-- Write via compile_snapshot_tx RPC only — never direct insert — to preserve is_current integrity.

CREATE TABLE person_snapshots (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id             uuid        NOT NULL REFERENCES professional_contacts(id) ON DELETE CASCADE,
  snapshot_content       text        NOT NULL,
  domains_covered        text[]      NOT NULL DEFAULT '{}',
  source_observation_ids uuid[]      NOT NULL DEFAULT '{}',
  source_thought_ids     uuid[]      NOT NULL DEFAULT '{}',
  compiled_by            text        NOT NULL,
  version                integer     NOT NULL DEFAULT 1,
  is_current             boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_person_snap_contact_current ON person_snapshots(contact_id, is_current);
CREATE INDEX idx_person_snap_contact_version ON person_snapshots(contact_id, version DESC);

ALTER TABLE person_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON person_snapshots
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Anon read" ON person_snapshots
  FOR SELECT USING (true);

-- Atomic snapshot write: flips previous is_current=false, inserts new version.
-- Mirrors create_billing_entry_tx pattern from 20260416000003.
CREATE OR REPLACE FUNCTION compile_snapshot_tx(
  p_contact_id             uuid,
  p_snapshot_content       text,
  p_domains_covered        text[],
  p_source_observation_ids uuid[],
  p_source_thought_ids     uuid[],
  p_compiled_by            text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_next_version integer;
  v_new_id       uuid;
BEGIN
  SELECT coalesce(max(version), 0) + 1
    INTO v_next_version
    FROM person_snapshots
    WHERE contact_id = p_contact_id;

  UPDATE person_snapshots
    SET is_current = false
    WHERE contact_id = p_contact_id AND is_current = true;

  INSERT INTO person_snapshots
    (contact_id, snapshot_content, domains_covered, source_observation_ids,
     source_thought_ids, compiled_by, version, is_current)
  VALUES
    (p_contact_id, p_snapshot_content, p_domains_covered, p_source_observation_ids,
     p_source_thought_ids, p_compiled_by, v_next_version, true)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
