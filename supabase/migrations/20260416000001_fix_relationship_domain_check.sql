-- The professional_contacts.relationship_domain column predates Sprint 4b and
-- has a narrower CHECK constraint that excludes 'ttc' and 'it'. This migration
-- drops the existing constraint and replaces it with the full ECOS domain set.

ALTER TABLE professional_contacts
  DROP CONSTRAINT IF EXISTS professional_contacts_relationship_domain_check;

ALTER TABLE professional_contacts
  ADD CONSTRAINT professional_contacts_relationship_domain_check
  CHECK (relationship_domain IN ('tango','ttc','outreach','it','music','personal','general'));
