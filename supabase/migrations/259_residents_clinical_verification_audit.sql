-- Resident detail surface: clinician-verification audit timestamps (survey / compliance cues).
-- RLS inherits from existing residents UPDATE policies — no policy change.

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS code_status_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS code_status_verified_by uuid NULL REFERENCES auth.users (id),
  ADD COLUMN IF NOT EXISTS allergy_list_reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS allergy_list_reviewed_by uuid NULL REFERENCES auth.users (id),
  ADD COLUMN IF NOT EXISTS primary_diagnosis_reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS primary_diagnosis_reviewed_by uuid NULL REFERENCES auth.users (id);

COMMENT ON COLUMN public.residents.code_status_verified_at IS 'When code status was last verified with paperwork / surrogate (operator timestamp).';
COMMENT ON COLUMN public.residents.code_status_verified_by IS 'Operator who verified code status.';
COMMENT ON COLUMN public.residents.allergy_list_reviewed_at IS 'When allergy list was last clinically reviewed.';
COMMENT ON COLUMN public.residents.allergy_list_reviewed_by IS 'Operator who reviewed allergies.';
COMMENT ON COLUMN public.residents.primary_diagnosis_reviewed_at IS 'When primary / problem list diagnoses were last updated for survey.';
COMMENT ON COLUMN public.residents.primary_diagnosis_reviewed_by IS 'Operator who updated diagnoses.';
