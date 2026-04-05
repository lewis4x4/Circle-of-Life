-- Module 18 Enhanced — Insurance intelligence (AI narrative + TCoR hooks; human review required)

ALTER TABLE renewal_data_packages
  ADD COLUMN ai_narrative_draft text;

ALTER TABLE renewal_data_packages
  ADD COLUMN ai_narrative_generated_at timestamptz;

ALTER TABLE renewal_data_packages
  ADD COLUMN narrative_reviewed_by uuid REFERENCES auth.users (id);

ALTER TABLE renewal_data_packages
  ADD COLUMN narrative_reviewed_at timestamptz;

ALTER TABLE renewal_data_packages
  ADD COLUMN narrative_published_by uuid REFERENCES auth.users (id);

ALTER TABLE renewal_data_packages
  ADD COLUMN narrative_published_at timestamptz;

COMMENT ON COLUMN renewal_data_packages.ai_narrative_draft IS 'AI-generated; must not be used externally until reviewed and published.';
