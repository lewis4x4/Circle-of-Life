-- Admissions intake form (Quiet Operator): optional program classification + provisional resident profiles.

ALTER TABLE public.admission_cases
  ADD COLUMN IF NOT EXISTS intake_program_type text NULL;

COMMENT ON COLUMN public.admission_cases.intake_program_type IS 'Optional intake classification from admissions form (e.g. long_term, short_term_respite).';

ALTER TABLE public.residents
  ALTER COLUMN date_of_birth DROP NOT NULL;
