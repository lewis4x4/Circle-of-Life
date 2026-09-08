-- FL-006: assessment-derived fall risk follows clinical chronology, not entry order.
-- Lock the resident before each relevant assessment write. The AFTER trigger then
-- observes the serialized assessment history and updates risk in the same transaction.
CREATE OR REPLACE FUNCTION public.lock_morse_assessment_resident()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE resident_row residents%ROWTYPE; current_id uuid;
BEGIN
  IF NEW.assessment_type <> 'morse_fall' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN
    RAISE EXCEPTION 'Preserve assessment resident identity; record a separate correction';
  END IF;
  SELECT * INTO STRICT resident_row FROM residents
    WHERE id=NEW.resident_id AND deleted_at IS NULL FOR UPDATE;
  IF resident_row.organization_id IS DISTINCT FROM NEW.organization_id
     OR resident_row.facility_id IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'Assessment must match the resident organization and facility';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Preserve assessment identity and creation time';
    END IF;
    SELECT id INTO current_id FROM assessments
      WHERE resident_id=NEW.resident_id AND assessment_type='morse_fall'
        AND deleted_at IS NULL AND total_score IS NOT NULL
      ORDER BY assessment_date DESC,created_at DESC,id DESC LIMIT 1;
    IF current_id=OLD.id AND NEW.assessment_date<OLD.assessment_date
       AND EXISTS(SELECT 1 FROM assessments WHERE resident_id=NEW.resident_id
         AND id<>OLD.id AND assessment_type='morse_fall' AND deleted_at IS NULL
         AND total_score IS NOT NULL
         AND (assessment_date,created_at,id)>(NEW.assessment_date,NEW.created_at,NEW.id)) THEN
      RAISE EXCEPTION 'This date correction would replace the current risk source; record a separate reviewed assessment';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.apply_current_morse_assessment_risk()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE latest_id uuid;
BEGIN
  IF NEW.assessment_type <> 'morse_fall' OR NEW.deleted_at IS NOT NULL
     OR NEW.total_score IS NULL THEN RETURN NEW; END IF;
  -- Notes-only edits must not overwrite a separately recorded current risk.
  IF TG_OP='UPDATE' AND NEW.total_score IS NOT DISTINCT FROM OLD.total_score
     AND NEW.assessment_date IS NOT DISTINCT FROM OLD.assessment_date
     AND NEW.assessment_type IS NOT DISTINCT FROM OLD.assessment_type
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN RETURN NEW; END IF;
  SELECT id INTO latest_id FROM assessments
    WHERE resident_id=NEW.resident_id AND assessment_type='morse_fall'
      AND deleted_at IS NULL AND total_score IS NOT NULL
    ORDER BY assessment_date DESC,created_at DESC,id DESC LIMIT 1;
  IF latest_id=NEW.id THEN
    UPDATE residents SET fall_risk_level=CASE
      WHEN NEW.total_score<=24 THEN 'low'
      WHEN NEW.total_score<=44 THEN 'standard' ELSE 'high' END,
      updated_by=coalesce(auth.uid(),NEW.updated_by,NEW.created_by,NEW.assessed_by)
    WHERE id=NEW.resident_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_lock_morse_assessment_resident
  BEFORE INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.lock_morse_assessment_resident();
CREATE TRIGGER trg_apply_current_morse_assessment_risk
  AFTER INSERT OR UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.apply_current_morse_assessment_risk();

-- No backfill or deletion fallback: existing manual risk is not inferred from
-- old assessments, and removing an assessment does not silently lower current risk.
-- Rollback, only in a forward migration paired with the application rollback:
-- DROP TRIGGER trg_apply_current_morse_assessment_risk ON public.assessments;
-- DROP TRIGGER trg_lock_morse_assessment_resident ON public.assessments;
-- DROP FUNCTION public.apply_current_morse_assessment_risk();
-- DROP FUNCTION public.lock_morse_assessment_resident();
