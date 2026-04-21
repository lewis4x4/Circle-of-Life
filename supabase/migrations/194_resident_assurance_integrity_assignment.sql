-- Migration 194: Resident Assurance integrity assignment workflow
-- Adds assignee fields to resident_observation_integrity_flags so the queue can
-- support explicit ownership without a redesign.

ALTER TABLE public.resident_observation_integrity_flags
  ADD COLUMN IF NOT EXISTS assigned_to_staff_id uuid REFERENCES public.staff(id),
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_obs_integrity_flags_assignee
  ON public.resident_observation_integrity_flags (facility_id, status, assigned_to_staff_id, detected_at DESC)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.resident_observation_integrity_flags.assigned_to_staff_id IS
  'Optional staff assignee for integrity review workflow ownership.';

COMMENT ON COLUMN public.resident_observation_integrity_flags.assigned_at IS
  'Timestamp the integrity flag was last assigned to a staff reviewer.';
