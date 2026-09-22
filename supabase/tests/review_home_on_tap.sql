-- COL-593: Facility Operator Home — the On-tap feed is scoped by the database.
--
-- Proves, with real sessions and RLS on:
--   * an operator at building A reads their generator row and nothing for
--     building B, whatever facility id is passed;
--   * a caregiver cannot call the feed at all;
--   * Saturday/Sunday returns no queue rows (E1) while "later" still lists;
--   * a night-only row never reaches the page (DEC-2026-09-21-11);
--   * claim / release move ownership without duplicating the row, and a
--     stranger cannot claim;
--   * the end-of-day sweep escalates once, and only the named Facility
--     Executive reads it.
--
-- Rollback-only fixture. Mirrors review_rounding_completion_receipts.sql.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role','') $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-593 %',msg; END IF; END $$;

CREATE TEMP TABLE fx AS
SELECT gen_random_uuid() admin_a, gen_random_uuid() admin_a_session,
       gen_random_uuid() admin_b, gen_random_uuid() admin_b_session,
       gen_random_uuid() exec,    gen_random_uuid() exec_session,
       gen_random_uuid() aide,    gen_random_uuid() aide_session,
       gen_random_uuid() asset,   gen_random_uuid() template,
       gen_random_uuid() task_day, gen_random_uuid() task_night,
       a.organization_id organization, a.id facility_a, b.id facility_b,
       '2026-09-22'::date shift_date,                 -- a Tuesday
       '2026-09-22T13:12:00Z'::timestamptz as_of,     -- 9:12 AM New York
       '2026-09-19T13:12:00Z'::timestamptz saturday,
       '2026-09-22T21:30:00Z'::timestamptz after_five  -- 5:30 PM New York
FROM public.facilities a
JOIN public.facilities b ON b.organization_id=a.organization_id AND b.id<>a.id AND b.deleted_at IS NULL
WHERE a.deleted_at IS NULL ORDER BY a.id, b.id LIMIT 1;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM fx) THEN RAISE EXCEPTION 'Two seeded facilities required'; END IF; END $$;

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT admin_a,admin_a||'@home.invalid','{}'::jsonb,'{}'::jsonb FROM fx
UNION ALL SELECT admin_b,admin_b||'@home.invalid','{}'::jsonb,'{}'::jsonb FROM fx
UNION ALL SELECT exec,exec||'@home.invalid','{}'::jsonb,'{}'::jsonb FROM fx
UNION ALL SELECT aide,aide||'@home.invalid','{}'::jsonb,'{}'::jsonb FROM fx;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active,job_title)
SELECT admin_a,organization,admin_a||'@home.invalid','Ada Operator','facility_admin'::public.app_role,true,'Administrator' FROM fx
UNION ALL SELECT admin_b,organization,admin_b||'@home.invalid','Bea Operator','manager'::public.app_role,true,'Manager' FROM fx
UNION ALL SELECT exec,organization,exec||'@home.invalid','Eve Executive','org_admin'::public.app_role,true,'COO' FROM fx
UNION ALL SELECT aide,organization,aide||'@home.invalid','Cal Aide','caregiver'::public.app_role,true,NULL FROM fx;
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

-- The generator: asset with its own clock, its COL-133 subject, a facility-scoped template.
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name,status,run_check_weekday,run_check_local_time,run_check_set_at)
SELECT asset,organization,facility_a,'generator','Probe generator','active',2,'10:00',now() FROM fx;
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind)
SELECT organization,facility_a,'facility' FROM fx
WHERE NOT EXISTS(SELECT 1 FROM public.operation_activity_subjects s, fx WHERE s.facility_id=fx.facility_a AND s.subject_kind='facility');
INSERT INTO public.operation_activity_subjects(organization_id,facility_id,subject_kind,asset_id)
SELECT organization,facility_a,'asset',asset FROM fx;
INSERT INTO public.operation_task_templates(id,organization_id,facility_id,name,description,category,cadence_type,shift_scope,day_of_week,assignee_role,escalation_ladder,asset_ref,priority,survey_readiness_impact,estimated_minutes,is_active,activity_id)
SELECT template,organization,facility_a,'Generator weekly run','probe','safety','weekly','day',2,'facility_administrator','[]'::jsonb,asset,'high',true,10,true,
       (SELECT id FROM public.operation_activities WHERE activity_key='hfo-al-w01-01' AND organization_id=fx.organization LIMIT 1)
FROM fx;

-- What the scheduler writes as a service job: classified asset rows, one day, one night.
INSERT INTO public.operation_task_instances(id,organization_id,facility_id,template_id,template_name,template_category,template_cadence_type,priority,assigned_shift_date,assigned_shift,assigned_role,status,due_at,subject_id,authority_class)
SELECT task_day,organization,facility_a,template,'Generator weekly run','safety','weekly','high',shift_date,'day','facility_admin','pending','2026-09-22T14:00:00Z'::timestamptz,
       (SELECT id FROM public.operation_activity_subjects WHERE asset_id=fx.asset),'asset' FROM fx
UNION ALL
SELECT task_night,organization,facility_a,template,'Generator weekly run','safety','weekly','high',shift_date,'night','facility_admin','pending','2026-09-23T04:00:00Z'::timestamptz,
       (SELECT id FROM public.operation_activity_subjects WHERE asset_id=fx.asset),'asset' FROM fx;
GRANT SELECT ON fx TO authenticated,service_role;

-- SECURITY DEFINER: the claim version is read from the profile before any claims exist, so RLS must not hide it.
CREATE FUNCTION pg_temp.claims(p_user uuid,p_session uuid,p_role text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'session_id',p_session,'role','authenticated',
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=p_user),'app_role',p_role)::text,true)::void
$$;
CREATE FUNCTION pg_temp.as_admin_a() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(admin_a,admin_a_session,'facility_admin') FROM fx $$;
CREATE FUNCTION pg_temp.as_admin_b() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(admin_b,admin_b_session,'manager') FROM fx $$;
CREATE FUNCTION pg_temp.as_exec() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(exec,exec_session,'org_admin') FROM fx $$;
CREATE FUNCTION pg_temp.as_aide() RETURNS void LANGUAGE sql AS $$ SELECT pg_temp.claims(aide,aide_session,'caregiver') FROM fx $$;

SET LOCAL ROLE authenticated;

-- 1. The operator at A sees the generator row, classified and unclaimed; the night row never appears.
DO $$ DECLARE feed jsonb; BEGIN
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_on_tap(facility_a,as_of) INTO feed FROM fx;
 PERFORM pg_temp.c_assert(feed->>'isWeekend'='false','Tuesday is not a weekend');
 PERFORM pg_temp.c_assert(jsonb_array_length(feed->'rows')=1,'operator at A sees exactly the day row, got '||(feed->'rows')::text);
 PERFORM pg_temp.c_assert(feed->'rows'->0->>'bucket'='regulatory','generator is regulatory');
 PERFORM pg_temp.c_assert(feed->'rows'->0->>'catalogKey'='hfo-al-w01-01','row carries the Admin Log catalog identity');
 PERFORM pg_temp.c_assert(feed->'rows'->0->'owner'->>'kind'='queue','fresh row belongs to the facility queue');
 PERFORM pg_temp.c_assert(feed->'rows'->0->'assetSchedule'->>'weekday'='2','asset schedule rides on the row');
 PERFORM pg_temp.c_assert((feed->'counts'->>'regulatory')::int=1 AND (feed->'counts'->>'assigned')::int=0,'counts follow the buckets');
 PERFORM pg_temp.c_assert(feed->'escalatesTo'->>'displayName'='Eve Executive','the executive is named on the feed');
 PERFORM pg_temp.c_assert(feed->>'endOfDayLocal'='17:00','default end of day is 17:00 local');
END $$;

-- 2. Cross-facility and cross-role reads are refused at the database.
DO $$ BEGIN
 PERFORM pg_temp.as_admin_a();
 BEGIN PERFORM public.home_on_tap(facility_b,as_of) FROM fx; RAISE EXCEPTION 'COL-593 operator at A read building B';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.as_admin_b();
 BEGIN PERFORM public.home_on_tap(facility_a,as_of) FROM fx; RAISE EXCEPTION 'COL-593 operator at B read building A';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.as_aide();
 BEGIN PERFORM public.home_on_tap(facility_a,as_of) FROM fx; RAISE EXCEPTION 'COL-593 caregiver read the operator feed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 3. Weekend: nothing on tap, the coming week still lists.
DO $$ DECLARE feed jsonb; BEGIN
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_on_tap(facility_a,saturday) INTO feed FROM fx;
 PERFORM pg_temp.c_assert(feed->>'isWeekend'='true','Saturday is a weekend');
 PERFORM pg_temp.c_assert(jsonb_array_length(feed->'rows')=0,'no queue rows on Saturday');
 PERFORM pg_temp.c_assert(jsonb_array_length(feed->'later')=1,'Tuesday row sits under later on Saturday');
END $$;

-- 4. Claim and release move ownership on the same row; a stranger cannot claim.
DO $$ DECLARE feed jsonb; r jsonb; BEGIN
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_claim_task(task_day,true) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'success'='true' AND (r->>'assignedTo')::uuid=(SELECT admin_a FROM fx),'claim assigns the caller');
 SELECT public.home_on_tap(facility_a,as_of) INTO feed FROM fx;
 PERFORM pg_temp.c_assert(jsonb_array_length(feed->'rows')=1,'a claimed row is still one row');
 PERFORM pg_temp.c_assert(feed->'rows'->0->'owner'->>'kind'='user' AND feed->'rows'->0->'owner'->>'displayName'='Ada Operator','claimant name shows on the row');
 BEGIN PERFORM public.home_claim_task(task_day,true) FROM fx; RAISE EXCEPTION 'COL-593 double claim accepted';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 SELECT public.home_claim_task(task_day,false) INTO r FROM fx;
 PERFORM pg_temp.c_assert(r->>'assignedTo' IS NULL,'release returns the row to the queue');
 PERFORM pg_temp.as_admin_b();
 BEGIN PERFORM public.home_claim_task(task_day,true) FROM fx; RAISE EXCEPTION 'COL-593 operator at B claimed a row at A';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 5. End-of-day sweep escalates once; only the named executive reads it.
-- The sweep runs from pg_cron with no session: clear the claims so the row
-- guards take the service path exactly as they do on the hosted project.
RESET ROLE;
SELECT set_config('request.jwt.claims','',true);
DO $$ DECLARE n int; lvl int; BEGIN
 SELECT public.home_escalate_uncleared(facility_a,as_of) INTO n FROM fx;
 PERFORM pg_temp.c_assert(n=0,'nothing escalates before end of day, got '||n);
 SELECT public.home_escalate_uncleared(facility_a,after_five) INTO n FROM fx;
 PERFORM pg_temp.c_assert(n=1,'the open day row escalates at end of day, got '||n);
 SELECT current_escalation_level INTO lvl FROM public.operation_task_instances WHERE id=(SELECT task_day FROM fx);
 PERFORM pg_temp.c_assert(lvl=1,'escalation level recorded');
 SELECT public.home_escalate_uncleared(facility_a,after_five) INTO n FROM fx;
 PERFORM pg_temp.c_assert(n=0,'the sweep is idempotent, got '||n);
 PERFORM pg_temp.c_assert((SELECT escalation_history->0->>'reason' FROM public.operation_task_instances WHERE id=(SELECT task_day FROM fx))='uncleared_end_of_day','history names the reason');
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE got jsonb; BEGIN
 PERFORM pg_temp.as_exec();
 SELECT public.home_escalations_for_executive() INTO got;
 PERFORM pg_temp.c_assert(jsonb_array_length(got)=1 AND got->0->>'title'='Generator weekly run','executive reads the escalated row, got '||got::text);
 PERFORM pg_temp.as_admin_a();
 SELECT public.home_escalations_for_executive() INTO got;
 PERFORM pg_temp.c_assert(jsonb_array_length(got)=0,'a non-executive reads no escalations');
 PERFORM pg_temp.as_admin_b();
 SELECT public.home_escalations_for_executive() INTO got;
 PERFORM pg_temp.c_assert(jsonb_array_length(got)=0,'the other building reads no escalations');
END $$;

ROLLBACK;
