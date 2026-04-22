-- person_observations: analytical intelligence layer for contacts
-- Separate from contact_interactions (event log). Different concerns:
-- contact_interactions = events ("Called Victoria April 15")
-- person_observations = pattern insights ("Victoria uses format-capture moves under pressure")

CREATE TABLE person_observations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        uuid        NOT NULL REFERENCES professional_contacts(id) ON DELETE CASCADE,
  observation_type  text        NOT NULL CHECK (observation_type IN ('fact','observation','interpretation','hypothesis','strategy')),
  content           text        NOT NULL,
  confidence        integer     NOT NULL CHECK (confidence BETWEEN 1 AND 5),
  domain_context    text,
  observed_at       timestamptz NOT NULL DEFAULT now(),
  source            text        NOT NULL,
  linked_thought_id uuid        REFERENCES thoughts(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_person_obs_contact      ON person_observations(contact_id);
CREATE INDEX idx_person_obs_contact_type ON person_observations(contact_id, observation_type);
CREATE INDEX idx_person_obs_thought      ON person_observations(linked_thought_id)
  WHERE linked_thought_id IS NOT NULL;

ALTER TABLE person_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON person_observations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Anon read" ON person_observations
  FOR SELECT USING (true);
