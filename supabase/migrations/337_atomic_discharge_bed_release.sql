-- FL-007: resident discharge and the matching bed release are one transaction.
-- Resident UPDATE RLS remains the entry authorization. The narrow definer trigger
-- permits that authorized clinical transition without granting general bed writes.
CREATE OR REPLACE FUNCTION public.release_resident_bed_on_discharge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE bed_row public.beds%ROWTYPE;
BEGIN
  IF NEW.status NOT IN ('discharged','deceased') THEN RETURN NEW; END IF;
  IF OLD.status IN ('discharged','deceased') THEN
    IF NEW.bed_id IS NOT NULL THEN RAISE EXCEPTION 'A discharged resident cannot be assigned a bed'; END IF;
    IF OLD.bed_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.beds WHERE current_resident_id=OLD.id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'An existing discharged resident has an unresolved bed assignment';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
    RAISE EXCEPTION 'Discharge cannot also transfer the resident organization or facility';
  END IF;
  IF NEW.bed_id IS NOT NULL AND NEW.bed_id IS DISTINCT FROM OLD.bed_id THEN
    RAISE EXCEPTION 'Discharge cannot assign a different bed';
  END IF;
  IF OLD.bed_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.beds WHERE current_resident_id=OLD.id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'The resident bed assignment does not match current occupancy; reconcile it before discharge';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM public.beds WHERE current_resident_id=OLD.id
      AND id<>OLD.bed_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'The resident bed assignment does not match current occupancy; reconcile it before discharge';
  END IF;
  -- The resident row is already locked by UPDATE. Admission uses this same order.
  SELECT * INTO bed_row FROM public.beds WHERE id=OLD.bed_id FOR UPDATE;
  IF NOT FOUND OR bed_row.deleted_at IS NOT NULL
     OR bed_row.current_resident_id IS DISTINCT FROM OLD.id
     OR bed_row.organization_id IS DISTINCT FROM OLD.organization_id
     OR bed_row.facility_id IS DISTINCT FROM OLD.facility_id THEN
    RAISE EXCEPTION 'The resident bed assignment does not match current occupancy; reconcile it before discharge';
  END IF;
  UPDATE public.beds SET current_resident_id=NULL,
    status=CASE WHEN status='occupied' THEN
      CASE WHEN reserved_for_admission_case_id IS NOT NULL THEN 'hold'::public.bed_status
           ELSE 'available'::public.bed_status END
      ELSE status END,
    updated_by=coalesce(auth.uid(),NEW.updated_by)
  WHERE id=bed_row.id;
  NEW.bed_id:=NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_resident_bed_on_discharge() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_release_resident_bed_on_discharge
  BEFORE UPDATE OF status,bed_id ON public.residents
  FOR EACH ROW EXECUTE FUNCTION public.release_resident_bed_on_discharge();

-- Existing inconsistencies are not silently repaired. Reservations, temporary
-- blocks, maintenance/offline state and all audit history are retained.
-- Rollback in a forward migration only (reopens non-atomic discharge defect):
-- DROP TRIGGER trg_release_resident_bed_on_discharge ON public.residents;
-- DROP FUNCTION public.release_resident_bed_on_discharge();
