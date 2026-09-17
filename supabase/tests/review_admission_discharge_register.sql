-- COL-353: the register says what happened, and the census record keeps
-- physical presence apart from billable days.
-- Local disposable replay only: every fixture rolls back. Synthetic residents only.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
-- The vanilla replay stub omits the table grants the hosted project has.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt()->>'sub','')::uuid
$$;

CREATE TEMP TABLE reg AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac, gen_random_uuid() other_fac,
  gen_random_uuid() room, gen_random_uuid() bed,
  gen_random_uuid() res_a, gen_random_uuid() res_b, gen_random_uuid() res_dst,
  gen_random_uuid() clerk, gen_random_uuid() clerk_session,
  gen_random_uuid() outsider, gen_random_uuid() outsider_session;

INSERT INTO organizations(id,name) SELECT org,'Register review' FROM reg;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Register Entity' FROM reg;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Register Facility','1 Way','Town','00000',10 FROM reg
  UNION ALL SELECT other_fac,ent,org,'Other Facility','2 Way','Town','00000',10 FROM reg;
INSERT INTO rooms(id,facility_id,organization_id,room_number) SELECT room,fac,org,'101' FROM reg;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label) SELECT bed,room,fac,org,'A' FROM reg;

-- ---------------------------------------------------------------------------
-- Billable set: the helper must agree with the compatibility view for EVERY
-- status. The view is the authority; this is the tripwire if it ever changes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE s public.resident_status; r record; f record; mismatch int := 0;
BEGIN
  SELECT * INTO f FROM reg;
  FOR s IN SELECT unnest(enum_range(NULL::public.resident_status)) LOOP
    INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,gender,status)
      VALUES(gen_random_uuid(),f.fac,f.org,'Billable','Probe','prefer_not_to_say'::gender,s)
      RETURNING id INTO r;
    IF (SELECT is_billable FROM public.resident_billable_status WHERE resident_id=r.id)
       IS DISTINCT FROM haven.resident_status_is_billable(s) THEN
      mismatch := mismatch + 1;
      RAISE WARNING 'billable mismatch for status %', s;
    END IF;
    DELETE FROM public.resident_status_history WHERE resident_id=r.id;
    DELETE FROM residents WHERE id=r.id;
  END LOOP;
  IF mismatch > 0 THEN
    RAISE EXCEPTION 'haven.resident_status_is_billable disagrees with public.resident_billable_status on % status(es)', mismatch;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture: one resident who does everything, one who is discharged mid month.
-- History rows are written directly so the times are controlled; the capture
-- trigger writes now(), which cannot express a DST date or a range edge.
-- ---------------------------------------------------------------------------
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,gender,status,bed_id,admission_source,discharge_reason,discharge_destination)
  SELECT res_a,fac,org,'Test Resident','A','prefer_not_to_say'::gender,'active'::resident_status,bed,'Hospital referral','death'::discharge_reason,NULL FROM reg;
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,gender,status,admission_source,discharge_reason,discharge_destination)
  SELECT res_b,fac,org,'Test Resident','B','prefer_not_to_say'::gender,'discharged'::resident_status,'Home','home'::discharge_reason,'Daughter home' FROM reg;
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,gender,status)
  SELECT res_dst,fac,org,'Test Resident','DST','prefer_not_to_say'::gender,'active'::resident_status FROM reg;
DELETE FROM public.resident_status_history
 WHERE resident_id IN (SELECT res_a FROM reg UNION SELECT res_b FROM reg UNION SELECT res_dst FROM reg);

-- Resident A: admission, hospital out and return, leave out and return,
-- discharge, readmission, death. Every event type in one residency.
INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to,created_by)
SELECT org,fac,res_a,s.status,s.f,s.t,NULL FROM reg, (VALUES
  ('active'::resident_status,       timestamptz '2026-01-05 15:00Z', timestamptz '2026-02-01 15:00Z'),
  ('hospital_hold'::resident_status,timestamptz '2026-02-01 15:00Z', timestamptz '2026-02-10 15:00Z'),
  ('active'::resident_status,       timestamptz '2026-02-10 15:00Z', timestamptz '2026-03-01 15:00Z'),
  ('loa'::resident_status,          timestamptz '2026-03-01 15:00Z', timestamptz '2026-03-05 15:00Z'),
  ('active'::resident_status,       timestamptz '2026-03-05 15:00Z', timestamptz '2026-04-01 15:00Z'),
  ('discharged'::resident_status,   timestamptz '2026-04-01 15:00Z', timestamptz '2026-05-01 15:00Z'),
  ('active'::resident_status,       timestamptz '2026-05-01 15:00Z', timestamptz '2026-06-01 15:00Z'),
  ('deceased'::resident_status,     timestamptz '2026-06-01 15:00Z', NULL)
) s(status,f,t);

DO $$ DECLARE f record; got text[]; want text[]; BEGIN
  SELECT * INTO f FROM reg;
  SELECT array_agg(event_type ORDER BY event_at) INTO got
    FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-07-01Z',true)
   WHERE resident_id=f.res_a;
  want := ARRAY['admission','hospital_out','hospital_return','leave_out','leave_return','discharge','readmission','death'];
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'register misclassified the residency: got %, want %', got, want; END IF;
END $$;

-- include_holds = false hides exactly the four bed hold event types.
DO $$ DECLARE f record; got text[]; BEGIN
  SELECT * INTO f FROM reg;
  SELECT array_agg(event_type ORDER BY event_at) INTO got
    FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-07-01Z',false)
   WHERE resident_id=f.res_a;
  IF got IS DISTINCT FROM ARRAY['admission','discharge','readmission','death'] THEN
    RAISE EXCEPTION 'Show bed holds off did not hide the four hold event types: %', got; END IF;
END $$;

-- Admission source rides admission and readmission rows only. Discharge reason
-- and destination ride the most recent ending event only, because residents
-- holds one set of those columns and a readmission overwrote the old ones.
INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to,created_by)
SELECT org,fac,res_b,s.status,s.f,s.t,NULL FROM reg, (VALUES
  ('active'::resident_status,    timestamptz '2026-03-10 15:00Z', timestamptz '2026-03-20 15:00Z'),
  ('discharged'::resident_status,timestamptz '2026-03-20 15:00Z', NULL)
) s(status,f,t);
DO $$ DECLARE f record; r record; BEGIN
  SELECT * INTO f FROM reg;
  FOR r IN SELECT * FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-07-01Z',true) WHERE resident_id=f.res_a LOOP
    IF r.event_type NOT IN ('admission','readmission') AND r.admission_source IS NOT NULL THEN
      RAISE EXCEPTION 'admission source leaked onto a % row', r.event_type; END IF;
    IF r.event_type = 'discharge' AND r.discharge_reason IS NOT NULL THEN
      RAISE EXCEPTION 'a superseded discharge showed a reason that belongs to a later event'; END IF;
  END LOOP;
  SELECT * INTO r FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-07-01Z',true)
    WHERE resident_id=f.res_b AND event_type='discharge';
  IF r.discharge_reason IS DISTINCT FROM 'home'::discharge_reason OR r.discharge_destination IS DISTINCT FROM 'Daughter home' THEN
    RAISE EXCEPTION 'the current discharge lost its reason or destination'; END IF;
  IF r.room_as_of <> 'current' THEN RAISE EXCEPTION 'room_as_of must say the room is the current one'; END IF;
END $$;

-- A change on the DST fall-back date is one event on that date, not two or none.
INSERT INTO public.resident_status_history(organization_id,facility_id,resident_id,status,effective_from,effective_to,created_by)
SELECT org,fac,res_dst,s.status,s.f,s.t,NULL FROM reg, (VALUES
  ('active'::resident_status,       timestamptz '2026-10-01 15:00Z', timestamptz '2026-11-01 05:30Z'),
  ('hospital_hold'::resident_status,timestamptz '2026-11-01 05:30Z', NULL)
) s(status,f,t);
DO $$ DECLARE f record; n int; d date; BEGIN
  SELECT * INTO f FROM reg;
  SELECT count(*), min((event_at AT TIME ZONE 'America/New_York')::date) INTO n, d
    FROM public.admission_discharge_register(f.org,f.fac,'2026-10-01Z','2026-12-01Z',true)
   WHERE resident_id=f.res_dst AND event_type='hospital_out';
  IF n <> 1 THEN RAISE EXCEPTION 'DST boundary produced % hospital_out rows, want 1', n; END IF;
  IF d <> date '2026-11-01' THEN RAISE EXCEPTION 'DST event landed on % in Eastern, want 2026-11-01', d; END IF;
END $$;

-- Range edges are half open: an event exactly at p_from is in, exactly at p_to is out.
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM reg;
  SELECT count(*) INTO n FROM public.admission_discharge_register(f.org,f.fac,'2026-04-01 15:00Z','2026-05-01 15:00Z',true)
    WHERE resident_id=f.res_a;
  IF n <> 1 THEN RAISE EXCEPTION 'half open range returned % rows, want the discharge at p_from only', n; END IF;
  IF (SELECT event_type FROM public.admission_discharge_register(f.org,f.fac,'2026-04-01 15:00Z','2026-05-01 15:00Z',true)
       WHERE resident_id=f.res_a) <> 'discharge' THEN
    RAISE EXCEPTION 'the event at p_to was counted instead of the one at p_from'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Census record: presence and billable are different numbers.
-- ---------------------------------------------------------------------------
-- Resident A spent all of February 2026 on hospital hold apart from the 10th
-- onward: physically absent, still billable, which is the whole point of
-- printing the two columns side by side.
DO $$ DECLARE f record; r record; BEGIN
  SELECT * INTO f FROM reg;
  SELECT * INTO r FROM public.census_record_monthly(f.org,f.fac,'2026-02-01','2026-02-28')
    WHERE resident_id=f.res_a AND month=date '2026-02-01';
  IF r.billable_days <> 28 THEN
    RAISE EXCEPTION 'a held bed stopped being billable: % of 28 days', r.billable_days; END IF;
  IF r.physical_presence_days >= 28 THEN
    RAISE EXCEPTION 'hospital hold counted as physical presence: % days', r.physical_presence_days; END IF;
  -- Feb 1 (active until 10am ET) and Feb 10 (active from 10am ET) each count as
  -- a day present, because the resident was in the building during them.
  IF r.physical_presence_days <> 20 THEN
    RAISE EXCEPTION 'physical presence for February was % days, want 20', r.physical_presence_days; END IF;
END $$;

-- A resident on hospital hold for a whole month: present 0, billable every day.
-- December, not November: the hold began at 1:30am on November 1, so November 1
-- is correctly a day present and November is not a clean full-month case.
DO $$ DECLARE f record; r record; BEGIN
  SELECT * INTO f FROM reg;
  SELECT * INTO r FROM public.census_record_monthly(f.org,f.fac,'2026-12-01','2026-12-31')
    WHERE resident_id=f.res_dst AND month=date '2026-12-01';
  IF r.physical_presence_days <> 0 THEN
    RAISE EXCEPTION 'a resident away all month showed % presence days, want 0', r.physical_presence_days; END IF;
  IF r.billable_days <> 31 THEN
    RAISE EXCEPTION 'a held bed billed % days in December, want 31', r.billable_days; END IF;
END $$;

-- A mid month discharge counts days up to the discharge and no further.
DO $$ DECLARE f record; r record; BEGIN
  SELECT * INTO f FROM reg;
  SELECT * INTO r FROM public.census_record_monthly(f.org,f.fac,'2026-03-01','2026-03-31')
    WHERE resident_id=f.res_b AND month=date '2026-03-01';
  IF r.physical_presence_days <> 11 THEN
    RAISE EXCEPTION 'a resident admitted the 10th and discharged the 20th showed % presence days, want 11', r.physical_presence_days; END IF;
  IF r.billable_days <> 11 THEN
    RAISE EXCEPTION 'discharged days were billed: % billable days, want 11', r.billable_days; END IF;
END $$;

-- A resident whose residency ended long before the range must not appear in the
-- census with two zeroes beside their name. Their final `discharged` interval
-- stays open forever, so without a guard they join every month.
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM reg;
  SELECT count(*) INTO n FROM public.census_record_monthly(f.org,f.fac,'2026-07-01','2026-09-30')
    WHERE resident_id = f.res_b;
  IF n <> 0 THEN
    RAISE EXCEPTION 'a resident discharged in April appears in % month(s) after it', n; END IF;
  -- And nobody at all is listed with nothing to show.
  SELECT count(*) INTO n FROM public.census_record_monthly(f.org,f.fac,'2026-01-01','2026-12-31')
    WHERE physical_presence_days = 0 AND billable_days = 0;
  IF n <> 0 THEN RAISE EXCEPTION '% census rows carry two zeroes', n; END IF;
END $$;

-- Admission source belongs to the admission it describes. residents holds one,
-- so only the most recent admission or readmission may print it.
DO $$ DECLARE f record; r record; seen int := 0; BEGIN
  SELECT * INTO f FROM reg;
  FOR r IN SELECT * FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-07-01Z',true)
    WHERE resident_id = f.res_a AND event_type IN ('admission','readmission') LOOP
    IF r.admission_source IS NOT NULL THEN seen := seen + 1; END IF;
  END LOOP;
  IF seen <> 1 THEN
    RAISE EXCEPTION 'admission source printed on % admission rows; a later readmission overwrote the earlier one', seen; END IF;
  -- It is the most recent one that carries it.
  SELECT * INTO r FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-07-01Z',true)
    WHERE resident_id = f.res_a AND event_type = 'readmission';
  IF r.admission_source IS DISTINCT FROM 'Hospital referral' THEN
    RAISE EXCEPTION 'the current admission lost its source'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- A reader without the facility grant gets nothing. security invoker means the
-- resident policy decides, so this is zero rows and not an error.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT outsider,outsider||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),jsonb_build_object('full_name','Register outsider') FROM reg;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
SELECT outsider,outsider||'@review.invalid','Register outsider','nurse'::public.app_role,org,true FROM reg
ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
-- Granted the OTHER facility only.
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT outsider,other_fac,org FROM reg;
INSERT INTO auth.sessions(id,user_id) SELECT outsider_session,outsider FROM reg;
GRANT SELECT ON reg TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_discharge_register(uuid,uuid,timestamptz,timestamptz,boolean) TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',f.outsider,'session_id',f.outsider_session,
  'iat',extract(epoch FROM clock_timestamp())::bigint,'auth_claim_version',p.auth_claim_version,
  'role','authenticated','app_role','nurse','organization_id',f.org,
  'app_metadata',jsonb_build_object('app_role','nurse','organization_id',f.org))::text,true)
FROM reg f JOIN public.user_profiles p ON p.id=f.outsider;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; n int; BEGIN
  SELECT * INTO f FROM reg;
  SELECT count(*) INTO n FROM public.admission_discharge_register(f.org,f.fac,'2026-01-01Z','2026-12-01Z',true);
  IF n <> 0 THEN RAISE EXCEPTION 'a user without the facility grant read % register rows', n; END IF;
END $$;
RESET ROLE;

ROLLBACK;
