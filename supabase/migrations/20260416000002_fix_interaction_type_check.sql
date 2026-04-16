-- contact_interactions.interaction_type had a narrow CHECK from the original
-- schema. Expanding to cover all ECOS interaction types.

ALTER TABLE contact_interactions
  DROP CONSTRAINT IF EXISTS contact_interactions_interaction_type_check;

ALTER TABLE contact_interactions
  ADD CONSTRAINT contact_interactions_interaction_type_check
  CHECK (interaction_type IN (
    'email','call','meeting','text','coffee',
    'video_call','message','in_person','note','slack',
    'lunch','phone_call','visit','conference',
    'follow_up','check_in','status_change'
  ));
