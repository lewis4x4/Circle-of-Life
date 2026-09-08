-- FL-001: explicit clinical medication assignments, separate from staffing publication.
CREATE TRIGGER trg_med_tech_shift_residents_audit
 AFTER INSERT OR UPDATE OR DELETE ON public.med_tech_shift_residents
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION public.guard_medication_assignment_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user IN('postgres','service_role') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='med_tech_shifts' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.status<>'scheduled' OR NEW.clocked_in_at IS NOT NULL THEN RAISE EXCEPTION 'Start medication assignments through the queue command' USING ERRCODE='42501'; END IF;
     RETURN NEW;
   END IF;
   IF NEW.clocked_in_at IS DISTINCT FROM OLD.clocked_in_at
      OR (NEW.status IS DISTINCT FROM OLD.status AND NOT(OLD.status='active' AND NEW.status='completed')) THEN
     RAISE EXCEPTION 'Start medication assignments through the queue command' USING ERRCODE='42501';
   END IF;
   IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.user_id,NEW.shift_start,NEW.shift_end,NEW.created_by,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.user_id,OLD.shift_start,OLD.shift_end,OLD.created_by,OLD.created_at)
      AND coalesce(haven.app_role()::text,'') NOT IN('owner','org_admin','facility_admin','nurse') THEN
     RAISE EXCEPTION 'Medication assignment changes require a nurse or administrator' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='emar_records' THEN
   IF NEW.med_pass_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.med_passes p WHERE p.id=NEW.med_pass_id
     AND p.resident_id=NEW.resident_id AND p.resident_medication_id=NEW.resident_medication_id
     AND p.organization_id=NEW.organization_id AND p.facility_id=NEW.facility_id
     AND (p.scheduled_time IS NOT DISTINCT FROM NEW.scheduled_time OR (p.scheduled_time IS NULL AND NEW.is_prn))) THEN
     RAISE EXCEPTION 'Medication administration must match its assigned dose' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Medication passes must be produced from an authorized assignment' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.shift_id,NEW.resident_id,NEW.resident_medication_id,NEW.scheduled_time,NEW.administered_by,NEW.witness_required,NEW.controlled_substance,NEW.created_at,NEW.created_by,NEW.deleted_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.shift_id,OLD.resident_id,OLD.resident_medication_id,OLD.scheduled_time,OLD.administered_by,OLD.witness_required,OLD.controlled_substance,OLD.created_at,OLD.created_by,OLD.deleted_at) THEN
   RAISE EXCEPTION 'Preserve generated medication pass identity and schedule' USING ERRCODE='42501';
 END IF;
 IF NEW.status NOT IN('pending','overdue') OR OLD.status NOT IN('pending','overdue')
    OR NEW.emar_record_id IS DISTINCT FROM OLD.emar_record_id OR NEW.administered_time IS DISTINCT FROM OLD.administered_time
    OR NEW.witnessed_by IS DISTINCT FROM OLD.witnessed_by THEN
   IF NOT EXISTS(SELECT 1 FROM public.emar_records e WHERE e.id=NEW.emar_record_id AND e.med_pass_id=NEW.id
     AND e.resident_id=NEW.resident_id AND e.resident_medication_id=NEW.resident_medication_id
     AND e.organization_id=NEW.organization_id AND e.facility_id=NEW.facility_id
     AND e.administered_by=NEW.administered_by AND e.status::text=NEW.status AND e.deleted_at IS NULL
     AND (e.scheduled_time IS NOT DISTINCT FROM NEW.scheduled_time OR (NEW.scheduled_time IS NULL AND e.is_prn))
     AND e.is_prn IS NOT DISTINCT FROM (SELECT m.frequency='prn' FROM public.resident_medications m WHERE m.id=NEW.resident_medication_id)
     AND e.actual_time IS NOT DISTINCT FROM NEW.administered_time
     AND NEW.witnessed_by IS NOT DISTINCT FROM (SELECT w.witness_user_id FROM public.witness_signatures w WHERE w.id=e.witness_signature_id)) THEN
     RAISE EXCEPTION 'Pass completion requires matching medication administration evidence' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_medication_shift_fields BEFORE INSERT OR UPDATE ON public.med_tech_shifts
 FOR EACH ROW EXECUTE FUNCTION public.guard_medication_assignment_fields();
CREATE TRIGGER trg_guard_generated_medication_pass BEFORE INSERT OR UPDATE ON public.med_passes
 FOR EACH ROW EXECUTE FUNCTION public.guard_medication_assignment_fields();
CREATE TRIGGER trg_guard_medication_pass_evidence BEFORE INSERT OR UPDATE ON public.emar_records
 FOR EACH ROW EXECUTE FUNCTION public.guard_medication_assignment_fields();

-- Private, data-free calendar calculation shared by production and SQL probes.
-- Prefer the first occurrence of a repeated local time, matching the caregiver UI.
CREATE OR REPLACE FUNCTION haven.medication_shift_slots(p_start timestamptz,p_end timestamptz,p_timezone text,p_frequency public.medication_frequency,p_order_start date,p_order_end date,p_times time[])
RETURNS SETOF timestamptz LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE day date; slot time; scheduled timestamptz; wall timestamp;
BEGIN
 IF p_frequency='prn' THEN RETURN; END IF;
 FOR day IN SELECT d::date FROM generate_series((p_start AT TIME ZONE p_timezone)::date::timestamp,(p_end AT TIME ZONE p_timezone)::date::timestamp,interval '1 day') d LOOP
   IF day<p_order_start OR (p_order_end IS NOT NULL AND day>p_order_end)
      OR (p_frequency='weekly' AND (day-p_order_start)%7<>0) OR (p_frequency='biweekly' AND (day-p_order_start)%14<>0)
      OR (p_frequency='monthly' AND extract(day FROM day)<>extract(day FROM p_order_start)) THEN CONTINUE; END IF;
   IF p_frequency='other' THEN RAISE EXCEPTION 'This medication has an unspecified cadence; ask a nurse to review its schedule'; END IF;
   IF coalesce(cardinality(p_times),0)=0 OR array_position(p_times,NULL) IS NOT NULL THEN
     RAISE EXCEPTION 'An active medication order is missing scheduled times; ask a nurse to complete the order';
   END IF;
   FOR slot IN SELECT DISTINCT t FROM unnest(p_times) t ORDER BY t LOOP
     wall:=day+slot;
     scheduled:=wall AT TIME ZONE p_timezone;
     SELECT min(candidate) INTO scheduled FROM generate_series(scheduled-interval '2 hours',scheduled,interval '1 minute') candidate
       WHERE candidate AT TIME ZONE p_timezone=wall;
     IF scheduled IS NULL THEN
       IF wall>=(p_start AT TIME ZONE p_timezone) AND wall<(p_end AT TIME ZONE p_timezone) THEN
         RAISE EXCEPTION 'A prescribed time does not exist on this daylight-saving date; ask a nurse to review the schedule';
       END IF;
       CONTINUE;
     END IF;
     IF scheduled>=p_start AND scheduled<p_end THEN RETURN NEXT scheduled; END IF;
   END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION haven.medication_shift_slots(timestamptz,timestamptz,text,public.medication_frequency,date,date,time[]) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_medication_shift_staff(p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF haven.authorized_user_id() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse')
    OR NOT EXISTS(SELECT 1 FROM haven.accessible_facility_ids() f WHERE f=p_facility_id) THEN
   RAISE EXCEPTION 'Medication assignment management authorization required' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'app_role',p.app_role) ORDER BY p.full_name,p.id),'[]') INTO result
 FROM public.user_profiles p WHERE p.organization_id=haven.organization_id() AND p.is_active
   AND p.app_role IN('med_tech','nurse')
   AND EXISTS(SELECT 1 FROM public.user_facility_access a WHERE a.user_id=p.id AND a.facility_id=p_facility_id AND a.revoked_at IS NULL)
   AND EXISTS(SELECT 1 FROM public.staff s WHERE s.user_id=p.id AND s.facility_id=p_facility_id AND s.organization_id=p.organization_id AND s.deleted_at IS NULL AND s.employment_status='active');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_medication_shift_staff(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_medication_shift_staff(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_med_tech_shift(p_id uuid,p_facility_id uuid,p_user_id uuid,p_shift_start timestamptz,p_shift_end timestamptz,p_resident_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=haven.authorized_user_id(); org uuid; residents_sorted uuid[]; existing public.med_tech_shifts%ROWTYPE; existing_residents uuid[];
BEGIN
 PERFORM 1 FROM public.user_profiles WHERE id IN(actor,p_user_id) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id IN(actor,p_user_id) AND facility_id=p_facility_id ORDER BY id FOR SHARE;
 IF actor IS NULL OR haven.authorized_user_id() IS DISTINCT FROM actor OR haven.app_role() NOT IN('owner','org_admin','facility_admin','nurse')
    OR NOT EXISTS(SELECT 1 FROM haven.accessible_facility_ids() f WHERE f=p_facility_id) THEN
   RAISE EXCEPTION 'Medication assignment management authorization required' USING ERRCODE='42501';
 END IF;
 org:=haven.organization_id();
 IF p_id IS NULL OR p_shift_start IS NULL OR p_shift_end IS NULL OR NOT isfinite(p_shift_start) OR NOT isfinite(p_shift_end)
    OR p_shift_end<=p_shift_start OR p_shift_end-p_shift_start>interval '24 hours' THEN
   RAISE EXCEPTION 'Choose a medication assignment window of up to 24 hours' USING ERRCODE='22023';
 END IF;
 SELECT array_agg(id ORDER BY id) INTO residents_sorted FROM (SELECT DISTINCT unnest(p_resident_ids) id) r WHERE id IS NOT NULL;
 IF coalesce(cardinality(residents_sorted),0)=0 THEN RAISE EXCEPTION 'Assign at least one resident' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('med-tech-user:'||p_user_id::text,0));
 SELECT * INTO existing FROM public.med_tech_shifts WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
   SELECT array_agg(resident_id ORDER BY resident_id) INTO existing_residents FROM public.med_tech_shift_residents WHERE shift_id=p_id;
   IF existing.organization_id IS DISTINCT FROM org OR existing.facility_id IS DISTINCT FROM p_facility_id OR existing.user_id IS DISTINCT FROM p_user_id
      OR existing.shift_start IS DISTINCT FROM p_shift_start OR existing.shift_end IS DISTINCT FROM p_shift_end OR existing.deleted_at IS NOT NULL
      OR existing_residents IS DISTINCT FROM residents_sorted THEN RAISE EXCEPTION 'This request already identifies a different medication assignment' USING ERRCODE='23505'; END IF;
   RETURN p_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=p_user_id AND organization_id=org AND is_active AND app_role IN('med_tech','nurse'))
    OR NOT EXISTS(SELECT 1 FROM public.user_facility_access WHERE user_id=p_user_id AND facility_id=p_facility_id AND organization_id=org AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'Choose an active medication technician or nurse with current facility access' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.staff WHERE user_id=p_user_id AND organization_id=org AND facility_id=p_facility_id AND employment_status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The medication operator is not active staff at this facility' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.residents WHERE id=ANY(residents_sorted) ORDER BY id FOR SHARE;
 IF (SELECT count(*) FROM public.residents WHERE id=ANY(residents_sorted) AND organization_id=org AND facility_id=p_facility_id AND status='active' AND deleted_at IS NULL)<>cardinality(residents_sorted) THEN
   RAISE EXCEPTION 'Every assigned resident must be active in this facility' USING ERRCODE='42501';
 END IF;
 IF p_shift_end<=clock_timestamp() THEN RAISE EXCEPTION 'The medication assignment window has already ended' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.med_tech_shifts WHERE user_id=p_user_id AND deleted_at IS NULL AND status IN('scheduled','active') AND shift_start<p_shift_end AND shift_end>p_shift_start) THEN
   RAISE EXCEPTION 'This operator already has an overlapping medication assignment' USING ERRCODE='23505';
 END IF;
 INSERT INTO public.med_tech_shifts(id,organization_id,facility_id,user_id,shift_start,shift_end,status,created_by,updated_by)
 VALUES(p_id,org,p_facility_id,p_user_id,p_shift_start,p_shift_end,'scheduled',actor,actor);
 INSERT INTO public.med_tech_shift_residents(shift_id,resident_id,organization_id,facility_id)
 SELECT p_id,id,org,p_facility_id FROM unnest(residents_sorted) id;
 RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.create_med_tech_shift(uuid,uuid,uuid,timestamptz,timestamptz,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_med_tech_shift(uuid,uuid,uuid,timestamptz,timestamptz,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_med_tech_shift(p_shift_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=haven.authorized_user_id(); s public.med_tech_shifts%ROWTYPE; m public.resident_medications%ROWTYPE;
 tz text; scheduled timestamptz; other_shift uuid;
BEGIN
 PERFORM 1 FROM public.user_profiles WHERE id=actor FOR SHARE;
 IF actor IS NULL OR haven.authorized_user_id() IS DISTINCT FROM actor OR haven.app_role() NOT IN('med_tech','nurse') THEN
   RAISE EXCEPTION 'Current medication operator authorization required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('med-tech-user:'||actor::text,0));
 SELECT * INTO s FROM public.med_tech_shifts WHERE id=p_shift_id AND user_id=actor AND organization_id=haven.organization_id() AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Medication assignment not found' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=actor AND facility_id=s.facility_id AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM haven.accessible_facility_ids() f WHERE f=s.facility_id) THEN
   RAISE EXCEPTION 'Current facility access is required' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.staff WHERE user_id=actor AND organization_id=s.organization_id AND facility_id=s.facility_id AND employment_status='active' AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active facility staff status is required' USING ERRCODE='42501'; END IF;
 IF s.status NOT IN('scheduled','active') OR clock_timestamp()<s.shift_start OR clock_timestamp()>=s.shift_end OR s.shift_end-s.shift_start>interval '24 hours' THEN
   RAISE EXCEPTION 'This medication assignment is outside its active window' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(timezone,'America/New_York') INTO STRICT tz FROM public.facilities WHERE id=s.facility_id AND deleted_at IS NULL;
 PERFORM 1 FROM public.residents r JOIN public.med_tech_shift_residents a ON a.resident_id=r.id WHERE a.shift_id=s.id ORDER BY r.id FOR SHARE OF r;
 IF NOT EXISTS(SELECT 1 FROM public.med_tech_shift_residents WHERE shift_id=s.id) THEN
   RAISE EXCEPTION 'This medication assignment has no residents' USING ERRCODE='22023';
 END IF;
 FOR m IN SELECT rm.* FROM public.resident_medications rm JOIN public.med_tech_shift_residents a ON a.resident_id=rm.resident_id
   JOIN public.residents r ON r.id=rm.resident_id AND r.organization_id=s.organization_id AND r.facility_id=s.facility_id AND r.status='active' AND r.deleted_at IS NULL
   WHERE a.shift_id=s.id AND a.organization_id=s.organization_id AND a.facility_id=s.facility_id AND rm.organization_id=s.organization_id AND rm.facility_id=s.facility_id AND rm.status='active' AND rm.deleted_at IS NULL AND rm.frequency<>'prn'
   ORDER BY rm.id FOR SHARE OF rm LOOP
   FOR scheduled IN SELECT * FROM haven.medication_shift_slots(s.shift_start,s.shift_end,tz,m.frequency,m.start_date,m.end_date,m.scheduled_times) ORDER BY 1 LOOP
       -- Same dose lock as both existing completion commands; no eMAR is invented.
       PERFORM pg_advisory_xact_lock(hashtextextended(m.id::text||'|'||extract(epoch FROM scheduled)::text,0));
       IF EXISTS(SELECT 1 FROM public.emar_records WHERE resident_medication_id=m.id AND scheduled_time=scheduled AND NOT is_prn AND deleted_at IS NULL AND status<>'scheduled') THEN CONTINUE; END IF;
       SELECT shift_id INTO other_shift FROM public.med_passes WHERE resident_medication_id=m.id AND scheduled_time=scheduled AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1;
       IF FOUND THEN
         IF other_shift<>s.id THEN RAISE EXCEPTION 'A scheduled dose is already assigned to another medication shift; ask a nurse to reconcile the assignments'; END IF;
         CONTINUE;
       END IF;
       INSERT INTO public.med_passes(organization_id,facility_id,shift_id,resident_id,resident_medication_id,scheduled_time,administered_by,witness_required,controlled_substance,created_by,updated_by)
       VALUES(s.organization_id,s.facility_id,s.id,m.resident_id,m.id,scheduled,actor,m.witness_required,m.controlled_schedule<>'non_controlled',actor,actor);
   END LOOP;
 END LOOP;
 IF s.status='scheduled' THEN
   UPDATE public.med_tech_shifts SET status='active',clocked_in_at=clock_timestamp(),updated_by=actor WHERE id=s.id;
   INSERT INTO public.shift_tape_events(organization_id,facility_id,shift_id,event_type,summary,metadata)
   VALUES(s.organization_id,s.facility_id,s.id,'shift_started','Medication assignment started',jsonb_build_object('actor_id',actor));
 END IF;
 RETURN s.id;
END $$;
REVOKE ALL ON FUNCTION public.start_med_tech_shift(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_med_tech_shift(uuid) TO authenticated;

-- Rollback: drop these three functions in a forward migration paired with UI rollback.
-- Retain all generated assignments, passes and clinical audit records.
