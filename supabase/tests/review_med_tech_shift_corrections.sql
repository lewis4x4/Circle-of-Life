-- COL-681: the Med-Tech cockpit shift follows kiosk punch corrections.
-- Native scratch-only probe; every fixture rolls back. Synthetic staff only.
--
-- Protects: a manager's added 'in' opens the cockpit shift and an added 'out'
-- closes it; voiding the punch that opened an open shift closes it with a tape
-- note; retiming that punch moves clocked_in_at; an added 'in' older than an
-- existing 'out' opens nothing.
BEGIN;

CREATE TEMP TABLE mc AS
SELECT gen_random_uuid() tech, gen_random_uuid() tech_staff, gen_random_uuid() mgr,
       gen_random_uuid() entity, gen_random_uuid() facility, o.id org,
       (now() AT TIME ZONE 'America/New_York')::date today
FROM public.organizations o WHERE o.deleted_at IS NULL ORDER BY o.id LIMIT 1;

INSERT INTO public.entities(id,organization_id,name,entity_type,status) SELECT entity, org, 'Correction Probe LLC', 'llc', 'active'::public.entity_status FROM mc;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  SELECT facility, entity, org, 'Correction Probe House', '1 Probe Way', 'Probeville', '00000', 10, 'America/New_York' FROM mc;
UPDATE public.facility_shift_definitions SET deleted_at = now() WHERE facility_id = (SELECT facility FROM mc);
INSERT INTO public.facility_shift_definitions(organization_id,facility_id,shift_key,roster_shift_type,label,starts_at_local,ends_at_local,sort_order)
  SELECT org, facility, 'probe_day', 'day'::public.shift_type, 'Day', time '07:00', time '19:00', 1 FROM mc
  UNION ALL SELECT org, facility, 'probe_night', 'night'::public.shift_type, 'Night', time '19:00', time '07:00', 2 FROM mc;
INSERT INTO public.med_tech_shift_rules(organization_id,facility_id,open_trigger,close_trigger,effective_from,change_reason)
  SELECT org, facility, 'clock_in', 'clock_out', now() - interval '3 days', 'probe' FROM mc;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  SELECT u, u||'@review.invalid', '{}'::jsonb, '{}'::jsonb FROM mc, LATERAL unnest(ARRAY[tech, mgr]) u;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
  SELECT tech, tech||'@review.invalid','Tess Probe','med_tech'::public.app_role,org,true FROM mc
  UNION ALL SELECT mgr, mgr||'@review.invalid','Mo Admin','facility_admin'::public.app_role,org,true FROM mc;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT u, facility, org FROM mc, LATERAL unnest(ARRAY[tech, mgr]) u;
INSERT INTO public.staff(id,user_id,facility_id,organization_id,first_name,last_name,staff_role,hire_date)
  SELECT tech_staff, tech, facility, org, 'Tess', 'Probe', 'medication_tech'::public.staff_role, current_date - 300 FROM mc;

CREATE FUNCTION pg_temp.mc_active() RETURNS public.med_tech_shifts LANGUAGE sql AS $$
  SELECT s.* FROM public.med_tech_shifts s WHERE s.user_id = (SELECT tech FROM mc) AND s.status = 'active' AND s.deleted_at IS NULL
$$;

-- 1. A forgotten clock-in added by a manager opens the shift; the added 'out' closes it.
INSERT INTO public.time_punch_corrections(organization_id,facility_id,staff_id,correction_type,punch_type,corrected_punched_at,reason,corrected_by)
  SELECT org, facility, tech_staff, 'add_punch', 'in', (today - 1 + time '06:55') AT TIME ZONE 'America/New_York', 'missed_punch', mgr FROM mc;
DO $$ DECLARE s public.med_tech_shifts := pg_temp.mc_active(); f mc; BEGIN
  SELECT * INTO f FROM mc;
  IF s.id IS NULL OR s.opened_from <> 'time_punch_corrections'
     OR s.shift_start <> (f.today - 1 + time '07:00') AT TIME ZONE 'America/New_York' THEN
    RAISE EXCEPTION 'COL-681: an added clock-in did not open the cockpit shift: %', row_to_json(s);
  END IF;
END $$;
INSERT INTO public.time_punch_corrections(organization_id,facility_id,staff_id,correction_type,punch_type,corrected_punched_at,reason,corrected_by)
  SELECT org, facility, tech_staff, 'add_punch', 'out', (today - 1 + time '19:05') AT TIME ZONE 'America/New_York', 'missed_punch', mgr FROM mc;
DO $$ BEGIN
  IF (pg_temp.mc_active()).id IS NOT NULL THEN RAISE EXCEPTION 'COL-681: an added clock-out did not close the cockpit shift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.med_tech_shifts WHERE user_id = (SELECT tech FROM mc) AND status = 'completed'
                 AND clocked_out_at = ((SELECT today FROM mc) - 1 + time '19:05') AT TIME ZONE 'America/New_York') THEN
    RAISE EXCEPTION 'COL-681: the closed shift does not carry the added clock-out time';
  END IF;
END $$;

-- 2. An added 'in' older than that 'out' is history, not a live shift.
INSERT INTO public.time_punch_corrections(organization_id,facility_id,staff_id,correction_type,punch_type,corrected_punched_at,reason,corrected_by)
  SELECT org, facility, tech_staff, 'add_punch', 'in', (today - 1 + time '12:00') AT TIME ZONE 'America/New_York', 'missed_punch', mgr FROM mc;
DO $$ BEGIN
  IF (pg_temp.mc_active()).id IS NOT NULL THEN RAISE EXCEPTION 'COL-681: an added clock-in older than an existing clock-out opened a shift'; END IF;
END $$;

-- 3. A live kiosk 'in' opens the shift; retiming that punch moves clocked_in_at;
--    voiding it closes the shift with a tape note.
INSERT INTO public.time_punches(organization_id,facility_id,staff_id,punch_type,punched_at,client_punch_id)
  SELECT org, facility, tech_staff, 'in', (today + time '07:20') AT TIME ZONE 'America/New_York', gen_random_uuid() FROM mc;
INSERT INTO public.time_punch_corrections(organization_id,facility_id,staff_id,correction_type,target_punch_id,corrected_punched_at,reason,corrected_by)
  SELECT org, facility, tech_staff, 'change_time', (SELECT opened_from_id FROM pg_temp.mc_active()), (today + time '06:58') AT TIME ZONE 'America/New_York', 'manager_verified_time', mgr FROM mc;
DO $$ BEGIN
  IF (pg_temp.mc_active()).clocked_in_at <> ((SELECT today FROM mc) + time '06:58') AT TIME ZONE 'America/New_York' THEN
    RAISE EXCEPTION 'COL-681: retiming the opening punch did not move clocked_in_at';
  END IF;
END $$;
INSERT INTO public.time_punch_corrections(organization_id,facility_id,staff_id,correction_type,target_punch_id,reason,corrected_by)
  SELECT org, facility, tech_staff, 'void_punch', (SELECT opened_from_id FROM pg_temp.mc_active()), 'duplicate', mgr FROM mc;
DO $$ BEGIN
  IF (pg_temp.mc_active()).id IS NOT NULL THEN RAISE EXCEPTION 'COL-681: voiding the opening clock-in left the cockpit shift open'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shift_tape_events e JOIN public.med_tech_shifts s ON s.id = e.shift_id
                 WHERE s.user_id = (SELECT tech FROM mc) AND e.event_type = 'clock_in_voided') THEN
    RAISE EXCEPTION 'COL-681: the voided shift is not marked on its tape';
  END IF;
END $$;

ROLLBACK;
