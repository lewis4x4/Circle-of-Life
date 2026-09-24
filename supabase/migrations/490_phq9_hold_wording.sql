-- Migration 490: the PHQ-9 hold reads as staff words, not build status (COL-689)
--
-- The assessment picker shows `assessment_templates.held_reason` as the disabled line
-- for a held instrument. "PHQ-9 on hold until safety follow-up is added" described the
-- build; staff need to know what it means for them. The hold itself (migration 410's
-- trigger) is unchanged: only the text, matched on its exact current value.

BEGIN;

UPDATE public.assessment_templates
SET held_reason = 'PHQ-9 cannot be recorded in Haven yet.'
WHERE assessment_type = 'phq9'
  AND held_reason IN (
    'PHQ-9 on hold until safety follow-up is added',
    'PHQ-9 cannot be recorded in Haven yet. Use your paper process for now.'
  );

COMMIT;
