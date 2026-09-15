-- Significant changes ask for a care-plan review.
--
-- care_plan_review_alerts (035) already names fall_incident, hospital_return,
-- condition_change, acuity_change and assessment_threshold, but only the
-- assessments page ever wrote a row and Reviews Due never read one. Florida's
-- trigger for revisiting a plan is "significant change", not a calendar date.
-- These triggers raise an alert for the resident's active plan when one
-- happens, and resolve the previous plan's alerts when a new version goes
-- active. They run as the definer because caregivers record incidents and
-- condition changes, and the alert table's INSERT policy is narrower than that.

ALTER TABLE public.care_plan_review_alerts
  DROP CONSTRAINT care_plan_review_alerts_trigger_type_check;
ALTER TABLE public.care_plan_review_alerts
  ADD CONSTRAINT care_plan_review_alerts_trigger_type_check CHECK (
    trigger_type IN (
      'quarterly_due',
      'quarterly_overdue',
      'acuity_change',
      'fall_incident',
      'hospital_return',
      'condition_change',
      'assessment_threshold',
      'family_request',
      'form_1823_renewed'
    )
  );

-- Raise one open alert per (active plan, trigger type). Returns the new alert
-- id, or NULL when the resident has no active plan or the alert already exists.
CREATE OR REPLACE FUNCTION public.care_plan_review_alert_raise(
  p_resident_id uuid,
  p_trigger_type text,
  p_trigger_detail text,
  p_source_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plan record;
  alert_id uuid;
BEGIN
  SELECT id, facility_id, organization_id
    INTO plan
    FROM public.care_plans
   WHERE resident_id = p_resident_id
     AND status = 'active'
     AND deleted_at IS NULL
   LIMIT 1;
  IF plan.id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.care_plan_review_alerts (
    care_plan_id, resident_id, facility_id, organization_id,
    trigger_type, trigger_detail, trigger_source_id
  )
  VALUES (
    plan.id, p_resident_id, plan.facility_id, plan.organization_id,
    p_trigger_type, p_trigger_detail, p_source_id
  )
  ON CONFLICT (care_plan_id, trigger_type)
    WHERE deleted_at IS NULL AND status IN ('open', 'acknowledged')
    DO NOTHING
  RETURNING id INTO alert_id;

  RETURN alert_id;
END;
$$;
REVOKE ALL ON FUNCTION public.care_plan_review_alert_raise(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- Incidents: falls, elopement, wandering, skin.
CREATE OR REPLACE FUNCTION public.care_plan_alert_on_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  occurred text := to_char(NEW.occurred_at AT TIME ZONE 'America/New_York', 'Mon DD, YYYY');
BEGIN
  IF NEW.resident_id IS NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.category IN ('fall_with_injury', 'fall_without_injury', 'fall_witnessed', 'fall_unwitnessed') THEN
    PERFORM public.care_plan_review_alert_raise(
      NEW.resident_id, 'fall_incident',
      format('Fall (%s) on %s', replace(NEW.category::text, '_', ' '), occurred), NEW.id);
  ELSIF NEW.category IN ('elopement', 'wandering', 'pressure_injury', 'skin_integrity') THEN
    PERFORM public.care_plan_review_alert_raise(
      NEW.resident_id, 'condition_change',
      format('%s incident on %s', initcap(replace(NEW.category::text, '_', ' ')), occurred), NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_incidents_care_plan_alert ON public.incidents;
CREATE TRIGGER tr_incidents_care_plan_alert
  AFTER INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.care_plan_alert_on_incident();

-- Residents: back from hospital hold, or a changed acuity level.
CREATE OR REPLACE FUNCTION public.care_plan_alert_on_resident_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  today text := to_char(now() AT TIME ZONE 'America/New_York', 'Mon DD, YYYY');
BEGIN
  IF OLD.status = 'hospital_hold' AND NEW.status = 'active' THEN
    PERFORM public.care_plan_review_alert_raise(
      NEW.id, 'hospital_return', format('Returned from hospital %s', today), NEW.id);
  END IF;
  IF OLD.acuity_level IS DISTINCT FROM NEW.acuity_level THEN
    PERFORM public.care_plan_review_alert_raise(
      NEW.id, 'acuity_change',
      format('Acuity changed from %s to %s on %s',
        COALESCE(replace(OLD.acuity_level::text, '_', ' '), 'none'),
        COALESCE(replace(NEW.acuity_level::text, '_', ' '), 'none'), today),
      NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_residents_care_plan_alert ON public.residents;
CREATE TRIGGER tr_residents_care_plan_alert
  AFTER UPDATE OF status, acuity_level ON public.residents
  FOR EACH ROW EXECUTE FUNCTION public.care_plan_alert_on_resident_change();

-- Condition changes: the row already carries care_plan_review_triggered; it
-- is true exactly when the resident had an active plan to review.
CREATE OR REPLACE FUNCTION public.care_plan_alert_on_condition_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.care_plan_review_triggered := EXISTS (
    SELECT 1 FROM public.care_plans
     WHERE resident_id = NEW.resident_id AND status = 'active' AND deleted_at IS NULL);
  IF NEW.care_plan_review_triggered THEN
    PERFORM public.care_plan_review_alert_raise(
      NEW.resident_id, 'condition_change',
      format('%s reported %s', initcap(replace(NEW.change_type, '_', ' ')),
        to_char(NEW.reported_at AT TIME ZONE 'America/New_York', 'Mon DD, YYYY')),
      NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_condition_changes_care_plan_alert ON public.condition_changes;
CREATE TRIGGER tr_condition_changes_care_plan_alert
  BEFORE INSERT ON public.condition_changes
  FOR EACH ROW EXECUTE FUNCTION public.care_plan_alert_on_condition_change();

-- Form 1823: a current exam newer than the active plan's effective date.
CREATE OR REPLACE FUNCTION public.care_plan_alert_on_form_1823()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plan_effective date;
BEGIN
  IF NOT NEW.is_current OR NEW.deleted_at IS NOT NULL OR NEW.exam_date IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT effective_date INTO plan_effective
    FROM public.care_plans
   WHERE resident_id = NEW.resident_id AND status = 'active' AND deleted_at IS NULL
   LIMIT 1;
  IF plan_effective IS NOT NULL AND NEW.exam_date > plan_effective THEN
    PERFORM public.care_plan_review_alert_raise(
      NEW.resident_id, 'form_1823_renewed',
      format('Form 1823 exam %s is newer than the plan effective %s',
        to_char(NEW.exam_date, 'Mon DD, YYYY'), to_char(plan_effective, 'Mon DD, YYYY')),
      NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_form_1823_care_plan_alert ON public.form_1823_records;
CREATE TRIGGER tr_form_1823_care_plan_alert
  AFTER INSERT OR UPDATE OF is_current, exam_date, deleted_at ON public.form_1823_records
  FOR EACH ROW EXECUTE FUNCTION public.care_plan_alert_on_form_1823();

-- A new active version answers every open alert on the resident's older plans.
CREATE OR REPLACE FUNCTION public.care_plan_alerts_resolve_on_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE public.care_plan_review_alerts
       SET status = 'resolved',
           resolved_at = now(),
           resolved_by = NEW.approved_by,
           resolution_notes = format('Superseded by v%s', NEW.version)
     WHERE resident_id = NEW.resident_id
       AND care_plan_id <> NEW.id
       AND status IN ('open', 'acknowledged')
       AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_care_plans_resolve_review_alerts ON public.care_plans;
CREATE TRIGGER tr_care_plans_resolve_review_alerts
  AFTER UPDATE ON public.care_plans
  FOR EACH ROW EXECUTE FUNCTION public.care_plan_alerts_resolve_on_activation();

NOTIFY pgrst, 'reload schema';
