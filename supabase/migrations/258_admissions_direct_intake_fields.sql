-- Direct admit intake: gender expansion, resident contact/name fields, admission case source channel.

ALTER TYPE gender ADD VALUE IF NOT EXISTS 'non_binary';

CREATE TYPE admission_case_source AS ENUM (
  'walk_in',
  'hospital_discharge_no_referral',
  'facility_transfer_no_referral',
  'family_initiated',
  'other'
);

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS name_suffix text NULL,
  ADD COLUMN IF NOT EXISTS primary_phone text NULL,
  ADD COLUMN IF NOT EXISTS gender_other text NULL;

COMMENT ON COLUMN public.residents.name_suffix IS 'Optional name suffix (e.g. Jr., Sr., III).';
COMMENT ON COLUMN public.residents.primary_phone IS 'Resident or primary family contact phone for early intake follow-up.';
COMMENT ON COLUMN public.residents.gender_other IS 'Free text when gender is other; keep enum value as other.';

ALTER TABLE public.admission_cases
  ADD COLUMN IF NOT EXISTS source admission_case_source NULL,
  ADD COLUMN IF NOT EXISTS source_other text NULL;

COMMENT ON COLUMN public.admission_cases.source IS 'Direct-intake admission channel (non-referral paths).';
COMMENT ON COLUMN public.admission_cases.source_other IS 'Free text when source is other.';
