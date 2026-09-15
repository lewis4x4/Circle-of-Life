-- A care plan's author cannot be its approver.
--
-- create_care_plan_revision_review (321) records the author in created_by;
-- /api/care-plans/[id]/approve sets approved_by. Nothing stopped one person
-- from doing both, so "clinical review" was a label. The route refuses it
-- first; this trigger refuses it for any path that reaches the table.
-- Legacy and seeded rows with no created_by are not affected.

CREATE OR REPLACE FUNCTION public.care_plan_approver_must_differ_from_author()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'A care plan cannot become active without an approver'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_by IS NOT NULL AND NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'The author of a care plan cannot approve it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_care_plan_approver_differs ON public.care_plans;
CREATE TRIGGER trg_care_plan_approver_differs
  BEFORE UPDATE ON public.care_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.care_plan_approver_must_differ_from_author();

-- Recorded while here: nothing writes this column. Invoicing reads
-- residents.acuity_level; signing a care plan does not move a rate tier.
COMMENT ON COLUMN public.care_plans.billing_snapshot_hash IS
  'Declared by 061 for billing alignment; unused as of 393. Invoices derive the care surcharge from residents.acuity_level, not from the care plan.';
