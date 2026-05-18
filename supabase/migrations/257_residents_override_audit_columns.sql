-- Administrative bypass: auditable override justification (Quiet Operator / surveyor-facing).

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS override_reason text NULL,
  ADD COLUMN IF NOT EXISTS override_full_intake_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.residents.override_reason IS 'Required when created via override intake path; audit anchor.';
COMMENT ON COLUMN public.residents.override_full_intake_pending IS 'Operator commits to completing full intake within policy window.';
