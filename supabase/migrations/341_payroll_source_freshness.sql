-- BUS-006: retain one globally owned punch line, refreshing only editable drafts.
ALTER TABLE public.time_records ADD COLUMN payroll_source_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE public.payroll_export_lines ADD COLUMN source_revision bigint;
ALTER TABLE public.payroll_export_lines ADD COLUMN exclusion_reason text;

CREATE FUNCTION public.haven_payroll_source_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.payroll_source_revision:=1;
 ELSE NEW.payroll_source_revision:=OLD.payroll_source_revision + CASE WHEN
  (to_jsonb(NEW)-ARRAY['payroll_source_revision','updated_at','updated_by','discrepancy_notes']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['payroll_source_revision','updated_at','updated_by','discrepancy_notes']) THEN 1 ELSE 0 END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_payroll_source_revision BEFORE INSERT OR UPDATE ON public.time_records
 FOR EACH ROW EXECUTE FUNCTION public.haven_payroll_source_revision();

-- Acquire before tuple locks, including direct DML. A single payroll writer lock
-- also covers absent source keys and conflicting imports into different batches.
CREATE FUNCTION haven.lock_payroll() RETURNS void LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('haven_payroll_writer',0));
$$;
CREATE FUNCTION public.haven_payroll_write_lock() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM haven.lock_payroll(); RETURN NULL; END $$;
CREATE TRIGGER payroll_write_lock BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_export_batches
 FOR EACH STATEMENT EXECUTE FUNCTION public.haven_payroll_write_lock();
CREATE TRIGGER payroll_write_lock BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_export_lines
 FOR EACH STATEMENT EXECUTE FUNCTION public.haven_payroll_write_lock();

CREATE FUNCTION haven.payroll_authorize(p_batch uuid,p_actor uuid DEFAULT auth.uid()) RETURNS public.payroll_export_batches
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.payroll_export_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.payroll_export_batches WHERE id=p_batch AND deleted_at IS NULL;
 IF NOT FOUND OR auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid()
  OR haven.organization_id() IS DISTINCT FROM b.organization_id OR haven.app_role() IS NULL
  OR haven.app_role() NOT IN ('owner','org_admin','facility_admin')
  OR NOT EXISTS(SELECT 1 FROM haven.accessible_facility_ids() f WHERE f=b.facility_id) THEN
  RAISE EXCEPTION 'Payroll batch is not authorized' USING ERRCODE='42501';
 END IF;
 RETURN b;
END $$;
CREATE FUNCTION haven.payroll_punch_payload(t public.time_records) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' SET timezone='UTC' AS $$
 SELECT jsonb_build_object('time_record_id',t.id,'clock_in',t.clock_in,'clock_out',t.clock_out,
 'regular_hours',t.regular_hours,'actual_hours',t.actual_hours,'overtime_hours',t.overtime_hours,'break_minutes',t.break_minutes);
$$;
CREATE FUNCTION haven.payroll_punch_eligible(t public.time_records,b public.payroll_export_batches) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(t.id IS NOT NULL AND t.deleted_at IS NULL AND t.approved AND t.approved_at IS NOT NULL
 AND t.organization_id=b.organization_id AND t.facility_id=b.facility_id
 AND t.clock_in >= (b.period_start::timestamp AT TIME ZONE 'America/New_York')
 AND t.clock_in < ((b.period_end+1)::timestamp AT TIME ZONE 'America/New_York')
 AND t.clock_out IS NOT NULL AND t.actual_hours>0
 AND EXISTS(SELECT 1 FROM public.staff s WHERE s.id=t.staff_id AND s.organization_id=b.organization_id
  AND s.facility_id=b.facility_id AND s.deleted_at IS NULL),false);
$$;
CREATE FUNCTION haven.validate_payroll_sources(p_batch uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.payroll_export_batches%ROWTYPE; l public.payroll_export_lines%ROWTYPE; t public.time_records%ROWTYPE;
BEGIN
 b:=haven.payroll_authorize(p_batch);
 FOR t IN SELECT tr.* FROM public.time_records tr WHERE tr.id IN
  (SELECT time_record_id FROM public.payroll_export_lines WHERE batch_id=p_batch)
  ORDER BY tr.id FOR SHARE LOOP NULL; END LOOP;
 FOR l IN SELECT * FROM public.payroll_export_lines WHERE batch_id=p_batch AND line_kind='time_record_hours' LOOP
  SELECT * INTO t FROM public.time_records WHERE id=l.time_record_id;
  PERFORM 1 FROM public.staff WHERE id=t.staff_id FOR SHARE;
  IF l.deleted_at IS NOT NULL THEN
   IF haven.payroll_punch_eligible(t,b) THEN
    RAISE EXCEPTION 'Payroll punches changed. Refresh approved punches to restore a now-eligible excluded line.';
   END IF;
   CONTINUE;
  END IF;
  IF NOT haven.payroll_punch_eligible(t,b) OR l.source_revision IS DISTINCT FROM t.payroll_source_revision
   OR l.staff_id IS DISTINCT FROM t.staff_id OR l.organization_id IS DISTINCT FROM b.organization_id
   OR l.idempotency_key IS DISTINCT FROM 'time_record:'||t.id::text
   OR l.payload IS DISTINCT FROM haven.payroll_punch_payload(t) OR l.amount_cents IS NOT NULL THEN
   RAISE EXCEPTION 'Payroll punches changed. Refresh approved punches; review and explicitly exclude any ineligible draft lines before exporting.';
  END IF;
 END LOOP;
 PERFORM haven.payroll_authorize(p_batch);
END $$;

CREATE FUNCTION public.haven_payroll_line_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.payroll_export_batches%ROWTYPE; t public.time_records%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  b:=haven.payroll_authorize(OLD.batch_id);
  IF b.status<>'draft' THEN RAISE EXCEPTION 'Only draft payroll lines are editable'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve payroll line history; use explicit draft exclusion'; END IF;
  IF (NEW.id,NEW.batch_id,NEW.organization_id,NEW.time_record_id,NEW.idempotency_key,NEW.line_kind)
   IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.organization_id,OLD.time_record_id,OLD.idempotency_key,OLD.line_kind) THEN
   RAISE EXCEPTION 'Payroll line identity cannot change'; END IF;
 END IF;
 b:=haven.payroll_authorize(NEW.batch_id);
 IF b.status<>'draft' OR NEW.organization_id IS DISTINCT FROM b.organization_id THEN RAISE EXCEPTION 'Only scoped draft payroll lines are editable'; END IF;
 IF NEW.line_kind<>'time_record_hours' THEN
  PERFORM 1 FROM public.staff WHERE id=NEW.staff_id AND organization_id=b.organization_id AND facility_id=b.facility_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll staff must belong to the batch facility'; END IF;
 END IF;
 IF NEW.line_kind='time_record_hours' THEN
  SELECT * INTO t FROM public.time_records WHERE id=NEW.time_record_id FOR SHARE;
  PERFORM 1 FROM public.staff WHERE id=t.staff_id FOR SHARE;
  IF NEW.deleted_at IS NOT NULL THEN
   IF TG_OP='INSERT' OR haven.payroll_punch_eligible(t,b) OR nullif(trim(NEW.exclusion_reason),'') IS NULL
    OR (NEW.payload,NEW.source_revision,NEW.staff_id,NEW.amount_cents) IS DISTINCT FROM (OLD.payload,OLD.source_revision,OLD.staff_id,OLD.amount_cents) THEN
    RAISE EXCEPTION 'Only ineligible draft punches may be explicitly excluded without changing their evidence'; END IF;
  ELSIF NOT haven.payroll_punch_eligible(t,b) OR NEW.source_revision IS DISTINCT FROM t.payroll_source_revision
   OR NEW.payload IS DISTINCT FROM haven.payroll_punch_payload(t) OR NEW.staff_id IS DISTINCT FROM t.staff_id
   OR NEW.idempotency_key IS DISTINCT FROM 'time_record:'||t.id::text OR NEW.amount_cents IS NOT NULL THEN
   RAISE EXCEPTION 'Payroll line must match a current approved punch';
  END IF;
 ELSIF NEW.time_record_id IS NOT NULL OR NEW.idempotency_key LIKE 'time_record:%' OR NEW.source_revision IS NOT NULL THEN
  RAISE EXCEPTION 'Punch identity requires a time record line';
 END IF;
 PERFORM haven.payroll_authorize(NEW.batch_id);
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_line_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_export_lines
 FOR EACH ROW EXECUTE FUNCTION public.haven_payroll_line_guard();

CREATE FUNCTION public.haven_payroll_batch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION 'New payroll batches must start as draft'; END IF;
  RETURN NEW;
 END IF;
 PERFORM haven.payroll_authorize(OLD.id);
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preserve payroll batch history'; END IF;
 IF OLD.status IN ('exported','voided') THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Historical payroll evidence cannot be changed'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status IN ('queued','failed') THEN
  IF (to_jsonb(NEW)-ARRAY['status','updated_at','updated_by']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','updated_at','updated_by']) THEN
   RAISE EXCEPTION 'Return payroll to draft before editing batch details';
  END IF;
 END IF;
 IF (NEW.organization_id,NEW.facility_id,NEW.period_start,NEW.period_end,NEW.provider,NEW.deleted_at)
 IS DISTINCT FROM (OLD.organization_id,OLD.facility_id,OLD.period_start,OLD.period_end,OLD.provider,OLD.deleted_at)
 AND EXISTS(SELECT 1 FROM public.payroll_export_lines WHERE batch_id=OLD.id) THEN
  RAISE EXCEPTION 'A payroll batch with line history cannot change its scope or period'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('queued','exported') THEN
  PERFORM haven.validate_payroll_sources(OLD.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_payroll_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_export_batches
 FOR EACH ROW EXECUTE FUNCTION public.haven_payroll_batch_guard();

CREATE FUNCTION public.refresh_payroll_time_records(p_batch_id uuid,p_expected_actor uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.payroll_export_batches%ROWTYPE; t public.time_records%ROWTYPE; l public.payroll_export_lines%ROWTYPE;
 added integer:=0; refreshed integer:=0; other_batch integer:=0; review integer:=0;
BEGIN
 PERFORM haven.payroll_authorize(p_batch_id,p_expected_actor);
 PERFORM haven.lock_payroll();
 SELECT * INTO b FROM public.payroll_export_batches WHERE id=p_batch_id FOR UPDATE;
 PERFORM haven.payroll_authorize(p_batch_id,p_expected_actor);
 IF b.status<>'draft' THEN RAISE EXCEPTION 'Only draft payroll batches can refresh punches'; END IF;
 FOR t IN SELECT * FROM public.time_records WHERE (facility_id=b.facility_id AND organization_id=b.organization_id
  AND clock_in >= (b.period_start::timestamp AT TIME ZONE 'America/New_York')
  AND clock_in < ((b.period_end+1)::timestamp AT TIME ZONE 'America/New_York'))
  OR id IN(SELECT time_record_id FROM public.payroll_export_lines WHERE batch_id=b.id)
  ORDER BY id FOR SHARE LOOP
  PERFORM 1 FROM public.staff WHERE id=t.staff_id FOR SHARE;
  SELECT * INTO l FROM public.payroll_export_lines WHERE idempotency_key='time_record:'||t.id::text;
  IF NOT haven.payroll_punch_eligible(t,b) THEN
   IF l.batch_id=b.id AND l.deleted_at IS NULL THEN review:=review+1;
   ELSIF l.id IS NULL AND t.deleted_at IS NULL AND t.approved AND t.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'An approved punch is incomplete or its staff scope is invalid. Review Time records before importing.';
   END IF;
   CONTINUE;
  END IF;
  IF l.id IS NOT NULL AND l.batch_id<>b.id THEN other_batch:=other_batch+1; CONTINUE; END IF;
  PERFORM haven.payroll_authorize(p_batch_id,p_expected_actor);
  IF l.id IS NULL THEN
   INSERT INTO public.payroll_export_lines(organization_id,batch_id,staff_id,line_kind,time_record_id,idempotency_key,payload,source_revision,created_by)
   VALUES(b.organization_id,b.id,t.staff_id,'time_record_hours',t.id,'time_record:'||t.id::text,haven.payroll_punch_payload(t),t.payroll_source_revision,auth.uid());
   added:=added+1;
  ELSIF l.source_revision IS DISTINCT FROM t.payroll_source_revision OR l.payload IS DISTINCT FROM haven.payroll_punch_payload(t)
    OR l.deleted_at IS NOT NULL OR l.staff_id IS DISTINCT FROM t.staff_id OR l.amount_cents IS NOT NULL THEN
   UPDATE public.payroll_export_lines SET staff_id=t.staff_id,amount_cents=NULL,payload=haven.payroll_punch_payload(t),source_revision=t.payroll_source_revision,
    deleted_at=NULL,exclusion_reason=NULL,updated_by=auth.uid() WHERE id=l.id;
   refreshed:=refreshed+1;
  END IF;
 END LOOP;
 PERFORM haven.payroll_authorize(p_batch_id,p_expected_actor);
 RETURN jsonb_build_object('added',added,'refreshed',refreshed,'other_batch',other_batch,'needs_review',review);
END $$;
CREATE FUNCTION public.exclude_payroll_draft_punch(p_batch_id uuid,p_line_id uuid,p_expected_actor uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM haven.payroll_authorize(p_batch_id,p_expected_actor); PERFORM haven.lock_payroll();
 PERFORM 1 FROM public.payroll_export_batches WHERE id=p_batch_id FOR UPDATE;
 PERFORM haven.payroll_authorize(p_batch_id,p_expected_actor);
 UPDATE public.payroll_export_lines SET deleted_at=clock_timestamp(),exclusion_reason='Explicitly excluded after source became ineligible; retained for review',updated_by=auth.uid()
 WHERE id=p_line_id AND batch_id=p_batch_id AND line_kind='time_record_hours' AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft punch line unavailable'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.payroll_export_snapshot(p_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.payroll_export_batches%ROWTYPE; result jsonb;
BEGIN
 PERFORM haven.payroll_authorize(p_batch_id); PERFORM haven.lock_payroll();
 SELECT * INTO b FROM public.payroll_export_batches WHERE id=p_batch_id FOR SHARE;
 PERFORM haven.payroll_authorize(p_batch_id);
 IF EXISTS(SELECT 1 FROM public.payroll_export_lines l WHERE l.batch_id=b.id AND l.deleted_at IS NULL
  AND (l.organization_id IS DISTINCT FROM b.organization_id OR NOT EXISTS(SELECT 1 FROM public.staff s WHERE s.id=l.staff_id AND s.organization_id=b.organization_id))) THEN
  RAISE EXCEPTION 'Payroll line scope requires review' USING ERRCODE='42501'; END IF;
 IF b.status<>'exported' THEN PERFORM haven.validate_payroll_sources(p_batch_id); END IF;
 SELECT jsonb_build_object('batch',to_jsonb(b),'lines',coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('staff',
  (SELECT jsonb_build_object('first_name',s.first_name,'last_name',s.last_name) FROM public.staff s WHERE s.id=l.staff_id AND s.organization_id=b.organization_id AND s.facility_id=b.facility_id AND s.deleted_at IS NULL)) ORDER BY l.created_at,l.id),'[]'::jsonb),
  'line_count',count(*)) INTO result FROM public.payroll_export_lines l WHERE l.batch_id=b.id AND l.deleted_at IS NULL;
 PERFORM haven.payroll_authorize(p_batch_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.lock_payroll(),haven.payroll_authorize(uuid,uuid),haven.payroll_punch_payload(public.time_records),haven.payroll_punch_eligible(public.time_records,public.payroll_export_batches),haven.validate_payroll_sources(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION haven.lock_payroll() TO authenticated;
REVOKE ALL ON FUNCTION public.refresh_payroll_time_records(uuid,uuid),public.exclude_payroll_draft_punch(uuid,uuid,uuid),public.payroll_export_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refresh_payroll_time_records(uuid,uuid),public.exclude_payroll_draft_punch(uuid,uuid,uuid),public.payroll_export_snapshot(uuid) TO authenticated;

/* Rollback (coordinate with reverting the payroll UI; restores pre-freshness behavior).
   Retain source_revision/exclusion_reason columns and excluded line evidence for audit.
   Run in one transaction; never unexclude or rewrite exported payloads during rollback.
BEGIN;
DROP TRIGGER payroll_line_guard ON public.payroll_export_lines;
DROP TRIGGER a_payroll_batch_guard ON public.payroll_export_batches;
DROP TRIGGER payroll_write_lock ON public.payroll_export_lines;
DROP TRIGGER payroll_write_lock ON public.payroll_export_batches;
DROP TRIGGER zz_payroll_source_revision ON public.time_records;
DROP FUNCTION public.refresh_payroll_time_records(uuid,uuid);
DROP FUNCTION public.exclude_payroll_draft_punch(uuid,uuid,uuid);
DROP FUNCTION public.haven_payroll_line_guard();
DROP FUNCTION public.haven_payroll_batch_guard();
DROP FUNCTION public.haven_payroll_write_lock();
DROP FUNCTION public.haven_payroll_source_revision();
CREATE OR REPLACE FUNCTION public.payroll_export_snapshot(p_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT jsonb_build_object('batch',to_jsonb(b),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('staff',(SELECT jsonb_build_object('first_name',s.first_name,'last_name',s.last_name) FROM public.staff s WHERE s.id=l.staff_id)) ORDER BY l.created_at,l.id) FROM public.payroll_export_lines l WHERE l.batch_id=b.id AND l.deleted_at IS NULL),'[]'::jsonb))
    INTO v_result FROM public.payroll_export_batches b WHERE b.id=p_batch_id AND b.deleted_at IS NULL;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Payroll batch unavailable'; END IF;
  RETURN v_result||jsonb_build_object('line_count',jsonb_array_length(v_result->'lines'));
END $$;
REVOKE ALL ON FUNCTION public.payroll_export_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_export_snapshot(uuid) TO authenticated;

DROP FUNCTION haven.validate_payroll_sources(uuid);
DROP FUNCTION haven.payroll_punch_payload(public.time_records);
DROP FUNCTION haven.payroll_punch_eligible(public.time_records,public.payroll_export_batches);
DROP FUNCTION haven.payroll_authorize(uuid,uuid);
DROP FUNCTION haven.lock_payroll();
COMMIT;
*/
