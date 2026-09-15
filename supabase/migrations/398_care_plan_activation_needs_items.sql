-- A care plan with no active needs cannot become active.
--
-- create_care_plan_revision_review (321) requires at least one need when a
-- version is drafted, but items can be deactivated or soft-deleted afterwards,
-- so an empty version could still be approved. The 393 trigger already guards
-- who may activate; this adds what may be activated. COL-398.

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
    IF NOT EXISTS (
      SELECT 1 FROM public.care_plan_items
       WHERE care_plan_id = NEW.id AND is_active AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'A care plan with no active needs cannot be approved'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
