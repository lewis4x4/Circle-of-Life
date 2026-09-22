-- COL-569 / COL-593: monthly census confirmation on Home is scoped by the database.
--
-- Proves, with real sessions and RLS on:
--   * the row is due only on the first business day of the month — never on a
--     weekend 1st, never on the second business day;
--   * an operator at building B cannot read or write building A, a caregiver
--     cannot read it at all, and the executive (org_admin) cannot attest;
--   * "Something wrong" needs a note and keeps the month open;
--   * "Confirm" stamps the actor and the Facility Executive it notifies, closes
--     the month once, and the browser cannot insert rows directly;
--   * only the named Facility Executive reads the notices.
--
-- Rollback-only fixture. Mirrors review_home_on_tap.sql.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role','') $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-569 %',msg; END IF; END $$;

CREATE TEMP TABLE fx AS
SELECT gen_random_uuid() admin_a, gen_random_uuid() admin_a_session,
       gen_random_uuid() admin_b, gen_random_uuid() admin_b_session,
       gen_random_uuid() exec,    gen_random_uuid() exec_session,
       gen_random_uuid() aide,    gen_random_uuid() aide_session,
       a.organization_id organization, a.id facility_a, b.id facility_b,
       '2026-10-01T14:00:00Z'::timestamptz oct_first,      -- Thursday, first business day
       '2026-11-01T14:00:00Z'::timestamptz nov_sunday,     -- Sunday the 1st
       '2026-11-02T14:00:00Z'::timestamptz nov_monday,     -- first business day
       '2026-11-03T14:00:00Z'::timestamptz nov_tuesday,    -- second business day
       -- The write path closes months against the real clock, so the write
       -- probes use last month and read it back on this month's first business day.
       (date_trunc('month',(now() AT TIME ZONE 'America/New_York')::timestamp) - interval '1 month')::date prior_month,
       (haven.first_business_day((now() AT TIME ZONE 'America/New_York')::date)::timestamp + interval '15 hours')::timestamptz this_first_bd
FROM public.facilities a
JOIN public.facilities b ON b.organization_id=a.organization_id AND b.id<>a.id AND b.deleted_at IS NULL
WHERE a.deleted_at IS NULL ORDER BY a.id, b.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM fx) THEN RAISE EXCEPTION 'Two seeded facilities required'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT admin_a,admin_a||'@census.invalid','{}'::jsonb,'{}'::jsonb FROM fx
UNION ALL SELECT admin_b,admin_b||'@census.invalid','{}'::jsonb,'{}'::jsonb FROM fx
UNION ALL SELECT exec,exec||'@census.invalid','{}'::jsonb,'{}'::jsonb FROM fx
UNION ALL SELECT aide,aide||'@census.invalid','{}'::jsonb,'{}'::jsonb FROM fx;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active,job_title)
SELECT admin_a,organization,admin_a||'@census.invalid','Ada Operator','facility_admin'::public.app_role,true,'Administrator' FROM fx
UNION ALL SELECT admin_b,organization,admin_b||'@census.invalid','Bea Operator','manager'::public.app_role,true,'Manager' FROM fx
UNION ALL SELECT exec,organization,exec||'@census.invalid','Eve Executive','org_admin'::public.app_role,true,'COO' FROM fx
UNION ALL SELECT aide,organization,aide||'@census.invalid','Cal Aide','caregiver'::public.app_role,true,NULL FROM fx;
INSERT INTO auth.sessions(id,user_id)
SELECT admin_a_session,admin_a FROM fx UNION ALL SELECT admin_b_session,admin_b FROM fx
UNION ALL SELECT exec_session,exec FROM fx UNION ALL SELECT aide_session,aide FROM fx;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,is_primary)
SELECT admin_a,facility_a,organization,true FROM fx
UNION ALL SELECT admin_b,facility_b,organization,true FROM fx
UNION ALL SELECT exec,facility_a,organization,true FROM fx
UNION ALL SELECT exec,facility_b,organization,false FROM fx
UNION ALL SELECT aide,facility_a,organization,true FROM fx;
INSERT INTO public.facility_executives(facility_id,organization_id,user_id)
SELECT facility_a,organization,exec FROM fx ON CONFLICT (facility_id) DO UPDATE SET user_id=EXCLUDED.user_id;
GRANT SELECT ON fx TO authenticated,service_role;

CREATE FUNCTION pg_temp.claims(p_user uuid,p_session uuid,p_role text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=p_user),'app_role',p_role)::text,true)::void
$$;
CREATE FUNCTION pg_temp.as_admin_a() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(admin_a,admin_a_session,'facility_admin') FROM fx $$;
CREATE FUNCTION pg_temp.as_admin_b() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(admin_b,admin_b_session,'manager') FROM fx $$;
CREATE FUNCTION pg_temp.as_exec() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(exec,exec_session,'org_admin') FROM fx $$;
CREATE FUNCTION pg_temp.as_aide() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(aide,aide_session,'caregiver') FROM fx $$;

-- 0. The calendar helper, independent of any session.
DO $$ BEGIN
 PERFORM pg_temp.c_assert(haven.first_business_day('2026-10-15')='2026-10-01','Oct 2026 opens on Thursday the 1st');
 PERFORM pg_temp.c_assert(haven.first_business_day('2026-11-01')='2026-11-02','Nov 2026: Sunday the 1st rolls to Monday the 2nd');
 PERFORM pg_temp.c_assert(haven.first_business_day('2026-08-01')='2026-08-03','Aug 2026: Saturday the 1st rolls to Monday the 3rd');
END $$;

SET LOCAL ROLE authenticated;

-- 1. Due only on the first business day.
DO $$ DECLARE r jsonb; BEGIN
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_census_on_tap(facility_a,oct_first) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'due'='true' AND r->>'censusMonth'='2026-09-01','Oct 1 asks for September, got '||r::text);
 PERFORM pg_temp.c_assert(r->>'status'='open' AND r->>'canRecord'='true','fresh month is open and the administrator can record');
 PERFORM pg_temp.c_assert(r->'snapshot' ? 'daysInMonth' AND (r->'snapshot'->>'daysInMonth')::int=30,'snapshot carries the month counts');
 SELECT public.home_census_on_tap(facility_a,nov_sunday) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'due'='false','no census row on a weekend 1st');
 SELECT public.home_census_on_tap(facility_a,nov_monday) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'due'='true' AND r->>'censusMonth'='2026-10-01','Monday Nov 2 asks for October');
 SELECT public.home_census_on_tap(facility_a,nov_tuesday) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'due'='false','no census row on the second business day');
END $$;

-- 2. Facility and role scope on the read.
DO $$ BEGIN
 PERFORM pg_temp.as_admin_b();
 BEGIN PERFORM public.home_census_on_tap(facility_a,oct_first) FROM fx; RAISE EXCEPTION 'COL-569 operator at B read building A';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.as_aide();
 BEGIN PERFORM public.home_census_on_tap(facility_a,oct_first) FROM fx; RAISE EXCEPTION 'COL-569 caregiver read the census row';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 3. Something wrong: a note is required and the month stays open.
DO $$ DECLARE r jsonb; BEGIN
 PERFORM pg_temp.as_admin_a();
 BEGIN PERFORM public.home_record_census(facility_a,prior_month,'flagged','  ') FROM fx; RAISE EXCEPTION 'COL-569 flag without a note accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 SELECT public.home_record_census(facility_a,prior_month,'flagged','Two move-outs not yet entered') INTO r FROM fx;
 PERFORM pg_temp.c_assert((r->>'recordedBy')::uuid=(SELECT admin_a FROM fx),'flag stamps the actor');
 SELECT public.home_census_on_tap(facility_a,this_first_bd) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'status'='flagged' AND r->'lastFlag'->>'by'='Ada Operator','flagged month stays on tap with who flagged it, got '||r::text);
END $$;

-- 4. Other buildings and other roles cannot attest; the browser cannot insert.
DO $$ BEGIN
 PERFORM pg_temp.as_admin_b();
 BEGIN PERFORM public.home_record_census(facility_a,prior_month,'confirmed') FROM fx; RAISE EXCEPTION 'COL-569 operator at B confirmed building A';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.c_assert((SELECT count(*) FROM public.facility_census_confirmations c, fx WHERE c.facility_id=fx.facility_a)=0,'operator at B reads no rows for A');
 PERFORM pg_temp.as_exec();
 BEGIN PERFORM public.home_record_census(facility_a,prior_month,'confirmed') FROM fx; RAISE EXCEPTION 'COL-569 org_admin attested for the building';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.as_admin_a();
 BEGIN
  INSERT INTO public.facility_census_confirmations(organization_id,facility_id,census_month,outcome,recorded_by)
  SELECT organization,facility_a,prior_month,'confirmed',admin_a FROM fx;
  RAISE EXCEPTION 'COL-569 browser inserted a confirmation directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.home_record_census(facility_a,(date_trunc('month',now())::date + 40),'confirmed') FROM fx; RAISE EXCEPTION 'COL-569 confirmed an open month';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- 5. Confirm stamps actor and notified executive, once.
DO $$ DECLARE r jsonb; BEGIN
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_record_census(facility_a,prior_month,'confirmed') INTO r FROM fx;
 PERFORM pg_temp.c_assert((r->>'recordedBy')::uuid=(SELECT admin_a FROM fx),'confirm stamps the actor');
 PERFORM pg_temp.c_assert((r->>'notifiedUserId')::uuid=(SELECT exec FROM fx),'confirm names the Facility Executive it notifies');
 PERFORM pg_temp.c_assert((SELECT c.snapshot ? 'rosterCensus' FROM public.facility_census_confirmations c WHERE c.id=(r->>'id')::uuid),'snapshot is frozen on the row');
 BEGIN PERFORM public.home_record_census(facility_a,prior_month,'confirmed') FROM fx; RAISE EXCEPTION 'COL-569 month confirmed twice';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 SELECT public.home_census_on_tap(facility_a,this_first_bd) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'status'='confirmed' AND r->'confirmed'->>'by'='Ada Operator','confirmed month reads back with its actor');
END $$;

-- 6. Only the named Facility Executive reads the notices.
DO $$ DECLARE got jsonb; BEGIN
 PERFORM pg_temp.as_exec();
 SELECT public.home_census_notices_for_executive() INTO got;
 PERFORM pg_temp.c_assert(jsonb_array_length(got)=2 AND got->0->>'outcome'='confirmed','executive reads the confirmation and the flag, got '||got::text);
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_census_notices_for_executive() INTO got;
 PERFORM pg_temp.c_assert(jsonb_array_length(got)=0,'a non-executive reads no census notices');
 PERFORM pg_temp.as_admin_b();
 SELECT public.home_census_notices_for_executive() INTO got;
 PERFORM pg_temp.c_assert(jsonb_array_length(got)=0,'the other building reads no census notices');
END $$;

ROLLBACK;
