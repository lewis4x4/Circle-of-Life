-- COL-430: hold PHQ-9 at the database until the item 9 safety follow-up ships.
--
-- Why the database and not the application. Haven's assessment entry writes
-- straight from the browser to PostgREST; no application route sits in
-- between. The only API route that touches `assessments` reads it for
-- rounding insights. A BEFORE INSERT trigger is therefore the only place a
-- hold stops every role and every path, including service-role callers:
-- `assessments` has RLS enabled but not forced, so table-owner and
-- service-role writes bypass policies entirely. A trigger does not bypass.
--
-- What is missing from the seeded instrument. PHQ-9 is seeded (migration 012)
-- without its two-week instruction stem, without the unscored
-- functional-difficulty item, and without any item 9 (self-harm) safety
-- follow-up. Spec 03's rule "PHQ-9 score >= 10 alerts the nurse and
-- recommends a care plan review" is not implemented in any save path. Until
-- those ship, a recorded PHQ-9 is a self-harm screening score with no safety
-- path attached to it.
--
-- Scope. Inserts only. Existing PHQ-9 rows stay readable and unchanged:
-- history, CSV export, acuity reads and the overdue list are untouched. No
-- resident data is modified by this migration.
--
-- Removing the hold. Set `held_reason` to NULL for the PHQ-9 row, and only
-- when the item 9 follow-up and the score 10 alert ship. Do not drop the
-- trigger to let one insert through.

-- `assessment_templates` carries no organization_id -- it is a global table
-- with one row per instrument -- so a single row governs every organization.
ALTER TABLE public.assessment_templates
  ADD COLUMN held_reason text NULL
  CHECK (held_reason IS NULL OR char_length(held_reason) BETWEEN 1 AND 200);

COMMENT ON COLUMN public.assessment_templates.held_reason IS
  'COL-430: when set, the instrument cannot be recorded and the picker shows this text as a disabled line. NULL means available.';

UPDATE public.assessment_templates
  SET held_reason = 'PHQ-9 on hold until safety follow-up is added'
  WHERE assessment_type = 'phq9';

-- SECURITY DEFINER on purpose: the hold must not depend on the caller being
-- able to read `assessment_templates`. Under SECURITY INVOKER a role whose
-- read policy did not cover the template would find no row and fail open.
CREATE OR REPLACE FUNCTION haven.reject_held_assessment_instrument()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_held_reason text;
BEGIN
  -- `assessments` stores no template id. It names the instrument by the
  -- `assessment_type` key, which is UNIQUE on assessment_templates.
  SELECT t.held_reason INTO v_held_reason
  FROM public.assessment_templates AS t
  WHERE t.assessment_type = NEW.assessment_type;

  IF v_held_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'assessment_instrument_held',
      DETAIL  = v_held_reason;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION haven.reject_held_assessment_instrument() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tr_assessments_reject_held_instrument
  BEFORE INSERT ON public.assessments
  FOR EACH ROW
  EXECUTE FUNCTION haven.reject_held_assessment_instrument();

NOTIFY pgrst, 'reload schema';
