-- Med reconciliation intake: disposition + expected discharge (operational; UI-only workflow fields).

CREATE TYPE discharge_plan_category AS ENUM (
  'planned',
  'hospital_transfer',
  'ama',
  'higher_level_of_care',
  'death',
  'other'
);

ALTER TABLE discharge_med_reconciliation
  ADD COLUMN discharge_plan_category discharge_plan_category,
  ADD COLUMN expected_discharge_date date;

COMMENT ON COLUMN discharge_med_reconciliation.discharge_plan_category IS 'How the discharge is categorized for operational tracking (draft intake).';

COMMENT ON COLUMN discharge_med_reconciliation.expected_discharge_date IS 'Anticipated discharge date when the reconciliation draft is opened.';
