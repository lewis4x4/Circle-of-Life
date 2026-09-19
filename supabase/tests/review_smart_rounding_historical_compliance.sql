-- Compliance honesty acceptance. The three routes by which a resident day used
-- to vanish from the compliance record, each asserted to read as a defect now.
--
-- Run it against any database that has every migration applied:
--
--   node scripts/smart-rounding/run-compliance-honesty-acceptance.mjs
--
-- or directly, against a replay you already have:
--
--   psql -d <replay> -v ON_ERROR_STOP=1 -f scripts/smart-rounding/compliance-honesty-acceptance.sql
--
-- Everything happens inside one transaction that rolls back, so the script is
-- safe to re-run and leaves nothing behind. All fixture data is synthetic: no
-- resident, no staff member and no facility here corresponds to a real one.
--
-- The defect this file exists to keep fixed. Migration 417 derived the set of
-- resident days from task rows and Monitoring Order days. A resident day with
-- neither produced no rows at all, so expected was zero, satisfied was zero,
-- and a dashboard read zero over zero as a hundred percent or as no data. Three
-- routes reach that state:
--
--   (a) the generator never ran, or errored for that facility
--   (b) no cadence version is in force for the date, which used to drop the
--       resident day entirely because the projection was a CROSS JOIN LATERAL
--   (c) a facility created after migrations 412 and 415 inherits no shift
--       model, no cadence and no escalation ladder, and reads as a quiet
--       building
--
-- public.observation_compliance_for_range answers all three with expected
-- greater than zero and unsatisfied. Silence is the one answer it may not give.

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE FUNCTION pg_temp.ch_assert (ok boolean, msg text)
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'compliance-honesty-acceptance FAILED: %', msg;
  END IF;
END
$$;

CREATE TEMP TABLE ch_result (
  seq serial,
  check_name text,
  detail text
);

-- ---------------------------------------------------------------------------
-- 1. Fixture. One synthetic organization, one configured building, three
--    residents in three different states.
--
--    The cadence at the configured building is a copy of the seeded version,
--    windows and grace values included, so this file never restates a time. Its
--    effective_from is deliberately recent, which is what creates the window of
--    earlier dates route (b) is about.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000001';
  v_entity CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000002';
  v_facility CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000003';
  v_resident CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000004';
  v_hospital CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000005';
  v_prospect CONSTANT uuid := 'c0de0000-0000-4000-8000-000000000006';
  v_cadence CONSTANT uuid := 'c0de0000-0000-4000-8000-00000000000b';
  v_escalation CONSTANT uuid := 'c0de0000-0000-4000-8000-00000000000c';
  v_source_cadence uuid;
  v_source_escalation uuid;
  v_source_facility uuid;
BEGIN
  INSERT INTO public.organizations (id, name)
    VALUES (v_org, 'Synthetic Compliance Honesty Organization');
  INSERT INTO public.entities (id, organization_id, name)
    VALUES (v_entity, v_org, 'Synthetic Compliance Honesty Entity');
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, zip, total_licensed_beds, timezone)
    VALUES (v_facility, v_entity, v_org, 'Synthetic Configured Building', '1 Synthetic Way', 'Synthetic City', '00000', 20, 'America/New_York');

  INSERT INTO public.residents (id, facility_id, organization_id, first_name, last_name, status, gender, admission_date)
    VALUES (v_resident, v_facility, v_org, 'Occupant', 'Synthetic', 'active', 'prefer_not_to_say', (now() - interval '20 days')::date),
    (v_hospital, v_facility, v_org, 'Away', 'Synthetic', 'hospital_hold', 'prefer_not_to_say', (now() - interval '20 days')::date),
    -- An inquiry is not in the building and must never appear as an expectation.
    (v_prospect, v_facility, v_org, 'Enquiring', 'Synthetic', 'inquiry', 'prefer_not_to_say', NULL);

  SELECT
    v.id,
    v.facility_id INTO v_source_cadence,
    v_source_facility
  FROM
    public.facility_cadence_versions v
  WHERE
    v.status = 'active'
    AND v.deleted_at IS NULL
  ORDER BY
    v.created_at
  LIMIT 1;
  PERFORM
    pg_temp.ch_assert (v_source_cadence IS NOT NULL, 'the seeded cadence version from migration 417 is missing');

  SELECT
    v.id INTO v_source_escalation
  FROM
    public.facility_escalation_versions v
  WHERE
    v.facility_id = v_source_facility
    AND v.status = 'active'
    AND v.deleted_at IS NULL
  LIMIT 1;
  PERFORM
    pg_temp.ch_assert (v_source_escalation IS NOT NULL, 'the seeded escalation version from migration 420 is missing');

  INSERT INTO public.facility_shift_definitions (organization_id, facility_id, shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order)
  SELECT
    v_org,
    v_facility,
    s.shift_key,
    s.roster_shift_type,
    s.label,
    s.starts_at_local,
    s.ends_at_local,
    s.sort_order
  FROM
    public.facility_shift_definitions s
  WHERE
    s.facility_id = v_source_facility
    AND s.deleted_at IS NULL;

  -- Ten days of residency, five days of cadence. The five days in between are
  -- route (b).
  INSERT INTO public.facility_cadence_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_cadence, v_org, v_facility, 1, 'active', date_trunc('day', now() - interval '5 days'), 'Synthetic acceptance fixture');

  INSERT INTO public.facility_cadence_windows (organization_id, facility_id, cadence_version_id, window_key, label, due_at_local, grace_before_minutes, grace_after_minutes, shift_key, sort_order, enabled)
  SELECT
    v_org,
    v_facility,
    v_cadence,
    w.window_key,
    w.label,
    w.due_at_local,
    w.grace_before_minutes,
    w.grace_after_minutes,
    w.shift_key,
    w.sort_order,
    w.enabled
  FROM
    public.facility_cadence_windows w
  WHERE
    w.cadence_version_id = v_source_cadence;

  INSERT INTO public.facility_escalation_versions (id, organization_id, facility_id, version_number, status, effective_from, change_reason)
    VALUES (v_escalation, v_org, v_facility, 1, 'active', date_trunc('day', now() - interval '5 days'), 'Synthetic acceptance fixture');

  INSERT INTO public.facility_escalation_rungs (organization_id, facility_id, escalation_version_id, rung_key, label, offset_minutes, is_terminal, assigned_staff_only, include_assigned_staff, use_standing_alert_routes, target_staff_roles, channels, protocol_text, sort_order, enabled)
  SELECT
    v_org,
    v_facility,
    v_escalation,
    r.rung_key,
    r.label,
    r.offset_minutes,
    r.is_terminal,
    r.assigned_staff_only,
    r.include_assigned_staff,
    r.use_standing_alert_routes,
    r.target_staff_roles,
    r.channels,
    r.protocol_text,
    r.sort_order,
    r.enabled
  FROM
    public.facility_escalation_rungs r
  WHERE
    r.escalation_version_id = v_source_escalation;

  INSERT INTO public.facility_escalation_rung_shift_overrides (organization_id, facility_id, escalation_version_id, escalation_rung_id, shift_key, offset_minutes, channels)
  SELECT
    v_org,
    v_facility,
    v_escalation,
    mine.id,
    src.shift_key,
    src.offset_minutes,
    src.channels
  FROM
    public.facility_escalation_rung_shift_overrides src
    JOIN public.facility_escalation_rungs donor ON donor.id = src.escalation_rung_id
    JOIN public.facility_escalation_rungs mine ON mine.escalation_version_id = v_escalation
      AND mine.rung_key = donor.rung_key
  WHERE
    src.escalation_version_id = v_source_escalation;

  -- The resident who was in hospital for two of the ten days. The status
  -- history trigger wrote an active span when the row was inserted; close it
  -- and open a hospital_hold span so the fixture has a real absence to subtract.
  UPDATE
    public.resident_status_history
  SET
    effective_to = now() - interval '9 days'
  WHERE
    resident_id = v_hospital
    AND effective_to IS NULL;

  INSERT INTO public.resident_status_history (organization_id, facility_id, resident_id, status, effective_from, effective_to)
    VALUES (v_org, v_facility, v_hospital, 'hospital_hold', now() - interval '9 days', now() - interval '7 days'),
    (v_org, v_facility, v_hospital, 'active', now() - interval '7 days', NULL);

  INSERT INTO ch_result (check_name, detail)
  SELECT
    'fixture',
    format('%s windows and %s rungs copied from the seeded versions; residency starts %s, cadence takes effect %s', (
        SELECT
          count(*)
        FROM public.facility_cadence_windows
        WHERE
          cadence_version_id = v_cadence), (
        SELECT
          count(*)
        FROM public.facility_escalation_rungs
        WHERE
          escalation_version_id = v_escalation), (now() - interval '20 days')::date, (now() - interval '5 days')::date);
END
$$;

-- This synthetic fixture describes configuration already in force before today.
UPDATE public.facility_observation_shift_history SET effective_from='-infinity'::timestamptz
WHERE created_at=transaction_timestamp() AND effective_to IS NULL;


-- ---------------------------------------------------------------------------
-- New admissions start at local midnight, not session UTC midnight.
DO $$
DECLARE org uuid := 'c0de0000-0000-4000-8000-000000000001'; fac uuid := 'c0de0000-0000-4000-8000-000000000003'; resident uuid := gen_random_uuid(); day date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
 INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,status,gender,admission_date)
 VALUES(resident,org,fac,'Admission midnight','Synthetic','active','prefer_not_to_say',day);
 PERFORM pg_temp.ch_assert((SELECT effective_from FROM public.resident_status_history WHERE resident_id=resident)=(day::timestamp AT TIME ZONE 'America/New_York'),'admission history used session midnight');
 PERFORM pg_temp.ch_assert(NOT EXISTS(SELECT 1 FROM public.observation_compliance_for_range(fac,day-1,day-1) WHERE resident_id=resident),'admission created previous local-day expectations');
END $$;

-- New/unreferenced shifts retain exact creation and rename boundaries.
DO $$
DECLARE org uuid := 'c0de0000-0000-4000-8000-000000000001'; fac uuid := 'c0de0000-0000-4000-8000-000000000003'; shift uuid;
BEGIN
 INSERT INTO public.facility_shift_definitions(organization_id,facility_id,shift_key,roster_shift_type,label,starts_at_local,ends_at_local,sort_order)
 VALUES(org,fac,'review_new_shift','day','Synthetic new shift','01:00','02:00',99) RETURNING id INTO shift;
 PERFORM pg_temp.ch_assert(NOT EXISTS(SELECT 1 FROM public.facility_observation_shift_history WHERE facility_id=fac AND shift_key='review_new_shift' AND effective_from<now()),'new shift invented historical workability');
 UPDATE public.facility_shift_definitions SET shift_key='review_renamed_shift',active=false WHERE id=shift;
 PERFORM pg_temp.ch_assert(EXISTS(SELECT 1 FROM public.facility_observation_shift_history WHERE facility_id=fac AND shift_key='review_new_shift' AND effective_to=now()),'rename erased old shift identity');
 PERFORM pg_temp.ch_assert(EXISTS(SELECT 1 FROM public.facility_observation_shift_history WHERE facility_id=fac AND shift_key='review_renamed_shift' AND effective_to IS NULL AND NOT enabled),'combined rename and disable ignored disabled state');
END $$;

-- Facility-only transfers must not relocate past resident days.
DO $$
DECLARE
  org uuid := 'c0de0000-0000-4000-8000-000000000001';
  fac uuid := 'c0de0000-0000-4000-8000-000000000003';
  resident uuid := 'c0de0000-0000-4000-8000-000000000004';
  destination uuid := gen_random_uuid();
  day date := (now() AT TIME ZONE 'America/New_York')::date-2;
  before_count integer; after_count integer; destination_count integer;
BEGIN
  SELECT count(*) INTO before_count FROM public.observation_compliance_for_range(fac,day,day) c WHERE c.resident_id=resident;
  PERFORM pg_temp.ch_assert(before_count>0,'transfer fixture has real historical expectations');
  INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds,timezone)
  VALUES(destination,'c0de0000-0000-4000-8000-000000000002',org,'Destination fixture','1 Test','Test','00000',20,'America/New_York');
  PERFORM set_config('rounding_test.transferred',resident::text,true);
  PERFORM set_config('rounding_test.destination',destination::text,true);
  PERFORM set_config('rounding_test.historical_count',before_count::text,true);
  UPDATE public.residents SET facility_id=destination WHERE id=resident;
  SELECT count(*) INTO after_count FROM public.observation_compliance_for_range(fac,day,day) c WHERE c.resident_id=resident;
  SELECT count(*) INTO destination_count FROM public.observation_compliance_for_range(destination,day,day) c WHERE c.resident_id=resident;
  PERFORM pg_temp.ch_assert(after_count=before_count,format('transfer rewrote old facility expectations: %s -> %s',before_count,after_count));
  PERFORM pg_temp.ch_assert(destination_count=0,'transfer invented historical occupancy at destination');
  PERFORM pg_temp.ch_assert(EXISTS(SELECT 1 FROM public.resident_status_history WHERE resident_id=resident AND facility_id=destination AND effective_to IS NULL),'facility-only transfer was not captured');
END $$;

-- A noon change must use both versions, and preserve on-time afternoon work.
DO $$
DECLARE
  org uuid := 'c0de0000-0000-4000-8000-000000000001';
  fac uuid := 'c0de0000-0000-4000-8000-000000000003';
  old_version uuid := 'c0de0000-0000-4000-8000-00000000000b';
  new_version uuid := gen_random_uuid(); resident uuid := gen_random_uuid(); worker uuid := gen_random_uuid(); task uuid;
  day date := (now() AT TIME ZONE 'America/New_York')::date-2;
  noon timestamptz; w record; row_count integer; satisfied_count integer; versions integer;
BEGIN
  noon := (day+time '12:00') AT TIME ZONE 'America/New_York';
  INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,status,gender,admission_date)
    VALUES(resident,org,fac,'Changeover','Synthetic','active','prefer_not_to_say',day-20);
  INSERT INTO public.staff(id,organization_id,facility_id,first_name,last_name,staff_role,hire_date,employment_status)
    VALUES(worker,org,fac,'Observer','Synthetic','resident_aide',day-20,'active');
  UPDATE public.facility_cadence_versions SET status='superseded',effective_to=noon WHERE id=old_version;
  INSERT INTO public.facility_cadence_versions(id,organization_id,facility_id,version_number,status,effective_from,change_reason)
    VALUES(new_version,org,fac,2,'active',noon,'Synthetic midday change');
  INSERT INTO public.facility_cadence_windows(organization_id,facility_id,cadence_version_id,window_key,label,due_at_local,grace_before_minutes,grace_after_minutes,shift_key,sort_order,enabled)
    SELECT org,fac,new_version,window_key,label,(due_at_local+interval '20 minutes')::time,grace_before_minutes,grace_after_minutes,shift_key,sort_order,enabled
    FROM public.facility_cadence_windows WHERE cadence_version_id=old_version;
  FOR w IN SELECT * FROM public.facility_observation_windows_for_date(fac,day) LOOP
    INSERT INTO public.resident_observation_tasks(organization_id,facility_id,resident_id,cadence_version_id,window_key,service_date,scheduled_for,due_at,grace_ends_at,status)
      VALUES(org,fac,resident,w.cadence_version_id,w.window_key,day,w.window_opens_at_utc,w.due_at_utc,w.window_closes_at_utc,'completed_on_time') RETURNING id INTO task;
    INSERT INTO public.resident_observation_logs(organization_id,facility_id,resident_id,task_id,staff_id,observed_at,entered_at,entry_mode,quick_status,composed_summary)
      VALUES(org,fac,resident,task,worker,w.window_closes_at_utc,w.window_closes_at_utc,'live','calm','Synthetic check');
  END LOOP;
  SELECT count(*),count(*) FILTER(WHERE satisfied),count(DISTINCT cadence_version_id)
    INTO row_count,satisfied_count,versions FROM public.observation_compliance_for_range(fac,day,day) c WHERE c.resident_id=resident;
  PERFORM pg_temp.ch_assert(versions=2,'midday projection did not use both effective versions');
  PERFORM pg_temp.ch_assert(row_count=satisfied_count AND row_count>0,'on-time changeover checks became missed');
  PERFORM pg_temp.ch_assert((haven.replay_observation_windows(fac,day,day,NULL,NULL)->>'would_be_satisfied')::integer=satisfied_count,'simulation disagrees with compliance on an observation exactly at window close');
  -- Deliberately corrupt one stamp: the comparison must detect real drift.
  UPDATE public.resident_observation_tasks SET cadence_version_id=old_version WHERE id=task;
  PERFORM pg_temp.ch_assert(EXISTS(SELECT 1 FROM public.observation_compliance_for_range(fac,day,day) c WHERE c.resident_id=resident AND c.cadence_version_matches_projection IS FALSE),'mismatch flag compared the stamp with itself');
END $$;

-- Transfers divide the actual day by occurrence, even with no task rows.
DO $$
DECLARE org uuid := 'c0de0000-0000-4000-8000-000000000001'; fac uuid := 'c0de0000-0000-4000-8000-000000000003';
 destination uuid := current_setting('rounding_test.destination')::uuid; resident uuid := gen_random_uuid();
 day date := (now() AT TIME ZONE 'America/New_York')::date-1; boundary timestamptz; expected integer; actual integer;
BEGIN
 boundary := (day+time '12:00') AT TIME ZONE 'America/New_York';
 INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,status,gender,admission_date)
 VALUES(resident,org,fac,'Transfer day','Synthetic','active','prefer_not_to_say',day-20);
 UPDATE public.residents SET facility_id=destination WHERE id=resident;
 UPDATE public.resident_status_history SET effective_to=boundary WHERE resident_id=resident AND effective_to IS NOT NULL;
 UPDATE public.resident_status_history SET effective_from=boundary WHERE resident_id=resident AND effective_to IS NULL;
 UPDATE public.facility_cadence_versions SET effective_from=boundary-interval '2 days' WHERE facility_id=destination AND status='active';
 SELECT count(*) INTO expected FROM public.facility_observation_windows_for_date(fac,day) WHERE due_at_utc<boundary;
 SELECT count(*) INTO actual FROM public.observation_compliance_for_range(fac,day,day) WHERE resident_id=resident;
 PERFORM pg_temp.ch_assert(expected>0 AND actual=expected,'source facility expected windows after transfer');
 SELECT count(*) INTO expected FROM public.facility_observation_windows_for_date(destination,day) WHERE due_at_utc>=boundary;
 SELECT count(*) INTO actual FROM public.observation_compliance_for_range(destination,day,day) WHERE resident_id=resident;
 PERFORM pg_temp.ch_assert(expected>0 AND actual=expected,'destination expected windows before transfer');
 PERFORM set_config('rounding_test.transfer_day_resident',resident::text,true);
 PERFORM set_config('rounding_test.destination_day_count',expected::text,true);
END $$;

-- The current shift must be regenerated after a configuration activation.
DO $$
DECLARE fac uuid := 'c0de0000-0000-4000-8000-000000000003'; w record; expected integer; actual integer;
BEGIN
  SELECT * INTO w FROM public.facility_observation_windows_for_date(fac,(now() AT TIME ZONE 'America/New_York')::date) ORDER BY due_at_utc LIMIT 1;
  SELECT count(*) INTO actual FROM public.facility_current_and_next_shift_observation_windows(fac,w.due_at_utc) c WHERE c.window_key=w.window_key AND c.due_at_utc=w.due_at_utc;
  PERFORM pg_temp.ch_assert(actual=1,'current shift open window absent from generator projection');
  SELECT count(*) INTO actual FROM public.facility_current_and_next_shift_observation_windows(fac,w.window_closes_at_utc+interval '1 second') c WHERE c.window_key=w.window_key AND c.due_at_utc=w.due_at_utc;
  PERFORM pg_temp.ch_assert(actual=0,'generator would recreate already closed current-shift window');
END $$;

-- Unassigned reminders cannot monopolize a bounded queue before real escalations.
DO $$
DECLARE org uuid := 'c0de0000-0000-4000-8000-000000000001'; fac uuid := 'c0de0000-0000-4000-8000-000000000003';
 resident uuid := gen_random_uuid(); w record; task uuid; selected_reminder boolean;
BEGIN
 INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,status,gender,admission_date)
 VALUES(resident,org,fac,'Queue','Synthetic','active','prefer_not_to_say',current_date-20);
 SELECT * INTO w FROM public.facility_observation_windows_for_date(fac,(now() AT TIME ZONE 'America/New_York')::date-1) ORDER BY due_at_utc LIMIT 1;
 INSERT INTO public.resident_observation_tasks(organization_id,facility_id,resident_id,cadence_version_id,window_key,service_date,scheduled_for,due_at,grace_ends_at,status)
 VALUES(org,fac,resident,w.cadence_version_id,w.window_key,(w.due_at_utc AT TIME ZONE 'America/New_York')::date,w.window_opens_at_utc,w.due_at_utc,w.window_closes_at_utc,'upcoming') RETURNING id INTO task;
 SELECT assigned_staff_only INTO selected_reminder FROM public.observation_escalations_due(org,fac,now(),1) WHERE task_id=task;
 PERFORM pg_temp.ch_assert(selected_reminder IS FALSE,'unassigned nudge took the limited queue slot ahead of actionable escalation');
END $$;

-- Disabled shifts are configuration gaps, not a resident documentation signal.
DO $$
DECLARE org uuid := 'c0de0000-0000-4000-8000-000000000001'; fac uuid := 'c0de0000-0000-4000-8000-000000000003'; resident uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,status,gender,admission_date)
 VALUES(resident,org,fac,'No shifts','Synthetic','active','prefer_not_to_say',current_date-20);
 INSERT INTO public.watchlist_signal_rules(organization_id,facility_id,signal_key,label,description,severity_class,severity_weight,threshold_count,lookback_days,source_kind) VALUES(org,fac,'observation_gap','Gap','Synthetic test','informational',15,2,3,'data_quality');
 UPDATE public.facility_shift_definitions SET active=false WHERE facility_id=fac;
 PERFORM pg_temp.ch_assert(NOT EXISTS(SELECT 1 FROM public.observation_compliance_for_range(fac,current_date-2,current_date-2) WHERE resident_id=resident AND expectation_source='orphaned_shift'),'deactivating today rewrote past shift workability');
 -- A separate historical configuration-gap fixture: shift was already disabled before these windows.
 UPDATE public.facility_observation_shift_history SET effective_to=now()-interval '4 days' WHERE facility_id=fac AND effective_to IS NOT NULL AND shift_key IN(SELECT shift_key FROM public.facility_cadence_windows WHERE facility_id=fac);
 UPDATE public.facility_observation_shift_history SET effective_from=now()-interval '4 days' WHERE facility_id=fac AND effective_to IS NULL AND shift_key IN(SELECT shift_key FROM public.facility_cadence_windows WHERE facility_id=fac);
 PERFORM public.evaluate_watchlist_signals(fac,now());
 PERFORM pg_temp.ch_assert(NOT EXISTS(SELECT 1 FROM public.watchlist_signal_instances WHERE resident_id=resident AND signal_key='observation_gap' AND deleted_at IS NULL),'disabled shifts generated a missed-observation signal');
END $$;

-- Exercise the SECURITY DEFINER boundary as a real authenticated actor.
DO $$
DECLARE actor uuid := gen_random_uuid(); session uuid := gen_random_uuid(); version integer; foreign_version uuid;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) VALUES(actor,'rounding-review@haven.test','authenticated','authenticated',now(),now());
 INSERT INTO auth.sessions(id,user_id) VALUES(session,actor);
 INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 VALUES(actor,'c0de0000-0000-4000-8000-000000000001','rounding-review@haven.test','Synthetic Reviewer','facility_admin',true);
 INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,is_primary)
 VALUES(actor,'c0de0000-0000-4000-8000-000000000003','c0de0000-0000-4000-8000-000000000001',true);
 SELECT auth_claim_version INTO version FROM public.user_profiles WHERE id=actor;
 SELECT id INTO foreign_version FROM public.facility_escalation_versions WHERE organization_id<>'c0de0000-0000-4000-8000-000000000001' AND deleted_at IS NULL LIMIT 1;
 PERFORM pg_temp.ch_assert(foreign_version IS NOT NULL,'foreign escalation fixture missing');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',session,'auth_claim_version',version::text)::text,true);
 PERFORM set_config('rounding_test.foreign_version',foreign_version::text,true);
END $$;
-- Mirror hosted Supabase default read grants; RLS remains enforced.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 PERFORM pg_temp.ch_assert(NOT EXISTS(SELECT 1 FROM public.residents WHERE id=current_setting('rounding_test.transferred')::uuid),'source-only reader can unexpectedly see transferred resident');
 PERFORM pg_temp.ch_assert((SELECT count(*) FROM public.observation_compliance_for_range('c0de0000-0000-4000-8000-000000000003',(now() AT TIME ZONE 'America/New_York')::date-2,(now() AT TIME ZONE 'America/New_York')::date-2) WHERE resident_id=current_setting('rounding_test.transferred')::uuid)=current_setting('rounding_test.historical_count')::integer,'RLS hid historical taskless residency after transfer');
 PERFORM pg_temp.ch_assert(haven.can_read_observation_config('c0de0000-0000-4000-8000-000000000003') IS TRUE,'review actor must be authorized for requested facility');
 BEGIN
   PERFORM public.simulate_cadence_change('c0de0000-0000-4000-8000-000000000003',NULL,current_setting('rounding_test.foreign_version')::uuid,1);
   RAISE EXCEPTION 'foreign escalation version was accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
-- Switch the same authenticated facility administrator to destination-only
-- access; the source interval must be hidden without inventing morning checks.
UPDATE public.user_facility_access SET facility_id=current_setting('rounding_test.destination')::uuid
WHERE user_id=(current_setting('request.jwt.claims')::jsonb->>'sub')::uuid;
SELECT set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{auth_claim_version}',to_jsonb((SELECT auth_claim_version::text FROM public.user_profiles WHERE id=(current_setting('request.jwt.claims')::jsonb->>'sub')::uuid)))::text,true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 PERFORM pg_temp.ch_assert(NOT EXISTS(SELECT 1 FROM public.resident_status_history WHERE resident_id=current_setting('rounding_test.transfer_day_resident')::uuid AND facility_id='c0de0000-0000-4000-8000-000000000003'),'destination reader must not see source history');
 PERFORM pg_temp.ch_assert((SELECT count(*) FROM public.observation_compliance_for_range(current_setting('rounding_test.destination')::uuid,(now() AT TIME ZONE 'America/New_York')::date-1,(now() AT TIME ZONE 'America/New_York')::date-1) WHERE resident_id=current_setting('rounding_test.transfer_day_resident')::uuid)=current_setting('rounding_test.destination_day_count')::integer,'destination-only RLS invented morning checks');
 PERFORM pg_temp.ch_assert(haven.observation_history_starts_after(current_setting('rounding_test.transfer_day_resident')::uuid,'c0de0000-0000-4000-8000-000000000003',now()) IS FALSE,'history helper disclosed inaccessible facility facts');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
 PERFORM pg_temp.ch_assert(haven.can_read_observation_config('c0de0000-0000-4000-8000-000000000003') IS FALSE,'missing actor must be false, not nullable authority');
 BEGIN
  PERFORM public.simulate_cadence_change('c0de0000-0000-4000-8000-000000000003','c0de0000-0000-4000-8000-00000000000b',NULL,1);
  RAISE EXCEPTION 'missing actor bypassed configuration authority';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
