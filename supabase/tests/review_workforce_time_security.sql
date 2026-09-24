-- Disposable PostgreSQL replay only. Every fixture and auth adaptation rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;

CREATE TEMP TABLE workforce_time_fixture AS
SELECT f.organization_id org, f.id facility,
  (SELECT b.id FROM public.facilities b WHERE b.organization_id = f.organization_id AND b.deleted_at IS NULL AND b.id <> f.id LIMIT 1) other_facility,
  gen_random_uuid() staff, gen_random_uuid() colleague, gen_random_uuid() other_staff,
  gen_random_uuid() open_record, gen_random_uuid() closed_record, gen_random_uuid() other_record, gen_random_uuid() cutover_record,
  gen_random_uuid() device, gen_random_uuid() other_device, gen_random_uuid() payroll_batch
FROM public.facilities f WHERE f.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.facilities b WHERE b.organization_id = f.organization_id AND b.deleted_at IS NULL AND b.id <> f.id)
LIMIT 1;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM workforce_time_fixture) THEN RAISE EXCEPTION 'Two replay facilities in one organization are required'; END IF; END $$;
CREATE TEMP TABLE workforce_time_actors AS
SELECT role, gen_random_uuid() id, gen_random_uuid() session_id
FROM unnest(ARRAY['med_tech', 'facility_admin', 'manager']) role;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
SELECT a.id, a.id || '@workforce-review.invalid', jsonb_build_object('organization_id', f.org, 'app_role', a.role), '{}'::jsonb
FROM workforce_time_actors a CROSS JOIN workforce_time_fixture f;
INSERT INTO public.user_profiles(id, email, full_name, app_role, organization_id, is_active)
SELECT a.id, a.id || '@workforce-review.invalid', 'Workforce time review', a.role::public.app_role, f.org, true
FROM workforce_time_actors a CROSS JOIN workforce_time_fixture f
ON CONFLICT (id) DO UPDATE SET app_role = excluded.app_role, organization_id = excluded.organization_id, is_active = true;
INSERT INTO auth.sessions(id, user_id) SELECT session_id, id FROM workforce_time_actors;
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id)
SELECT a.id, f.facility, f.org FROM workforce_time_actors a CROSS JOIN workforce_time_fixture f;
-- Facility access is not staff membership: the self actor also has access to B,
-- but is not assigned there, so a forged self insert must still be refused.
INSERT INTO public.user_facility_access(user_id, facility_id, organization_id)
SELECT a.id, f.other_facility, f.org FROM workforce_time_actors a CROSS JOIN workforce_time_fixture f WHERE a.role = 'med_tech';
INSERT INTO public.staff(id, user_id, organization_id, facility_id, first_name, last_name, staff_role, hire_date)
SELECT f.staff, a.id, f.org, f.facility, 'Self', 'Time review', 'resident_aide', current_date
FROM workforce_time_fixture f CROSS JOIN workforce_time_actors a WHERE a.role = 'med_tech';
INSERT INTO public.staff(id, organization_id, facility_id, first_name, last_name, staff_role, hire_date)
SELECT colleague, org, facility, 'Colleague', 'Time review', 'resident_aide'::public.staff_role, current_date FROM workforce_time_fixture
UNION ALL SELECT other_staff, org, other_facility, 'Other facility', 'Time review', 'resident_aide'::public.staff_role, current_date FROM workforce_time_fixture;
INSERT INTO public.time_records(id, staff_id, organization_id, facility_id, clock_in, clock_out, clock_in_method)
SELECT closed_record, staff, org, facility, '2090-01-01 12:00Z'::timestamptz, '2090-01-01 20:00Z'::timestamptz, 'manual' FROM workforce_time_fixture
UNION ALL SELECT other_record, other_staff, org, other_facility, '2090-01-01 12:00Z'::timestamptz, '2090-01-01 20:00Z'::timestamptz, 'manual' FROM workforce_time_fixture;
INSERT INTO public.timeclock_devices(id, organization_id, facility_id, label, token_hash, enrolled_by)
SELECT f.device, f.org, f.facility, 'Workforce replay A', encode(extensions.digest(f.device::text, 'sha256'), 'hex'), a.id
FROM workforce_time_fixture f CROSS JOIN workforce_time_actors a WHERE a.role = 'facility_admin'
UNION ALL SELECT f.other_device, f.org, f.other_facility, 'Workforce replay B', encode(extensions.digest(f.other_device::text, 'sha256'), 'hex'), a.id
FROM workforce_time_fixture f CROSS JOIN workforce_time_actors a WHERE a.role = 'facility_admin';
INSERT INTO public.time_punches(organization_id, facility_id, staff_id, punch_type, punched_at, client_punch_id)
SELECT org, facility, colleague, 'in', '2090-01-01 12:00Z'::timestamptz, gen_random_uuid() FROM workforce_time_fixture
UNION ALL SELECT org, other_facility, other_staff, 'in', '2090-01-01 12:00Z'::timestamptz, gen_random_uuid() FROM workforce_time_fixture;
INSERT INTO public.time_punch_corrections(organization_id, facility_id, staff_id, correction_type, punch_type, corrected_punched_at, reason, corrected_by)
SELECT f.org, f.facility, f.colleague, 'add_punch', 'out', '2090-01-01 20:00Z'::timestamptz, 'missed_punch', a.id
FROM workforce_time_fixture f CROSS JOIN workforce_time_actors a WHERE a.role = 'facility_admin'
UNION ALL SELECT f.org, f.other_facility, f.other_staff, 'add_punch', 'out', '2090-01-01 20:00Z'::timestamptz, 'missed_punch', a.id
FROM workforce_time_fixture f CROSS JOIN workforce_time_actors a WHERE a.role = 'facility_admin';
INSERT INTO public.timeclock_sync_rejections(organization_id, facility_id, staff_id, device_id, client_punch_id, punch_type, reason)
SELECT org, facility, colleague, device, gen_random_uuid(), 'out', 'invalid_next_type' FROM workforce_time_fixture
UNION ALL SELECT org, other_facility, other_staff, other_device, gen_random_uuid(), 'out', 'invalid_next_type' FROM workforce_time_fixture;
INSERT INTO public.timeclock_facility_settings(organization_id, facility_id, timeclock_enabled)
SELECT org, facility, false FROM workforce_time_fixture
UNION ALL SELECT org, other_facility, false FROM workforce_time_fixture
ON CONFLICT (organization_id, facility_id) DO UPDATE SET timeclock_enabled = false;
INSERT INTO public.timeclock_organization_settings(organization_id, timeclock_pay_period, timeclock_pay_period_anchor)
SELECT org, 'weekly', '2090-01-02'::date FROM workforce_time_fixture
ON CONFLICT (organization_id) DO UPDATE SET timeclock_pay_period = 'weekly', timeclock_pay_period_anchor = '2090-01-02';
INSERT INTO public.payroll_export_batches(id, organization_id, facility_id, period_start, period_end)
SELECT payroll_batch, org, facility, '2090-01-01'::date, '2090-01-07'::date FROM workforce_time_fixture;

CREATE FUNCTION pg_temp.workforce_actor(p_role text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  SELECT t.id, t.session_id, p.auth_claim_version, p.organization_id INTO STRICT a
  FROM workforce_time_actors t JOIN public.user_profiles p ON p.id = t.id WHERE t.role = p_role;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', a.id, 'session_id', a.session_id,
    'iat', extract(epoch FROM clock_timestamp())::bigint, 'auth_claim_version', a.auth_claim_version,
    'role', 'authenticated', 'app_role', p_role, 'organization_id', a.organization_id,
    'app_metadata', jsonb_build_object('app_role', p_role, 'organization_id', a.organization_id))::text, true);
END $$;
CREATE FUNCTION pg_temp.workforce_denied(p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE affected integer;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN RAISE EXCEPTION 'Unauthorized time write succeeded: %', p_sql; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON workforce_time_fixture, workforce_time_actors TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.time_records TO authenticated;
GRANT SELECT ON public.staff, public.staff_facility_assignments TO authenticated;
GRANT SELECT ON public.payroll_export_batches TO authenticated;

SELECT pg_temp.workforce_actor('med_tech');
SET LOCAL ROLE authenticated;
INSERT INTO public.time_records(id, staff_id, organization_id, facility_id, clock_in, clock_in_method, created_by)
SELECT open_record, staff, org, facility, '2090-01-02 12:00Z', 'mobile', auth.uid() FROM workforce_time_fixture;
DO $$ DECLARE f record; changes text; BEGIN
  SELECT * INTO f FROM workforce_time_fixture;
  -- INSERT cannot smuggle approval, worked/pay hours, or a completed shift.
  PERFORM pg_temp.workforce_denied(format('INSERT INTO public.time_records(staff_id,organization_id,facility_id,clock_in,clock_out,clock_in_method,approved,approved_by,approved_at) VALUES(%L,%L,%L,''2090-01-03 12:00Z'',''2090-01-03 20:00Z'',''mobile'',true,%L,now())', f.staff, f.org, f.facility, auth.uid()));
  PERFORM pg_temp.workforce_denied(format('INSERT INTO public.time_records(staff_id,organization_id,facility_id,clock_in,clock_in_method,regular_hours) VALUES(%L,%L,%L,''2090-01-03 12:00Z'',''mobile'',80)', f.staff, f.org, f.facility));
  PERFORM pg_temp.workforce_denied(format('INSERT INTO public.time_records(staff_id,organization_id,facility_id,clock_in,clock_in_method) VALUES(%L,%L,%L,''2090-01-03 12:00Z'',''mobile'')', f.staff, f.org, f.other_facility));
  PERFORM pg_temp.workforce_denied(format('INSERT INTO public.time_records(staff_id,organization_id,facility_id,clock_in,clock_in_method) VALUES(%L,%L,%L,''2090-01-03 12:00Z'',''mobile'')', f.colleague, f.org, f.facility));
  FOREACH changes IN ARRAY ARRAY[
    'approved=true,approved_by=auth.uid(),approved_at=now()',
    'approved_by=auth.uid()', 'approved_at=now()', 'regular_hours=80', 'overtime_hours=40',
    'actual_hours=100', 'scheduled_hours=100', 'break_minutes=60',
    'clock_in=''2090-01-01 12:00Z''', 'clock_in_method=''manual''',
    'payroll_source_revision=900', 'deleted_at=now()',
    format('staff_id=%L', f.colleague), format('facility_id=%L', f.other_facility),
    'organization_id=gen_random_uuid()', 'id=gen_random_uuid()'
  ] LOOP
    -- Include clock_out in every attack so the ordinary close policy passes;
    -- the guard must inspect requested fields before derived-field triggers run.
    PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET clock_out=''2090-01-02 20:00Z'',%s WHERE id=%L', changes, f.open_record));
  END LOOP;
  PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET approved=true,approved_by=auth.uid(),approved_at=now() WHERE id=%L', f.closed_record));
  UPDATE public.time_records SET clock_out = '2090-01-02 20:00Z', clock_out_method = 'mobile', updated_by = auth.uid() WHERE id = f.open_record;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.time_records WHERE id = f.open_record AND actual_hours = 8
    AND NOT approved AND approved_by IS NULL AND approved_at IS NULL AND regular_hours IS NULL AND overtime_hours IS NULL) THEN
    RAISE EXCEPTION 'Valid legacy clock-out failed or gained approval/pay allocation';
  END IF;
  PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET clock_out=''2090-01-02 23:00Z'' WHERE id=%L', f.open_record));
  IF EXISTS (SELECT 1 FROM public.time_records WHERE id = f.other_record) THEN RAISE EXCEPTION 'Staff read another employee time record'; END IF;
END $$;

RESET ROLE;
SELECT pg_temp.workforce_actor('facility_admin');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM workforce_time_fixture;
  IF EXISTS (SELECT 1 FROM public.time_records WHERE id = f.other_record) THEN RAISE EXCEPTION 'Administrator read unassigned facility time'; END IF;
  PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET approved=true,approved_by=auth.uid(),approved_at=now() WHERE id=%L', f.other_record));
  PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET staff_id=%L WHERE id=%L', f.other_staff, f.closed_record));
  PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET facility_id=%L WHERE id=%L', f.other_facility, f.closed_record));
  UPDATE public.time_records SET approved = true, approved_by = auth.uid(), approved_at = now(), regular_hours = 8, overtime_hours = 0 WHERE id = f.closed_record;
  IF NOT FOUND THEN RAISE EXCEPTION 'Administrator could not approve accessible time'; END IF;
  UPDATE public.time_records SET clock_out = '2090-01-01 21:00Z' WHERE id = f.closed_record;
  IF NOT EXISTS (SELECT 1 FROM public.time_records WHERE id = f.closed_record AND actual_hours = 9
    AND NOT approved AND approved_by IS NULL AND approved_at IS NULL AND regular_hours IS NULL AND overtime_hours IS NULL) THEN
    RAISE EXCEPTION 'Administrator correction did not reset approval and payroll allocation';
  END IF;
END $$;

RESET ROLE;
SELECT pg_temp.workforce_actor('manager');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM workforce_time_fixture;
  IF (SELECT count(*) FROM public.time_punches WHERE staff_id IN (f.colleague, f.other_staff)) <> 1
    OR (SELECT count(*) FROM public.time_punch_corrections WHERE staff_id IN (f.colleague, f.other_staff)) <> 1
    OR (SELECT count(*) FROM public.timeclock_sync_rejections WHERE staff_id IN (f.colleague, f.other_staff)) <> 1 THEN
    RAISE EXCEPTION 'Manager time-ledger reads did not enforce accessible facility scope';
  END IF;
  IF (SELECT count(*) FROM public.timeclock_facility_settings WHERE facility_id IN (f.facility, f.other_facility)) <> 1
    OR (SELECT timeclock_pay_period FROM public.timeclock_organization_settings WHERE organization_id = f.org) IS DISTINCT FROM 'weekly' THEN
    RAISE EXCEPTION 'Manager cannot read scoped timeclock settings';
  END IF;
  PERFORM pg_temp.workforce_denied(format('UPDATE public.time_records SET approved=true,approved_by=auth.uid(),approved_at=now() WHERE id=%L', f.closed_record));
  PERFORM pg_temp.workforce_denied(format('INSERT INTO public.time_punch_corrections(organization_id,facility_id,staff_id,correction_type,punch_type,corrected_punched_at,reason,corrected_by) VALUES(%L,%L,%L,''add_punch'',''out'',''2090-01-01 20:00Z'',''missed_punch'',auth.uid())', f.org, f.facility, f.colleague));
  BEGIN
    PERFORM public.timeclock_credential_status(f.colleague);
    RAISE EXCEPTION 'Manager gained credential authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.refresh_payroll_time_records(f.payroll_batch, auth.uid());
    RAISE EXCEPTION 'Manager gained payroll authority';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.payroll_export_batches WHERE id = f.payroll_batch) THEN RAISE EXCEPTION 'Manager gained payroll batch reads'; END IF;
  RAISE NOTICE 'PASS: staff approval/pay/scope forgery denied; valid legacy close preserved; administrator scope and correction reset preserved; manager ledger reads scoped without payroll/correction authority';
END $$;

-- Compose with the separately owned kiosk cutover. A record opened before the
-- flag changes may still close; when its restrictive policies are installed,
-- staff cannot create another legacy record at that now-enabled facility.
RESET ROLE;
SELECT pg_temp.workforce_actor('med_tech');
SET LOCAL ROLE authenticated;
INSERT INTO public.time_records(id, staff_id, organization_id, facility_id, clock_in, clock_in_method)
SELECT cutover_record, staff, org, facility, '2090-01-03 12:00Z', 'mobile' FROM workforce_time_fixture;
RESET ROLE;
UPDATE public.timeclock_facility_settings SET timeclock_enabled = true
WHERE facility_id = (SELECT facility FROM workforce_time_fixture);
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
  SELECT * INTO f FROM workforce_time_fixture;
  UPDATE public.time_records SET clock_out = '2090-01-03 20:00Z', clock_out_method = 'mobile', updated_by = auth.uid() WHERE id = f.cutover_record;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.time_records WHERE id = f.cutover_record AND actual_hours = 8 AND NOT approved) THEN
    RAISE EXCEPTION 'Valid pre-cutover legacy record could not close';
  END IF;
  IF to_regprocedure('haven.timeclock_enabled_for(uuid)') IS NOT NULL THEN
    PERFORM pg_temp.workforce_denied(format('INSERT INTO public.time_records(staff_id,organization_id,facility_id,clock_in,clock_in_method) VALUES(%L,%L,%L,''2090-01-04 12:00Z'',''mobile'')', f.staff, f.org, f.facility));
  END IF;
  RAISE NOTICE 'PASS: pre-cutover legacy clock-out preserved';
END $$;
ROLLBACK;
