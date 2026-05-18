-- Admissions intake: optional draft milestone + anticipated payer attribution on cases.

ALTER TYPE admission_case_status ADD VALUE 'draft';

CREATE TYPE anticipated_payer_source AS ENUM (
  'private_pay',
  'medicaid_pending',
  'medicaid_approved',
  'ltc_insurance',
  'va_benefits',
  'other'
);

ALTER TABLE admission_cases
  ADD COLUMN anticipated_payer_source anticipated_payer_source NULL,
  ADD COLUMN anticipated_payer_other text NULL;

COMMENT ON COLUMN admission_cases.anticipated_payer_source IS 'Preliminary payer classification captured at intake; final payer setup follows case workflow.';
COMMENT ON COLUMN admission_cases.anticipated_payer_other IS 'Free-text when anticipated_payer_source is other.';
COMMENT ON COLUMN admission_cases.status IS 'Includes draft for save-for-later intake without reserving a bed yet.';
