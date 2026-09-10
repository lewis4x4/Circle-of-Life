-- COL-137: one recurrence and due-date evaluator on the disposable replay.
-- Proves that the database holds the evaluator's rule shape, that a schedule
-- can be confirmed only through the COL-135 site commands with a valid rule
-- on an applicable configuration, that nothing confirms a schedule for any
-- facility on its own, and that supplied source ambiguities stay unactivated.
-- Authenticated SQL behaviour with synthetic fixtures; not hosted, browser or
-- staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.s_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-137 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.s_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-137 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.s_expect(stmt text,fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-137 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations confirms a schedule or stores a rule for any facility.
SELECT pg_temp.s_assert(NOT EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE schedule_status='confirmed' OR schedule_rule IS NOT NULL),'a migration stored or confirmed a schedule');

-- The database validator agrees with the evaluator on the shared fixtures.
-- FIXTURES-BEGIN (identical to src/lib/operations/schedule-rule-fixtures.json)
CREATE TEMP TABLE sef AS SELECT * FROM jsonb_to_recordset($fx$[
 {
  "name": "weekday set, business days at 09:00",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekday_set",
    "weekdays": [
     "monday",
     "tuesday",
     "wednesday",
     "thursday",
     "friday"
    ]
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "weekly tuesday 10:00 with a one-day reminder",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekly",
    "weekday": "tuesday"
   },
   "deadline": {
    "time": "10:00"
   },
   "reminder": {
    "lead_minutes": 1440
   }
  }
 },
 {
  "name": "monthly on the first with grace",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly",
    "day": 1
   },
   "deadline": {
    "time": "17:00",
    "grace_minutes": 120
   }
  }
 },
 {
  "name": "monthly on the 31st, clamped in short months",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly",
    "day": 31,
    "short_month": "clamp"
   },
   "deadline": {
    "time": "12:00"
   }
  }
 },
 {
  "name": "first business day of the month with a versioned calendar",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly_business_day",
    "ordinal": 1,
    "from": "start"
   },
   "deadline": {
    "time": "17:00"
   },
   "calendar": {
    "key": "fixture-2026",
    "version": "2026.1",
    "covers_from": "2026-01-01",
    "covers_to": "2026-12-31",
    "weekend": [
     "saturday",
     "sunday"
    ],
    "holidays": [
     "2026-01-01",
     "2026-07-03",
     "2026-11-26",
     "2026-12-25"
    ]
   }
  }
 },
 {
  "name": "quarterly on the 15th of fixed months",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "fixed_months",
    "months": [
     1,
     4,
     7,
     10
    ],
    "day": 15
   },
   "deadline": {
    "time": "17:00"
   }
  }
 },
 {
  "name": "fixed half-year windows ending on the last day",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "fixed_months",
    "months": [
     1,
     7
    ],
    "day": "last"
   },
   "deadline": {
    "time": "17:00"
   }
  }
 },
 {
  "name": "six-month interval from an anchor",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "interval_months",
    "every": 6,
    "anchor": "2026-03-15"
   },
   "deadline": {
    "time": "17:00"
   }
  }
 },
 {
  "name": "anniversary from a leap day, clamped",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "interval_months",
    "every": 12,
    "anchor": "2024-02-29",
    "short_month": "clamp"
   },
   "deadline": {
    "time": "17:00"
   }
  }
 },
 {
  "name": "every two years from an anchor",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "interval_months",
    "every": 24,
    "anchor": "2026-05-01"
   },
   "deadline": {
    "time": "17:00"
   }
  }
 },
 {
  "name": "expiry anchor",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "expiry",
    "expires_on": "2027-06-30"
   },
   "deadline": {
    "time": "17:00"
   }
  }
 },
 {
  "name": "event-created work due thirty days after the event",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "event",
    "event_key": "admission"
   },
   "deadline": {
    "time": "17:00",
    "day_offset": 30
   }
  }
 },
 {
  "name": "seven-day set skipping calendar holidays",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekday_set",
    "weekdays": [
     "monday",
     "tuesday",
     "wednesday",
     "thursday",
     "friday",
     "saturday",
     "sunday"
    ],
    "on_holiday": "skipped"
   },
   "deadline": {
    "time": "20:00"
   },
   "calendar": {
    "key": "fixture-2026",
    "version": "2026.1",
    "covers_from": "2026-01-01",
    "covers_to": "2026-12-31",
    "weekend": [],
    "holidays": [
     "2026-01-01",
     "2026-12-25"
    ]
   }
  }
 },
 {
  "name": "workbook text is not a rule",
  "valid": false,
  "first_problem": "schedule rule has an unknown field: kind",
  "rule": {
   "kind": "text",
   "text": "Bi-Annual Facility License Renewal"
  }
 },
 {
  "name": "missing rule version",
  "valid": false,
  "first_problem": "schedule rule version must be 1",
  "rule": {
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "abbreviated timezone",
  "valid": false,
  "first_problem": "schedule rule timezone must be an IANA zone name",
  "rule": {
   "rule_version": 1,
   "timezone": "EST",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "day 31 without a short-month policy",
  "valid": false,
  "first_problem": "schedule rule recurrence needs a short_month policy",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly",
    "day": 31
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "business-day rule without a calendar",
  "valid": false,
  "first_problem": "schedule rule recurrence needs a calendar",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly_business_day",
    "ordinal": 1,
    "from": "start"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "deadline time not HH:MM",
  "valid": false,
  "first_problem": "schedule rule deadline time must be HH:MM",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "9:00"
   }
  }
 },
 {
  "name": "duplicate weekdays",
  "valid": false,
  "first_problem": "schedule rule weekdays must be unique",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekday_set",
    "weekdays": [
     "monday",
     "monday"
    ]
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "fixed months empty",
  "valid": false,
  "first_problem": "schedule rule months must be a non-empty list",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "fixed_months",
    "months": [],
    "day": 1
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "bi-annual is not a recurrence kind",
  "valid": false,
  "first_problem": "schedule rule recurrence kind is unknown",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "biannual"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "calendar holiday outside its coverage",
  "valid": false,
  "first_problem": "schedule rule calendar holidays must lie inside the coverage",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "09:00"
   },
   "calendar": {
    "key": "fixture",
    "version": "1",
    "covers_from": "2026-01-01",
    "covers_to": "2026-12-31",
    "weekend": [
     "saturday",
     "sunday"
    ],
    "holidays": [
     "2027-01-01"
    ]
   }
  }
 },
 {
  "name": "reminder without lead",
  "valid": false,
  "first_problem": "schedule rule reminder lead_minutes must be 1 to 86400",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "09:00"
   },
   "reminder": {
    "lead_minutes": 0
   }
  }
 },
 {
  "name": "interval anchored on the 31st without a policy",
  "valid": false,
  "first_problem": "schedule rule recurrence needs a short_month policy",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "interval_months",
    "every": 6,
    "anchor": "2026-01-31"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "unknown top-level field",
  "valid": false,
  "first_problem": "schedule rule has an unknown field: notes",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "09:00"
   },
   "notes": "monthly per interview"
  }
 },
 {
  "name": "event key that is not a slug",
  "valid": false,
  "first_problem": "schedule rule event_key must be a slug",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "event",
    "event_key": "New Admission"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "ordinal beyond the supported range",
  "valid": false,
  "first_problem": "schedule rule ordinal must be 1 to 15",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly_business_day",
    "ordinal": 16,
    "from": "start"
   },
   "deadline": {
    "time": "09:00"
   },
   "calendar": {
    "key": "fixture",
    "version": "1",
    "covers_from": "2026-01-01",
    "covers_to": "2026-12-31",
    "weekend": [
     "saturday",
     "sunday"
    ],
    "holidays": []
   }
  }
 },
 {
  "name": "monthly without a day",
  "valid": false,
  "first_problem": "schedule rule day must be 1 to 31 or last",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "monthly"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "fixed months without a day",
  "valid": false,
  "first_problem": "schedule rule day must be 1 to 31 or last",
  "rule": {
   "rule_version": 1,
   "timezone": "America/New_York",
   "recurrence": {
    "kind": "fixed_months",
    "months": [
     1
    ]
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "lower-case zone name is the same zone",
  "valid": true,
  "rule": {
   "rule_version": 1,
   "timezone": "america/new_york",
   "recurrence": {
    "kind": "weekly",
    "weekday": "monday"
   },
   "deadline": {
    "time": "09:00"
   }
  }
 },
 {
  "name": "two unknown fields name the shortest first",
  "valid": false,
  "first_problem": "schedule rule has an unknown field: kind",
  "rule": {
   "text": "Bi-Annual",
   "kind": "text"
  }
 }
]$fx$::jsonb) AS x(name text,rule jsonb,valid boolean,first_problem text);
-- FIXTURES-END
SELECT pg_temp.s_assert((SELECT count(*) FROM sef)>=30,'fixture set was not loaded');
DO $$ DECLARE f record; problems text[]; BEGIN
 FOR f IN SELECT * FROM sef LOOP
  problems:=haven.operation_schedule_rule_problems(f.rule);
  IF f.valid AND coalesce(cardinality(problems),0)<>0 THEN RAISE EXCEPTION 'COL-137 fixture "%" should be valid but reported %',f.name,problems; END IF;
  IF NOT f.valid AND (coalesce(cardinality(problems),0)=0 OR problems[1] IS DISTINCT FROM f.first_problem) THEN RAISE EXCEPTION 'COL-137 fixture "%" expected first problem "%" but reported %',f.name,f.first_problem,problems; END IF;
  IF haven.operation_schedule_rule_valid(f.rule) IS DISTINCT FROM f.valid THEN RAISE EXCEPTION 'COL-137 fixture "%" validity mismatch',f.name; END IF;
 END LOOP;
END $$;
SELECT pg_temp.s_assert(haven.operation_schedule_rule_problems('"(6)"'::jsonb)=ARRAY['schedule rule must be an object'],'free text was accepted as a rule');

CREATE TEMP TABLE sf AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() act,f.id site_a,f.organization_id org,f.entity_id entity
 FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
CREATE TEMP TABLE sf_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE sf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON sf,sef TO authenticated,service_role; GRANT ALL ON sf_ids,sf_results TO authenticated,service_role;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@evaluator.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM sf
 UNION ALL SELECT admin_a,admin_a||'@evaluator.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM sf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@evaluator.invalid','Corporate','owner'::public.app_role,org,true FROM sf
 UNION ALL SELECT admin_a,admin_a||'@evaluator.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM sf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM sf UNION ALL SELECT admin_a_session,admin_a FROM sf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT owner_actor,site_a,org FROM sf UNION ALL SELECT admin_a,site_a,org FROM sf;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act,org,NULL,'hfo-137-fixture:'||act,'Generator weekly observation','structured_observation','facility','admin_log' FROM sf;
CREATE FUNCTION pg_temp.s_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f sf; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM sf;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner'; ELSE u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;

-- A published central version so a site configuration can be applicable.
SELECT pg_temp.s_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO sf_results SELECT 'v1',public.save_operation_requirement_draft_review(act,'{"title":"Generator weekly observation","wording":"Observe the weekly generator test run.","subject_kind":"facility","allowed_recorder_roles":["maintenance_role","facility_admin"]}') FROM sf;
INSERT INTO sf_ids SELECT 'v1',(result->>'id')::uuid FROM sf_results WHERE label='v1';
INSERT INTO sf_results SELECT 'pub1',public.publish_operation_requirement_review(id,clock_timestamp()) FROM sf_ids WHERE label='v1';
SELECT pg_temp.s_assert(result->>'status'='published','central version was not published') FROM sf_results WHERE label='pub1';
RESET ROLE;

-- Site administrator: an invalid rule cannot even be drafted; the message names the first problem.
SELECT pg_temp.s_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.s_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act FROM sf),(SELECT site_a FROM sf),'{"schedule_status":"confirmed","schedule_rule":{"kind":"weekly","weekday":"tuesday"}}')$q$,'contains an invalid value: schedule rule has an unknown field: kind');
SELECT pg_temp.s_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act FROM sf),(SELECT site_a FROM sf),'{"schedule_rule":{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"monthly","day":31},"deadline":{"time":"09:00"}}}')$q$,'schedule rule recurrence needs a short_month policy');
SELECT pg_temp.s_expect($q$SELECT public.save_operation_facility_requirement_draft_review((SELECT act FROM sf),(SELECT site_a FROM sf),'{"schedule_rule":{"rule_version":1,"timezone":"EST","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}}')$q$,'schedule rule timezone must be an IANA zone name');
SELECT pg_temp.s_assert((SELECT count(*) FROM public.operation_facility_requirements WHERE facility_id=(SELECT site_a FROM sf) AND activity_id=(SELECT act FROM sf))=0,'an invalid rule was stored');

-- A valid rule drafts; confirmation is publishable only on an applicable configuration.
INSERT INTO sf_results SELECT 'fr1',public.save_operation_facility_requirement_draft_review(act,site_a,jsonb_build_object(
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":60},"reminder":{"lead_minutes":1440}}'::jsonb)) FROM sf;
INSERT INTO sf_ids SELECT 'fr1',(result->>'id')::uuid FROM sf_results WHERE label='fr1';
SELECT pg_temp.s_assert(result->>'status'='draft' AND result->>'schedule_status'='confirmed' AND result->>'applicability'='needs_confirmation' AND result->'schedule_rule'->'recurrence'->>'kind'='weekly','confirmed draft with a valid rule was not stored as drafted') FROM sf_results WHERE label='fr1';
INSERT INTO sf_results SELECT 'prev1',public.preview_operation_facility_requirement_review(id,clock_timestamp()+interval '2 minutes') FROM sf_ids WHERE label='fr1';
SELECT pg_temp.s_assert((result->>'publishable')::boolean=false AND result->'problems' ? 'schedule confirmation requires applicable' AND result->>'proposed_schedule_status'='confirmed'
 AND result->'proposed_schedule_rule'->'recurrence'->>'weekday'='tuesday' AND (result->>'schedule_rule_version')::int=1,'preview did not refuse confirmation on a needs_confirmation configuration or hide the rule') FROM sf_results WHERE label='prev1';
SELECT pg_temp.s_expect($q$SELECT public.publish_operation_facility_requirement_review((SELECT id FROM sf_ids WHERE label='fr1'),clock_timestamp()+interval '2 minutes')$q$,'schedule confirmation requires applicable');
INSERT INTO sf_results SELECT 'fr1b',public.save_operation_facility_requirement_draft_review(act,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM sf_ids WHERE label='v1'),
 'override_source','interview','applicability_reason','Weekly Tuesday test per site interview')) FROM sf;
INSERT INTO sf_results SELECT 'prev2',public.preview_operation_facility_requirement_review(id,clock_timestamp()+interval '2 minutes') FROM sf_ids WHERE label='fr1';
SELECT pg_temp.s_assert((result->>'publishable')::boolean AND result->>'proposed_schedule_status'='confirmed','applicable configuration with a valid rule was not publishable') FROM sf_results WHERE label='prev2';
INSERT INTO sf_results SELECT 'pubfr1',public.publish_operation_facility_requirement_review(id,clock_timestamp()+interval '2 minutes') FROM sf_ids WHERE label='fr1';
SELECT pg_temp.s_assert(result->>'status'='published' AND result->>'schedule_status'='confirmed' AND result->'schedule_rule'->'deadline'->>'time'='10:00' AND (result->>'approved_by')::uuid=(SELECT admin_a FROM sf) AND result->>'approved_at' IS NOT NULL,
 'confirmed schedule was not published with its rule and approver') FROM sf_results WHERE label='pubfr1';
-- The published rule is immutable for the session.
SELECT pg_temp.s_denied($q$UPDATE public.operation_facility_requirements SET schedule_rule='{}'::jsonb WHERE id=(SELECT id FROM sf_ids WHERE label='fr1')$q$);
-- The next draft inherits the confirmed rule; turning the site not applicable makes confirmation unpublishable again.
INSERT INTO sf_results SELECT 'fr2',public.save_operation_facility_requirement_draft_review(act,site_a,'{"applicability":"not_applicable","applicability_reason":"Generator removed"}') FROM sf;
INSERT INTO sf_ids SELECT 'fr2',(result->>'id')::uuid FROM sf_results WHERE label='fr2';
SELECT pg_temp.s_assert(result->>'schedule_status'='confirmed' AND result->'schedule_rule' IS NOT NULL AND (result->>'version')::int=2,'new draft did not inherit the confirmed schedule') FROM sf_results WHERE label='fr2';
INSERT INTO sf_results SELECT 'prev3',public.preview_operation_facility_requirement_review(id,clock_timestamp()+interval '3 minutes') FROM sf_ids WHERE label='fr2';
SELECT pg_temp.s_assert((result->>'publishable')::boolean=false AND result->'problems' ? 'schedule confirmation requires applicable' AND result->'proposed_schedule_rule'->'recurrence'->>'kind'='weekly' AND (result ? 'in_force_schedule_rule'),'not applicable with a confirmed schedule previewed as publishable') FROM sf_results WHERE label='prev3';
-- Returning the schedule to needs_confirmation clears the rule requirement and publishes as its own state.
INSERT INTO sf_results SELECT 'fr2b',public.save_operation_facility_requirement_draft_review(act,site_a,'{"schedule_status":"needs_confirmation","schedule_rule":null}') FROM sf;
INSERT INTO sf_results SELECT 'pubfr2',public.publish_operation_facility_requirement_review(id,clock_timestamp()+interval '3 minutes') FROM sf_ids WHERE label='fr2';
SELECT pg_temp.s_assert(result->>'status'='published' AND result->>'schedule_status'='needs_confirmation' AND (result->'schedule_rule' IS NULL OR jsonb_typeof(result->'schedule_rule')='null'),'needs_confirmation did not publish as its own state') FROM sf_results WHERE label='pubfr2';
SELECT pg_temp.s_assert((SELECT schedule_status='confirmed' AND effective_to IS NOT NULL FROM public.operation_facility_requirements WHERE id=(SELECT id FROM sf_ids WHERE label='fr1')),'closed confirmed configuration lost its state or window');
RESET ROLE;

-- The service identity cannot confirm or edit a schedule outside the commands.
SET LOCAL ROLE service_role;
SELECT pg_temp.s_denied($q$UPDATE public.operation_facility_requirements SET schedule_status='confirmed' WHERE id=(SELECT id FROM sf_ids WHERE label='fr2')$q$);
SELECT pg_temp.s_denied($q$SELECT public.publish_operation_facility_requirement_review((SELECT id FROM sf_ids WHERE label='fr2'),clock_timestamp())$q$);
RESET ROLE;

-- Publication of a confirmed schedule is audited like every other state.
SELECT pg_temp.s_assert((SELECT count(*) FROM public.audit_log WHERE table_name='operation_facility_requirements' AND record_id=(SELECT id FROM sf_ids WHERE label='fr1'))>=2,'schedule confirmation was not audited');

-- Supplied source ambiguities stay unactivated: the seeded catalog carries no approved rule and no seeded configuration is confirmed.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.organizations WHERE id='00000000-0000-0000-0000-000000000001') THEN
 IF EXISTS(SELECT 1 FROM public.operation_activity_source_items WHERE organization_id='00000000-0000-0000-0000-000000000001' AND source_item_id IN('AL-M05','AL-M06','AL-A07','AL-Y05','AL-Y07','AL-E14','AL-H01')
   AND coalesce(source_payload->'approvedRule','null'::jsonb)<>'null'::jsonb) THEN RAISE EXCEPTION 'COL-137 a source ambiguity carries an approved rule'; END IF;
 IF (SELECT count(*) FROM public.operation_activity_source_items WHERE organization_id='00000000-0000-0000-0000-000000000001' AND source_item_id IN('AL-M05','AL-M06','AL-A07','AL-Y05','AL-Y07','AL-E14','AL-H01'))<>7 THEN RAISE EXCEPTION 'COL-137 expected the seven ambiguous source items'; END IF;
END IF; END $$;
ROLLBACK;
