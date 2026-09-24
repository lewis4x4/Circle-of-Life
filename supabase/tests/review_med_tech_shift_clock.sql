-- COL-668: the Med-Tech cockpit shift opens on clock-in and closes on clock-out.
-- Native scratch-only probe; every fixture rolls back. Synthetic staff only.
--
-- Protects: a med-tech clocking in on the floor app's time clock (a real
-- authenticated insert through RLS) opens their cockpit shift at that facility,
-- with the facility's shift window, the building's active residents and the
-- scheduled doses in the window (minus resolved doses, off-day weekly orders and
-- PRNs); the med-tech can read it the way useShiftCurrent does; a second punch
-- does not open a second shift; clock-out closes it and the cockpit query comes
-- back empty; the kiosk ledger does the same; a facility rule of 'none' stops the
-- clock opening shifts (the trigger is configuration, not code); a non-med-tech
-- punch opens nothing; a rule cannot be backdated or set by a med-tech.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
-- Hosted Supabase grants these by default; the replay has no default privileges.
GRANT INSERT, UPDATE ON public.time_records, public.emar_records, public.med_passes, public.shift_tape_events TO authenticated;

CREATE TEMP TABLE mt AS
SELECT gen_random_uuid() scheduler, gen_random_uuid() scheduler_session, gen_random_uuid() tech, gen_random_uuid() tech_session, gen_random_uuid() tech_staff,
       gen_random_uuid() keeper, gen_random_uuid() keeper_session, gen_random_uuid() keeper_staff,
       gen_random_uuid() entity, gen_random_uuid() facility, o.id org,
       gen_random_uuid() res_a, gen_random_uuid() res_b, gen_random_uuid() res_gone,
       gen_random_uuid() med_daily, gen_random_uuid() med_weekly, gen_random_uuid() med_prn, gen_random_uuid() med_gone,
       gen_random_uuid() punch,
       (now() AT TIME ZONE 'America/New_York')::date today
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;
GRANT SELECT ON mt TO authenticated;

INSERT INTO public.entities(id,organization_id,name,entity_type,status) SELECT entity, org, 'Med-Tech Shift Probe LLC', 'llc', 'active'::public.entity_status FROM mt;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  SELECT facility, entity, org, 'Med-Tech Shift Probe House', '1 Probe Way', 'Probeville', '00000', 10, 'America/New_York' FROM mt;
-- The facility's own shift model: day 07:00-19:00, night 19:00-07:00.
UPDATE public.facility_shift_definitions SET deleted_at = now() WHERE facility_id = (SELECT facility FROM mt);
INSERT INTO public.facility_shift_definitions(organization_id,facility_id,shift_key,roster_shift_type,label,starts_at_local,ends_at_local,sort_order)
  SELECT org, facility, 'probe_day', 'day'::public.shift_type, 'Day', time '07:00', time '19:00', 1 FROM mt
  UNION ALL SELECT org, facility, 'probe_night', 'night'::public.shift_type, 'Night', time '19:00', time '07:00', 2 FROM mt;
-- The ruling took effect at migration time; the fixture punches earlier today, so
-- the facility gets its own clock_in/clock_out row effective yesterday.
INSERT INTO public.med_tech_shift_rules(organization_id,facility_id,open_trigger,close_trigger,effective_from,change_reason)
  SELECT org, facility, 'clock_in', 'clock_out', now() - interval '2 days', 'probe' FROM mt;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT u, u||'@review.invalid', '{}'::jsonb, '{}'::jsonb FROM mt, LATERAL unnest(ARRAY[tech, keeper, scheduler]) u;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT tech, tech||'@review.invalid','Tess Probe','med_tech'::public.app_role,org,true FROM mt
  UNION ALL SELECT keeper, keeper||'@review.invalid','Kip Probe','housekeeper'::public.app_role,org,true FROM mt
  UNION ALL SELECT scheduler, scheduler||'@review.invalid','Schedule Probe','facility_admin'::public.app_role,org,true FROM mt;
INSERT INTO auth.sessions(id,user_id) SELECT tech_session, tech FROM mt UNION ALL SELECT keeper_session, keeper FROM mt UNION ALL SELECT scheduler_session, scheduler FROM mt;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
  SELECT u, facility, org FROM mt, LATERAL unnest(ARRAY[tech, keeper, scheduler]) u;
INSERT INTO public.staff(id,user_id,facility_id,organization_id,first_name,last_name,staff_role,hire_date)
  SELECT tech_staff, tech, facility, org, 'Tess', 'Probe', 'medication_tech'::public.staff_role, current_date - 300 FROM mt
  UNION ALL SELECT keeper_staff, keeper, facility, org, 'Kip', 'Probe', 'housekeeping'::public.staff_role, current_date - 300 FROM mt;

INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status)
  SELECT res_a, facility, org, 'Ada', 'Alpha', DATE '1940-01-01', 'female'::public.gender, 'active'::public.resident_status FROM mt
  UNION ALL SELECT res_b, facility, org, 'Bea', 'Beta', DATE '1941-01-01', 'female'::public.gender, 'active'::public.resident_status FROM mt
  UNION ALL SELECT res_gone, facility, org, 'Cal', 'Gone', DATE '1939-01-01', 'male'::public.gender, 'discharged'::public.resident_status FROM mt;
INSERT INTO public.resident_medications(id,resident_id,facility_id,organization_id,medication_name,strength,route,frequency,scheduled_times,order_date,start_date,instructions,prescriber_name,prn_max_frequency)
  -- 08:00 and 14:00 in the day window, 21:00 outside it.
  SELECT med_daily, res_a, facility, org, 'Probe-a-pril', '10 mg', 'oral'::public.medication_route, 'tid'::public.medication_frequency,
         ARRAY['08:00','14:00','21:00']::time[], today - 10, today - 10, 'By mouth', 'Dr Probe', NULL FROM mt
  -- Weekly, but today is not its day.
  UNION ALL SELECT med_weekly, res_b, facility, org, 'Probe-weekly', '5 mg', 'oral'::public.medication_route, 'weekly'::public.medication_frequency,
         ARRAY['09:00']::time[], today - 10, today - 10, 'By mouth', 'Dr Probe', NULL FROM mt
  UNION ALL SELECT med_prn, res_b, facility, org, 'Probe-prn', '1 tab', 'oral'::public.medication_route, 'prn'::public.medication_frequency,
         NULL, today - 10, today - 10, 'As needed', 'Dr Probe', 'q6h' FROM mt
  UNION ALL SELECT med_gone, res_gone, facility, org, 'Probe-gone', '1 tab', 'oral'::public.medication_route, 'daily'::public.medication_frequency,
         ARRAY['10:00']::time[], today - 10, today - 10, 'By mouth', 'Dr Probe', NULL FROM mt;
-- The 08:00 dose was already given on the floor app before clock-in.
INSERT INTO public.emar_records(resident_id,resident_medication_id,facility_id,organization_id,scheduled_time,actual_time,status,administered_by,is_prn)
  SELECT res_a, med_daily, facility, org, (today + time '08:00') AT TIME ZONE 'America/New_York', now(), 'given'::public.emar_status, tech, false FROM mt;

CREATE FUNCTION pg_temp.mt_as(p_user uuid, p_session uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
    'auth_claim_version',p.auth_claim_version,'app_role',p.app_role,'organization_id',p.organization_id,
    'iat',extract(epoch FROM clock_timestamp())::bigint)::text, true)::void
  FROM public.user_profiles p WHERE p.id = p_user
$$;

-- 1. A non-med-tech clocking in opens nothing.
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_as(keeper, keeper_session) FROM mt;
INSERT INTO public.time_records(staff_id,facility_id,organization_id,clock_in,clock_in_method,approved,created_by)
  SELECT keeper_staff, facility, org, (today + time '07:01') AT TIME ZONE 'America/New_York', 'mobile', false, keeper FROM mt;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = (SELECT keeper FROM mt)) THEN
    RAISE EXCEPTION 'COL-668: a housekeeper clock-in opened a med-tech cockpit shift';
  END IF;
END $$;

-- 2. The med-tech clocks in on the floor app (authenticated, through RLS).
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_as(tech, tech_session) FROM mt;
INSERT INTO public.time_records(id,staff_id,facility_id,organization_id,clock_in,clock_in_method,approved,created_by)
  SELECT punch, tech_staff, facility, org, (today + time '06:52') AT TIME ZONE 'America/New_York', 'mobile', false, tech FROM mt;
-- What useShiftCurrent reads, as the med-tech.
DO $$ DECLARE f mt; s record; n int; BEGIN
  SELECT * INTO f FROM mt;
  SELECT * INTO s FROM public.med_tech_shifts WHERE user_id = auth.uid() AND status = 'active' AND deleted_at IS NULL;
  IF s.id IS NULL THEN RAISE EXCEPTION 'COL-668: clock-in did not open a cockpit shift the med-tech can read'; END IF;
  IF s.facility_id <> f.facility OR s.opened_from <> 'time_records' OR s.opened_from_id <> f.punch THEN
    RAISE EXCEPTION 'COL-668: the shift did not take its facility and source from the punch: %', row_to_json(s);
  END IF;
  IF s.shift_start <> (f.today + time '07:00') AT TIME ZONE 'America/New_York'
     OR s.shift_end <> (f.today + time '19:00') AT TIME ZONE 'America/New_York'
     OR s.clocked_in_at <> (f.today + time '06:52') AT TIME ZONE 'America/New_York' THEN
    RAISE EXCEPTION 'COL-668: an early clock-in did not take the facility day shift window: %', row_to_json(s);
  END IF;
  SELECT count(*) INTO n FROM public.med_tech_shift_residents WHERE shift_id = s.id;
  IF n <> 2 OR EXISTS (SELECT 1 FROM public.med_tech_shift_residents WHERE shift_id = s.id AND resident_id = f.res_gone) THEN
    RAISE EXCEPTION 'COL-668: expected the two active residents on the shift, got %', n;
  END IF;
  -- Only the 14:00 daily dose: 08:00 is already given, 21:00 is outside the
  -- window, the weekly order is off today, PRNs are not scheduled passes.
  SELECT count(*) INTO n FROM public.med_passes WHERE shift_id = s.id AND deleted_at IS NULL;
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.med_passes WHERE shift_id = s.id AND resident_medication_id = f.med_daily
       AND scheduled_time = (f.today + time '14:00') AT TIME ZONE 'America/New_York' AND status = 'pending' AND administered_by = f.tech) THEN
    RAISE EXCEPTION 'COL-668: expected exactly the 14:00 dose as a pending pass, got % passes', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shift_tape_events WHERE shift_id = s.id AND event_type = 'clock_in') THEN
    RAISE EXCEPTION 'COL-668: the shift tape has no clock-in event';
  END IF;
END $$;
RESET ROLE;

-- 3. A second open punch (another device) does not open a second shift, and
--    punches keyed by a non-admin colleague or at an ungranted building open nothing.
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_as(tech, tech_session) FROM mt;
INSERT INTO public.time_records(staff_id,facility_id,organization_id,clock_in,clock_in_method,approved,created_by)
  SELECT tech_staff, facility, org, (today + time '07:10') AT TIME ZONE 'America/New_York', 'mobile', false, tech FROM mt;
RESET ROLE;
DO $$ DECLARE f mt; BEGIN
  SELECT * INTO f FROM mt;
  IF (SELECT count(*) FROM public.med_tech_shifts WHERE user_id = f.tech) <> 1 THEN
    RAISE EXCEPTION 'COL-668: a second clock-in opened a second cockpit shift';
  END IF;
  UPDATE public.med_tech_shifts SET status = 'completed' WHERE user_id = f.tech;  -- set aside for the next two checks
  IF haven.med_tech_shift_open_from_clock(f.tech_staff, f.facility, now(), NULL, 'time_records', gen_random_uuid(), f.keeper) IS NOT NULL THEN
    RAISE EXCEPTION 'COL-668: a punch a housekeeper keyed for a med-tech opened their shift';
  END IF;
  UPDATE public.user_facility_access SET revoked_at = now() WHERE user_id = f.tech AND facility_id = f.facility;
  IF haven.med_tech_shift_open_from_clock(f.tech_staff, f.facility, now(), NULL, 'time_records', gen_random_uuid(), f.tech) IS NOT NULL THEN
    RAISE EXCEPTION 'COL-668: a clock-in at a building the med-tech is not granted opened a shift there';
  END IF;
  UPDATE public.user_facility_access SET revoked_at = NULL WHERE user_id = f.tech AND facility_id = f.facility;
  UPDATE public.med_tech_shifts SET status = 'active' WHERE user_id = f.tech;
END $$;

-- 4. Clock-out on the floor app closes it; the cockpit query comes back empty.
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_as(tech, tech_session) FROM mt;
UPDATE public.time_records SET clock_out = (today + time '15:04') AT TIME ZONE 'America/New_York', clock_out_method = 'mobile', updated_by = tech
  FROM mt WHERE time_records.id = mt.punch;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = auth.uid() AND status = 'active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'COL-668: clock-out did not close the cockpit shift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = auth.uid() AND status = 'completed'
                 AND clocked_out_at = ((SELECT today FROM mt) + time '15:04') AT TIME ZONE 'America/New_York') THEN
    RAISE EXCEPTION 'COL-668: the closed shift does not carry the clock-out time';
  END IF;
END $$;
-- 5. A rule is configuration an admin sets: a med-tech cannot insert one.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.med_tech_shift_rules(organization_id,facility_id,open_trigger,close_trigger,effective_from,change_reason,created_by)
      SELECT org, facility, 'none', 'none', now(), 'probe', tech FROM mt;
    RAISE EXCEPTION 'COL-668: a med-tech set the cockpit shift rule';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 6. The kiosk ledger opens the night shift; the 14:00 dose the day shift left
--    unresolved is carried over and the med-tech can complete it; a late-synced
--    'out' from before the clock-in does not close it; the kiosk 'out' does.
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id)
  SELECT org, facility, tech_staff, 'in', (today + time '18:55') AT TIME ZONE 'America/New_York', gen_random_uuid() FROM mt;
DO $$ DECLARE f mt; s record; BEGIN
  SELECT * INTO f FROM mt;
  SELECT * INTO s FROM public.med_tech_shifts WHERE user_id = f.tech AND status = 'active';
  IF s.id IS NULL OR s.opened_from <> 'time_punches'
     OR s.shift_start <> (f.today + time '19:00') AT TIME ZONE 'America/New_York'
     OR s.shift_end <> (f.today + 1 + time '07:00') AT TIME ZONE 'America/New_York' THEN
    RAISE EXCEPTION 'COL-668: a kiosk clock-in did not open the night shift: %', row_to_json(s);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.med_passes WHERE shift_id = s.id AND resident_medication_id = f.med_daily
                 AND scheduled_time = (f.today + time '21:00') AT TIME ZONE 'America/New_York') THEN
    RAISE EXCEPTION 'COL-668: the night shift did not get the 21:00 dose';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.med_passes WHERE shift_id = s.id AND resident_medication_id = f.med_daily
                 AND scheduled_time = (f.today + time '14:00') AT TIME ZONE 'America/New_York' AND status = 'pending') THEN
    RAISE EXCEPTION 'COL-668: the unresolved 14:00 dose was stranded on the closed day shift';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.mt_as(tech, tech_session) FROM mt;
SELECT public.complete_med_pass_review(p.id, 'given', 'Given late after clock-out handover', true)
  FROM mt, public.med_passes p JOIN public.med_tech_shifts s ON s.id = p.shift_id
  WHERE s.user_id = mt.tech AND s.status = 'active' AND p.resident_medication_id = mt.med_daily
    AND p.scheduled_time = (mt.today + time '14:00') AT TIME ZONE 'America/New_York';
RESET ROLE;
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id,captured_offline)
  SELECT org, facility, tech_staff, 'out', (today + time '06:30') AT TIME ZONE 'America/New_York', gen_random_uuid(), true FROM mt;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = (SELECT tech FROM mt) AND status = 'active') THEN
    RAISE EXCEPTION 'COL-668: a late-synced clock-out from before the clock-in closed the current shift';
  END IF;
  IF (SELECT status::text FROM public.emar_records WHERE resident_medication_id = (SELECT med_daily FROM mt)
        AND scheduled_time = ((SELECT today FROM mt) + time '14:00') AT TIME ZONE 'America/New_York') <> 'given' THEN
    RAISE EXCEPTION 'COL-668: a generated pass could not be completed through complete_med_pass_review';
  END IF;
END $$;
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id)
  SELECT org, facility, tech_staff, 'out', (today + 1 + time '07:05') AT TIME ZONE 'America/New_York', gen_random_uuid() FROM mt;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = (SELECT tech FROM mt) AND status = 'active') THEN
    RAISE EXCEPTION 'COL-668: a kiosk clock-out did not close the cockpit shift';
  END IF;
END $$;

-- 7. A shift that never got its clock-out does not lock the med-tech out: the
--    next clock-in after its window closes it and opens the new one. An assigned
--    shift wins over the nearest start: a 13:05 clock-in for an assigned day
--    shift is the day shift, not tonight's.
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id)
  SELECT org, facility, tech_staff, 'in', (today + 1 + time '18:58') AT TIME ZONE 'America/New_York', gen_random_uuid() FROM mt;
INSERT INTO public.schedules(id,facility_id,organization_id,week_start_date,status)
  SELECT gen_random_uuid(), facility, org, date_trunc('week', today + 2)::date, 'draft'::public.schedule_status FROM mt;
INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,status,custom_start_time,custom_end_time)
  SELECT (SELECT id FROM public.schedules WHERE facility_id = mt.facility LIMIT 1), tech_staff, facility, org, today + 2, 'day'::public.shift_type, 'assigned'::public.shift_assignment_status,time '07:00',time '19:00' FROM mt;
SELECT pg_temp.mt_as(scheduler,scheduler_session) FROM mt;
UPDATE public.schedules SET status='published' WHERE facility_id=(SELECT facility FROM mt);
SELECT pg_temp.mt_as(tech,tech_session) FROM mt;
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id)
  SELECT org, facility, tech_staff, 'in', (today + 2 + time '13:05') AT TIME ZONE 'America/New_York', gen_random_uuid() FROM mt;
DO $$ DECLARE f mt; s record; BEGIN
  SELECT * INTO f FROM mt;
  IF (SELECT count(*) FROM public.med_tech_shifts WHERE user_id = f.tech AND status = 'active') <> 1 THEN
    RAISE EXCEPTION 'COL-668: expected exactly one open shift after a missed clock-out';
  END IF;
  SELECT * INTO s FROM public.med_tech_shifts WHERE user_id = f.tech AND status = 'active';
  IF s.shift_start <> (f.today + 2 + time '07:00') AT TIME ZONE 'America/New_York' OR s.shift_assignment_id IS NULL THEN
    RAISE EXCEPTION 'COL-668: a late clock-in for an assigned day shift did not take that shift: %', row_to_json(s);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shift_tape_events e JOIN public.med_tech_shifts o ON o.id = e.shift_id
                 WHERE o.user_id = f.tech AND e.event_type = 'clock_out_missing') THEN
    RAISE EXCEPTION 'COL-668: the shift closed for a missing clock-out is not marked on its tape';
  END IF;
  UPDATE public.med_tech_shifts SET status = 'completed' WHERE id = s.id;
END $$;

-- 8. The trigger is configuration: a facility rule of 'none' stops the clock
--    opening cockpit shifts from its effective time on.
INSERT INTO public.med_tech_shift_rules(organization_id,facility_id,open_trigger,close_trigger,effective_from,change_reason)
  SELECT org, facility, 'none', 'clock_out', now() - interval '1 day', 'probe: switched off' FROM mt;
INSERT INTO public.time_records(staff_id,facility_id,organization_id,clock_in,clock_in_method,approved,created_by)
  SELECT tech_staff, facility, org, (today + time '07:00') AT TIME ZONE 'America/New_York', 'mobile', false, tech FROM mt;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = (SELECT tech FROM mt) AND status = 'active') THEN
    RAISE EXCEPTION 'COL-668: a facility rule of none still opened a cockpit shift';
  END IF;
END $$;

-- 9. The writer is not callable by any request role.
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'haven.med_tech_shift_open_from_clock(uuid,uuid,timestamptz,uuid,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'haven.med_tech_shift_close_from_clock(uuid,uuid,timestamptz,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'haven.med_tech_shift_rule_at(uuid,uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'COL-668: a request role can call the cockpit shift writer directly';
  END IF;
END $$;

ROLLBACK;
