-- One live resident per bed, regardless of whether assignment comes from the
-- browser, admission arrival, or an import. Historical conflicts need a human
-- assignment decision; this migration never chooses a winner or repairs them.
BEGIN;

DO $function$
BEGIN
  IF EXISTS (
    SELECT bed_id FROM public.residents
    WHERE bed_id IS NOT NULL AND deleted_at IS NULL
      AND status IN ('active','hospital_hold','loa')
    GROUP BY bed_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve duplicate live bed assignments before applying this migration';
  END IF;
END $function$;

CREATE UNIQUE INDEX idx_residents_one_live_bed_holder ON public.residents(bed_id)
WHERE bed_id IS NOT NULL AND deleted_at IS NULL
  AND status IN ('active','hospital_hold','loa');

CREATE FUNCTION haven.assert_resident_bed_move_authority(p_organization_id uuid,p_facility_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor record; expiry text;
BEGIN
  SELECT * INTO actor FROM haven.current_authorized_actor() WHERE actor_is_managed;
  IF NOT FOUND OR auth.uid() IS NULL
    OR actor.actor_user_id IS DISTINCT FROM auth.uid()
    OR actor.actor_app_role NOT IN ('owner','org_admin','facility_admin','nurse')
    OR actor.actor_organization_id IS DISTINCT FROM p_organization_id
    OR NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'Current bed assignment authority required' USING ERRCODE='42501';
  END IF;
  -- PostgREST checks token expiry; retain it for authenticated direct SQL too.
  expiry := auth.jwt()->>'exp';
  IF expiry IS NOT NULL THEN
    IF expiry !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Current bed assignment authority required' USING ERRCODE='42501';
    END IF;
    IF expiry::numeric <= extract(epoch FROM clock_timestamp()) THEN
      RAISE EXCEPTION 'Current bed assignment authority required' USING ERRCODE='42501';
    END IF;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION haven.assert_resident_bed_move_authority(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION haven.guard_resident_bed_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  target public.beds%ROWTYPE;
  old_bed uuid;
  was_holder boolean := false;
  is_holder boolean;
  assignment_changed boolean;
  official_release boolean := false;
  matching_arrival boolean := false;
  trusted_writer boolean;
BEGIN
  is_holder := NEW.deleted_at IS NULL AND haven.resident_status_holds_bed(NEW.status);
  IF TG_OP='UPDATE' THEN
    old_bed := OLD.bed_id;
    was_holder := OLD.deleted_at IS NULL AND haven.resident_status_holds_bed(OLD.status);
    assignment_changed := NEW.bed_id IS DISTINCT FROM OLD.bed_id
      OR (NEW.bed_id IS NOT NULL AND (
        NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.facility_id IS DISTINCT FROM OLD.facility_id))
      OR (is_holder AND NOT was_holder AND NEW.bed_id IS NOT NULL);
    -- Preserve the existing RLS-authorized discharge/death workflow. A
    -- caregiver cannot clear a still-live assignment or combine this release
    -- with a scope change, new claim, or soft deletion to evade move authority.
    official_release := was_holder AND NEW.bed_id IS NULL
      AND NEW.status IN ('discharged','deceased') AND NEW.deleted_at IS NULL
      AND NEW.organization_id=OLD.organization_id AND NEW.facility_id=OLD.facility_id;
  ELSE
    assignment_changed := NEW.bed_id IS NOT NULL;
  END IF;
  IF NOT assignment_changed THEN RETURN NEW; END IF;

  -- Do not trust SECURITY DEFINER's current_user, JWT service claims, or any
  -- caller-provided bypass. End-user JWTs always pass current profile/session
  -- authority, including when they arrive through a privileged service client.
  trusted_writer := auth.uid() IS NULL AND (
    current_setting('role',true)='service_role'
    OR (current_setting('role',true)='none' AND session_user IN ('postgres','supabase_admin'))
  );
  IF NOT trusted_writer AND NOT official_release THEN
    PERFORM haven.assert_resident_bed_move_authority(NEW.organization_id,NEW.facility_id);
    IF TG_OP='UPDATE' THEN
      PERFORM haven.assert_resident_bed_move_authority(OLD.organization_id,OLD.facility_id);
    END IF;
  END IF;
  IF NOT trusted_writer THEN NEW.updated_by := auth.uid(); END IF;

  -- Same ordering for direct UPDATE and the move RPC. Locks are retained until
  -- commit, so admission reservations and competing assignments cannot pass
  -- the final check against an earlier availability snapshot.
  PERFORM b.id FROM public.beds b
    WHERE b.id IN (old_bed,NEW.bed_id) ORDER BY b.id FOR UPDATE;
  IF was_holder AND is_holder AND NEW.bed_id IS NOT NULL
    AND NEW.bed_id IS DISTINCT FROM old_bed AND EXISTS (
    SELECT 1 FROM public.beds WHERE id=old_bed
      AND current_resident_id IS NOT NULL AND current_resident_id<>NEW.id
  ) THEN
    RAISE EXCEPTION 'The current bed has a conflicting assignment; review it before moving' USING ERRCODE='23514';
  END IF;
  IF NEW.bed_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO target FROM public.beds WHERE id=NEW.bed_id;
  IF NOT FOUND OR target.deleted_at IS NOT NULL
    OR target.organization_id IS DISTINCT FROM NEW.organization_id
    OR target.facility_id IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'The selected bed is unavailable in this facility' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rooms room
    WHERE room.id=target.room_id AND room.deleted_at IS NULL
      AND room.organization_id=NEW.organization_id AND room.facility_id=NEW.facility_id) THEN
    RAISE EXCEPTION 'The selected bed has an unavailable room' USING ERRCODE='23514';
  END IF;
  -- A pending/discharged resident does not claim occupancy, but its bed pointer
  -- must still stay inside the resident's tenant and facility. Otherwise the
  -- definer occupancy synchronizer could be steered at a foreign bed UUID.
  IF NOT is_holder THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.residents resident
    WHERE resident.bed_id=target.id AND resident.id<>NEW.id
      AND resident.deleted_at IS NULL AND haven.resident_status_holds_bed(resident.status)) THEN
    RAISE EXCEPTION 'The selected bed is already occupied; refresh availability' USING ERRCODE='23505';
  END IF;
  IF target.current_resident_id IS NOT NULL AND target.current_resident_id<>NEW.id THEN
    RAISE EXCEPTION 'The selected bed has a conflicting assignment; refresh availability' USING ERRCODE='23514';
  END IF;
  -- Only an actual trusted arrival can consume its own reservation. A nurse
  -- moving an active resident cannot use the case relationship as a bypass.
  IF trusted_writer AND NOT was_holder AND target.reserved_for_admission_case_id IS NOT NULL THEN
    matching_arrival := EXISTS (SELECT 1 FROM public.admission_cases admission
      WHERE admission.id=target.reserved_for_admission_case_id
        AND admission.resident_id=NEW.id AND admission.bed_id=target.id
        AND admission.organization_id=NEW.organization_id AND admission.facility_id=NEW.facility_id
        AND admission.deleted_at IS NULL AND admission.actual_arrival_at IS NULL
        AND admission.status::text NOT IN ('cancelled','closed')
        AND admission.financial_clearance_at IS NOT NULL
        AND admission.physician_orders_received_at IS NOT NULL);
  END IF;
  IF target.reserved_for_admission_case_id IS NOT NULL AND NOT matching_arrival THEN
    RAISE EXCEPTION 'The selected bed is reserved for admission' USING ERRCODE='23514';
  END IF;
  IF target.is_temporarily_blocked OR NOT (target.status='available'
    OR (matching_arrival AND target.status='hold')
    OR (was_holder AND old_bed=NEW.bed_id AND target.status='occupied')) THEN
    RAISE EXCEPTION 'The selected bed is not available for assignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION haven.guard_resident_bed_assignment() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr_residents_guard_bed_assignment
BEFORE INSERT OR UPDATE OF bed_id,status,deleted_at,organization_id,facility_id ON public.residents
FOR EACH ROW EXECUTE FUNCTION haven.guard_resident_bed_assignment();

CREATE OR REPLACE FUNCTION haven.sync_bed_occupancy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE bed uuid; holder uuid; changed_resident uuid; bed_org uuid; bed_facility uuid;
BEGIN
  changed_resident := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  FOR bed IN SELECT DISTINCT value FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN OLD.bed_id END,
    CASE WHEN TG_OP<>'DELETE' THEN NEW.bed_id END
  ]) value WHERE value IS NOT NULL ORDER BY value LOOP
    IF TG_OP<>'INSERT' AND bed=OLD.bed_id THEN
      bed_org:=OLD.organization_id; bed_facility:=OLD.facility_id;
    ELSE
      bed_org:=NEW.organization_id; bed_facility:=NEW.facility_id;
    END IF;
    SELECT resident.id INTO holder FROM public.residents resident
    WHERE resident.bed_id=bed AND resident.deleted_at IS NULL
      AND resident.organization_id=bed_org AND resident.facility_id=bed_facility
      AND haven.resident_status_holds_bed(resident.status);
    IF holder IS NOT NULL THEN
      UPDATE public.beds SET current_resident_id=holder,
        status=CASE WHEN status IN ('available','hold') THEN 'occupied'::public.bed_status ELSE status END
      WHERE id=bed AND organization_id=bed_org AND facility_id=bed_facility AND deleted_at IS NULL
        AND (current_resident_id IS NULL OR current_resident_id=holder);
    ELSE
      -- Never erase a contradictory pointer left by historical data.
      UPDATE public.beds SET current_resident_id=NULL,
        status=CASE WHEN status='occupied' THEN 'available'::public.bed_status ELSE status END
      WHERE id=bed AND organization_id=bed_org AND facility_id=bed_facility AND deleted_at IS NULL
        AND (current_resident_id IS NULL OR current_resident_id=changed_resident);
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION haven.sync_bed_occupancy() FROM PUBLIC,anon,authenticated,service_role;

-- Admission and reservation keep their existing business rules, but acquire
-- both bed locks in the same order as direct writes and the move command.
CREATE OR REPLACE FUNCTION public.confirm_admission_arrival_review(p_case_id uuid,p_actor_id uuid,p_arrival_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c admission_cases%ROWTYPE; r residents%ROWTYPE; b beds%ROWTYPE; today date;
BEGIN
 SELECT * INTO STRICT c FROM admission_cases WHERE id=p_case_id AND deleted_at IS NULL FOR UPDATE;
 SELECT (now() AT TIME ZONE coalesce(timezone,'America/New_York'))::date INTO today FROM facilities WHERE id=c.facility_id;
 IF c.actual_arrival_at IS NOT NULL THEN RETURN c.resident_id; END IF;
 IF c.status::text IN('cancelled','closed') THEN RAISE EXCEPTION 'A cancelled or closed admission cannot confirm arrival'; END IF;
 IF p_arrival_date IS NULL OR p_arrival_date>today THEN RAISE EXCEPTION 'Choose an actual arrival date, not a future date'; END IF;
 IF c.financial_clearance_at IS NULL OR c.physician_orders_received_at IS NULL OR c.bed_id IS NULL OR NOT EXISTS(SELECT 1 FROM admission_case_rate_terms WHERE admission_case_id=c.id) THEN RAISE EXCEPTION 'Complete financial, physician-order, bed and rate readiness first'; END IF;
 IF NOT EXISTS(SELECT 1 FROM (SELECT fr.* FROM form_1823_records fr WHERE fr.resident_id=c.resident_id AND fr.deleted_at IS NULL ORDER BY CASE WHEN fr.admission_case_id=c.id THEN 1 ELSE 0 END DESC,fr.updated_at DESC,fr.id DESC LIMIT 1) f JOIN admission_document_checklist_items d ON d.admission_case_id=c.id AND d.document_type='form_1823' WHERE f.resident_id=c.resident_id AND f.status='received' AND f.exam_date<=today AND f.expiration_date>=today AND nullif(trim(f.physician_name),'') IS NOT NULL AND d.received_at IS NOT NULL AND nullif(trim(d.notes),'') IS NOT NULL AND f.deleted_at IS NULL AND d.deleted_at IS NULL) THEN RAISE EXCEPTION 'Current Form 1823 and verified evidence are required'; END IF;
 SELECT * INTO STRICT r FROM residents WHERE id=c.resident_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF r.gender IS NULL OR r.date_of_birth IS NULL THEN RAISE EXCEPTION 'Complete resident date of birth and gender before confirming arrival'; END IF;
 PERFORM bed.id FROM public.beds bed WHERE bed.id IN(r.bed_id,c.bed_id) ORDER BY bed.id FOR UPDATE;
 SELECT * INTO STRICT b FROM beds WHERE id=c.bed_id AND facility_id=c.facility_id AND deleted_at IS NULL FOR UPDATE;
 IF b.reserved_for_admission_case_id IS NOT NULL AND b.reserved_for_admission_case_id<>c.id THEN RAISE EXCEPTION 'The selected bed is reserved for another admission'; END IF;
 IF b.current_resident_id IS NOT NULL AND b.current_resident_id<>r.id THEN RAISE EXCEPTION 'The selected bed is occupied by another resident'; END IF;
 IF b.status NOT IN('available','hold','occupied') THEN RAISE EXCEPTION 'The bed is unavailable for arrival'; END IF;
 UPDATE residents SET status='active',admission_date=p_arrival_date,bed_id=b.id,updated_by=p_actor_id WHERE id=r.id;
 UPDATE beds SET status='occupied',current_resident_id=r.id,reserved_for_admission_case_id=NULL,updated_by=p_actor_id WHERE id=b.id;
 UPDATE admission_cases SET status='move_in',actual_arrival_at=p_arrival_date::timestamptz,updated_by=p_actor_id WHERE id=c.id;
 RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.reserve_admission_bed_review()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE target beds%ROWTYPE;
BEGIN
 IF (OLD.bed_id IS NOT NULL AND (NEW.bed_id IS DISTINCT FROM OLD.bed_id OR NEW.status::text IN('cancelled','closed')))
   OR (NEW.status='bed_reserved' AND (OLD.status IS DISTINCT FROM NEW.status OR NEW.bed_id IS DISTINCT FROM OLD.bed_id)) THEN
   PERFORM bed.id FROM public.beds bed WHERE bed.id IN(OLD.bed_id,NEW.bed_id) ORDER BY bed.id FOR UPDATE;
 END IF;
 IF OLD.bed_id IS NOT NULL AND (NEW.bed_id IS DISTINCT FROM OLD.bed_id OR NEW.status::text IN('cancelled','closed')) THEN
  UPDATE beds SET status='available',reserved_for_admission_case_id=NULL,updated_by=NEW.updated_by WHERE id=OLD.bed_id AND reserved_for_admission_case_id=OLD.id AND status='hold' AND current_resident_id IS NULL;
 END IF;
 IF NEW.status='bed_reserved' AND (OLD.status IS DISTINCT FROM NEW.status OR NEW.bed_id IS DISTINCT FROM OLD.bed_id) THEN
  IF NEW.actual_arrival_at IS NOT NULL THEN RAISE EXCEPTION 'Arrival already recorded; use the resident transfer workflow for bed changes'; END IF;
  IF NEW.bed_id IS NULL OR NEW.financial_clearance_at IS NULL OR NEW.physician_orders_received_at IS NULL THEN RAISE EXCEPTION 'Bed reservation requires financial and physician-order clearance'; END IF;
  SELECT * INTO STRICT target FROM beds WHERE id=NEW.bed_id AND facility_id=NEW.facility_id AND organization_id=NEW.organization_id AND deleted_at IS NULL FOR UPDATE;
  IF target.current_resident_id IS NOT NULL OR (target.status<>'available' AND target.reserved_for_admission_case_id IS DISTINCT FROM NEW.id) THEN RAISE EXCEPTION 'This bed is no longer available for reservation'; END IF;
  UPDATE beds SET status='hold',reserved_for_admission_case_id=NEW.id,updated_by=NEW.updated_by WHERE id=target.id;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.change_resident_bed(p_resident_id uuid,p_target_bed_id uuid,p_expected_bed_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE resident public.residents%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Current bed assignment authority required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO resident FROM public.residents WHERE id=p_resident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resident unavailable' USING ERRCODE='42501'; END IF;
  PERFORM haven.assert_resident_bed_move_authority(resident.organization_id,resident.facility_id);
  IF resident.deleted_at IS NOT NULL OR NOT haven.resident_status_holds_bed(resident.status) THEN
    RAISE EXCEPTION 'Only a current resident can change beds' USING ERRCODE='23514';
  END IF;
  PERFORM bed.id FROM public.beds bed
    WHERE bed.id IN (resident.bed_id,p_target_bed_id) ORDER BY bed.id FOR UPDATE;
  IF resident.bed_id IS DISTINCT FROM p_expected_bed_id THEN
    RAISE EXCEPTION 'The resident assignment changed; refresh before moving' USING ERRCODE='23514';
  END IF;
  IF p_target_bed_id IS NULL OR p_target_bed_id IS NOT DISTINCT FROM resident.bed_id THEN
    RAISE EXCEPTION 'Choose a different available bed' USING ERRCODE='23514';
  END IF;
  UPDATE public.residents SET bed_id=p_target_bed_id,updated_by=auth.uid() WHERE id=resident.id;
  RETURN p_target_bed_id;
END $function$;
REVOKE ALL ON FUNCTION public.change_resident_bed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.change_resident_bed(uuid,uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.change_resident_bed(uuid,uuid,uuid) IS
'COL-503. COL-37 ruling: definer required for atomic bed locks and pointer synchronization without widening bed table writes. Current server-derived owner/org_admin/facility_admin/nurse authority and facility access are checked; actor is auth.uid(), expected source is null-safe, and the shared resident trigger enforces assignment integrity. Returns the target bed id.';
COMMENT ON FUNCTION haven.guard_resident_bed_assignment() IS
'COL-503: private definer trigger checks all canonical holders even when caller RLS cannot see them. Direct assignments require current clinical/admin authority; actual trusted service/database writers still pass all integrity checks. No caller bypass flag.';
COMMENT ON FUNCTION haven.sync_bed_occupancy() IS
'Synchronizes canonical residents.bed_id with bed pointers and occupancy status; preserves maintenance/offline/hold on release and never erases a contradictory legacy pointer. Private definer trigger; no request-role execution grant.';

NOTIFY pgrst,'reload schema';
COMMIT;
