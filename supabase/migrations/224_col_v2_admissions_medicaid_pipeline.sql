-- COL v2 Slice 8: admissions Medicaid substage tracking without altering admission_case_status.

ALTER TABLE public.admission_cases
  ADD COLUMN IF NOT EXISTS medicaid_pipeline_stage text;

ALTER TABLE public.admission_cases
  ALTER COLUMN medicaid_pipeline_stage SET DEFAULT 'prospect';

UPDATE public.admission_cases
SET medicaid_pipeline_stage = 'prospect'
WHERE medicaid_pipeline_stage IS NULL;

ALTER TABLE public.admission_cases
  ALTER COLUMN medicaid_pipeline_stage SET NOT NULL;

ALTER TABLE public.admission_cases
  DROP CONSTRAINT IF EXISTS admission_cases_medicaid_pipeline_stage_check;

ALTER TABLE public.admission_cases
  ADD CONSTRAINT admission_cases_medicaid_pipeline_stage_check
  CHECK (
    medicaid_pipeline_stage IN ('prospect', 'app_requested', 'pending', 'approved', 'denied', 'waitlist')
  );

CREATE INDEX IF NOT EXISTS idx_admission_cases_facility_medicaid_pipeline_stage
  ON public.admission_cases(facility_id, medicaid_pipeline_stage, updated_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.admission_cases.medicaid_pipeline_stage IS
  'COL Medicaid substage for admissions workflow: prospect, app_requested, pending, approved, denied, waitlist.';
