-- COL-147: final source records linked to requirements with replay and
-- invalidation handling, on the disposable replay. A synthetic adapter over a
-- synthetic source table (registered here, rolled back here) proves that a
-- final matching record satisfies exactly its occurrence once, that a replay
-- under the same key and a second delivery of the same version under another
-- key converge on the one ledger row, that a draft, voided, stale, missing,
-- wrong-site, wrong-subject, non-allowlisted, off-period, cancelled or
-- unauthorised-author record leaves a recorded refusal or a visible pending
-- row and writes no receipt, that ambiguity is resolved only among predicate
-- candidates, that a human receipt makes the delivery a conflict rather than
-- being overwritten, that a corrected version supersedes the earlier source
-- receipt as a 344 correction (reopening review), that a void reverses the
-- source receipt into retained history with an attention row, and that no
-- direct DML, forged setting, delete, truncate or forced audit failure can
-- mint, alter or lose any of it. Authenticated SQL behaviour with synthetic
-- fixtures; not hosted, provider, staff or operating acceptance. Rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-147 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-147 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.c_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL,p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR coalesce(d,'')=detail_fragment) AND (p_sqlstate IS NULL OR SQLSTATE=p_sqlstate) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-147 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations registers a source or delivers anything.
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_source_adapters) AND NOT EXISTS(SELECT 1 FROM public.operation_source_rules),'a migration registered a source adapter or rule');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_source_events) AND NOT EXISTS(SELECT 1 FROM public.operation_source_event_attempts),'a migration delivered a source event');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE source_event_id IS NOT NULL),'a migration wrote a source receipt');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_audit_log WHERE event_type IN('source_linked','source_pending','source_invalidated')),'a migration wrote a source audit row');

-- FIXTURES-BEGIN
CREATE TEMP TABLE cf AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_fac,gen_random_uuid() act_res,gen_random_uuid() act_other,
 gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() asset3,gen_random_uuid() res1,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_res1,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 -- Versions, configurations and bindings take effect 23 hours ago; one occurrence per subject fell due three hours ago with a two-hour grace.
 clock_timestamp()-interval '23 hours' since,date_trunc('minute',clock_timestamp()-interval '3 hours') past_due,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE cf ADD COLUMN d0 date,ADD COLUMN hh0 text,ADD COLUMN dp1 date,ADD COLUMN d2 date;
UPDATE cf SET d0=(past_due AT TIME ZONE 'America/New_York')::date,hh0=to_char(past_due AT TIME ZONE 'America/New_York','HH24:MI'),dp1=(past_due AT TIME ZONE 'America/New_York')::date+1,d2=d1+7;
CREATE TEMP TABLE cf_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE cf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON cf TO authenticated,service_role; GRANT ALL ON cf_ids,cf_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Source Site B','Test','Test','00000',1 FROM cf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM cf
 UNION ALL SELECT admin_a,admin_a||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM cf
 UNION ALL SELECT admin_b,admin_b||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM cf
 UNION ALL SELECT maint,maint||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM cf
 UNION ALL SELECT nurse,nurse||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM cf
 UNION ALL SELECT aide,aide||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM cf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@source.invalid','Corporate','owner'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_a,admin_a||'@source.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_b,admin_b||'@source.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT maint,maint||'@source.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM cf
 UNION ALL SELECT nurse,nurse||'@source.invalid','Nurse','nurse'::public.app_role,org,true FROM cf
 UNION ALL SELECT aide,aide||'@source.invalid','Aide','housekeeper'::public.app_role,org,true FROM cf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM cf UNION ALL SELECT admin_a_session,admin_a FROM cf UNION ALL SELECT admin_b_session,admin_b FROM cf
 UNION ALL SELECT maint_session,maint FROM cf UNION ALL SELECT nurse_session,nurse FROM cf UNION ALL SELECT aide_session,aide FROM cf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM cf UNION ALL SELECT admin_a,site_a,org FROM cf UNION ALL SELECT admin_b,site_b,org FROM cf UNION ALL SELECT maint,site_a,org FROM cf
 UNION ALL SELECT nurse,site_a,org FROM cf UNION ALL SELECT aide,site_a,org FROM cf;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority',true FROM cf
 UNION ALL SELECT org,site_a,owner_actor,'resident',owner_actor,'Fixture corporate resident reviewer',true FROM cf
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM cf;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-147-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM cf
 UNION ALL SELECT act_fac,org,NULL,'hfo-147-fixture:'||act_fac,'Generator weekly test','structured_observation','facility','admin_log' FROM cf
 UNION ALL SELECT act_res,org,NULL,'hfo-147-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM cf
 UNION ALL SELECT act_other,org,NULL,'hfo-147-fixture:'||act_other,'Extinguisher check','structured_observation','asset','admin_log' FROM cf;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM cf UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM cf UNION ALL SELECT asset3,org,site_a,'aed','AED unenrolled' FROM cf;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM cf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM cf UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM cf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM cf;
CREATE FUNCTION pg_temp.c_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f cf; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM cf;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.c_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.c_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,tzname text,hh text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.occ2(d date,p_start date,p_end date,tzname text,hh text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(p_start,'YYYY-MM-DD'),'end_date',to_char(p_end,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col147-'||p $$;
CREATE FUNCTION pg_temp.rid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM cf_ids WHERE label=p_label $$;
CREATE FUNCTION pg_temp.res(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT result FROM cf_results WHERE label=p_label $$;
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_execution_receipts WHERE id=(SELECT id FROM cf_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.erev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_source_events WHERE id=(SELECT id FROM cf_ids WHERE label=p_label) $$;
-- The synthetic source: one row per record id, the current version and finality, and the statement the reader hands to the mechanism.
CREATE TABLE public.hfo_probe_source_records(id text PRIMARY KEY,version text NOT NULL,finality text NOT NULL,facility_id uuid,activity_id uuid,subject_kind text,subject_native_id uuid,recorded_by uuid,recorded_at timestamptz,statement jsonb,extra jsonb);
GRANT SELECT ON public.hfo_probe_source_records TO authenticated,service_role;
CREATE FUNCTION haven.operation_source_probe_read(p_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT jsonb_strip_nulls(jsonb_build_object('exists',true,'version',r.version,'finality',r.finality,'facility_id',r.facility_id,'activity_id',r.activity_id,
   'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_native_id),'recorded_by',r.recorded_by,'recorded_at',r.recorded_at,'statement',r.statement))||coalesce(r.extra,'{}'::jsonb)
  FROM public.hfo_probe_source_records r WHERE r.id=p_id),'{"exists":false}'::jsonb)
$$;
CREATE FUNCTION haven.operation_source_probe_broken(p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'probe reader is broken'; END $$;
CREATE FUNCTION pg_temp.src(p_id text,p_version text,p_finality text,p_facility uuid,p_activity uuid,p_kind text,p_native uuid,p_by uuid,p_at timestamptz,p_statement jsonb,p_extra jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.hfo_probe_source_records(id,version,finality,facility_id,activity_id,subject_kind,subject_native_id,recorded_by,recorded_at,statement,extra)
 VALUES(p_id,p_version,p_finality,p_facility,p_activity,p_kind,p_native,p_by,p_at,p_statement,p_extra)
 ON CONFLICT(id) DO UPDATE SET version=excluded.version,finality=excluded.finality,facility_id=excluded.facility_id,activity_id=excluded.activity_id,subject_kind=excluded.subject_kind,
  subject_native_id=excluded.subject_native_id,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,statement=excluded.statement,extra=excluded.extra
$$;
CREATE FUNCTION pg_temp.deliver(p_key text,p_source text,p_id text,p_version text,p_kind text,p_facility uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.deliver_operation_source_event_review(pg_temp.k(p_key),jsonb_build_object('source_key',p_source,'source_record_id',p_id,'source_record_version',p_version,'event_kind',p_kind,'facility_id',p_facility))
$$;
CREATE FUNCTION pg_temp.deliver_service(p_key text,p_source text,p_id text,p_version text,p_kind text,p_facility uuid,p_org uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.deliver_operation_source_event_service(pg_temp.k(p_key),jsonb_build_object('source_key',p_source,'source_record_id',p_id,'source_record_version',p_version,'event_kind',p_kind,'facility_id',p_facility,'organization_id',p_org))
$$;
CREATE FUNCTION pg_temp.stmt(p_at timestamptz,p_values jsonb DEFAULT '{"pads_ok":true,"battery_pct":90}'::jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('performed_at',p_at,'outcome','performed','values',p_values,'note','From the source log')
$$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text,text,int),pg_temp.occ2(date,date,date,text,text,int),pg_temp.run(text,date,date,uuid),pg_temp.c_login(text),pg_temp.c_service(),pg_temp.c_clear(),pg_temp.k(text),pg_temp.rid(text),pg_temp.res(text),pg_temp.rev(text),pg_temp.erev(text),
 pg_temp.src(text,text,text,uuid,uuid,text,uuid,uuid,timestamptz,jsonb,jsonb),pg_temp.deliver(text,text,text,text,text,uuid),pg_temp.deliver_service(text,text,text,text,text,uuid,uuid),pg_temp.stmt(timestamptz,jsonb) TO authenticated,service_role;

-- Allowlist by migration (no session, no service): three adapters, one activity each; the extinguisher activity stays outside every allowlist.
SELECT pg_temp.c_clear();
INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function,note) SELECT org,'probe-asset','asset','operation_source_probe_read','COL-147 probe' FROM cf;
INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function,note) SELECT org,'probe-site','facility','operation_source_probe_read','COL-147 probe' FROM cf;
INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function,note) SELECT org,'probe-res','resident','operation_source_probe_read','COL-147 probe' FROM cf;
INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function,note) SELECT org,'probe-broken','asset','operation_source_probe_broken','COL-147 probe' FROM cf;
INSERT INTO public.operation_source_rules(organization_id,source_key,activity_id) SELECT org,'probe-asset',act_asset FROM cf UNION ALL SELECT org,'probe-site',act_fac FROM cf UNION ALL SELECT org,'probe-res',act_res FROM cf UNION ALL SELECT org,'probe-broken',act_asset FROM cf;
-- Central versions (owner) and site configurations (site admin), in force since before the earliest occurrence.
SELECT pg_temp.c_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'),
 'required_inputs',jsonb_build_array(jsonb_build_object('key','pads_ok','label','Pads in date','type','boolean','required',true),jsonb_build_object('key','battery_pct','label','Battery','type','number','required',true,'min',0,'max',100)))) FROM cf;
INSERT INTO cf_results SELECT 'v_fac',public.save_operation_requirement_draft_review(act_fac,jsonb_build_object('title','Generator weekly test','wording','Run the generator.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin','housekeeper'),
 'required_evidence',jsonb_build_array(jsonb_build_object('kind','photo','label','Panel photo','min_count',1,'when','always')))) FROM cf;
INSERT INTO cf_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('nurse','facility_admin'),
 'review_required',true,'allowed_reviewer_roles',jsonb_build_array('facility_admin','owner'))) FROM cf;
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'v\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM cf_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":120}}'::jsonb)) FROM cf;
INSERT INTO cf_results SELECT 'fr_fac',public.save_operation_facility_requirement_draft_review(act_fac,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_fac'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"08:00"}}'::jsonb)) FROM cf;
INSERT INTO cf_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM cf;
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'fr\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM cf_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO cf_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',since) FROM cf;
INSERT INTO cf_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"admin_log","reason":"Weight review roster"}',since) FROM cf;
RESET ROLE;
-- Occurrences from the service generator: the week of the past-due date (d0) and the following weeks (d1, d2) for both AEDs, one event occurrence per AED
-- overlapping d0 (minted below), the generator run for the site and the resident; asset 1's overlapping occurrence is cancelled so a record performed on d0
-- matches exactly one occurrence of asset 1 and two of asset 2.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
INSERT INTO cf_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_asset'),
 jsonb_build_array(pg_temp.occ(d0,'America/New_York',hh0,120),pg_temp.occ(d1,'America/New_York','10:00',120),pg_temp.occ(d2,'America/New_York','10:00',120)),pg_temp.run('run-asset',d0,d2,pg_temp.rid('fr_asset'))) FROM cf;
INSERT INTO cf_results SELECT 'g_fac',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_fac'),
 jsonb_build_array(pg_temp.occ(d0,'America/New_York',hh0),pg_temp.occ(d1,'America/New_York','08:00')),pg_temp.run('run-fac',d0,d1,pg_temp.rid('fr_fac'))) FROM cf;
INSERT INTO cf_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_res'),
 jsonb_build_array(pg_temp.occ(d0,'America/New_York',hh0),pg_temp.occ(d1,'America/New_York','09:00')),pg_temp.run('run-res',d0,d1,pg_temp.rid('fr_res'))) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->'counts'->>'created')::int=6 FROM cf_results WHERE label='g_asset') AND (SELECT (result->'counts'->>'created')::int=2 FROM cf_results WHERE label='g_fac')
 AND (SELECT (result->'counts'->>'created')::int=2 FROM cf_results WHERE label='g_res'),'occurrences not generated');
-- The structural overlap the predicate must handle: the 340 generator never overlaps two scheduled periods of one subject, but an event-created occurrence
-- (COL-139 `event` kind) may cover the same days. One is minted per AED here as the owner-run commands would, with a period starting on d0.
RESET ROLE;
SELECT pg_temp.c_clear();
DO $$ DECLARE f cf; src public.operation_task_instances; BEGIN
 SELECT * INTO f FROM cf;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 FOR src IN SELECT t.* FROM public.operation_task_instances t WHERE t.activity_id=f.act_asset AND t.assigned_shift_date=f.d0 LOOP
  INSERT INTO public.operation_task_instances SELECT (jsonb_populate_record(src,jsonb_build_object('id',gen_random_uuid(),'occurrence_kind','event','source_event_key','probe-event','source_event_id','E-'||src.subject_id,
   'source_event_at',((f.dp1::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York'),'governing_at',((f.dp1::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York'),
   'due_at',((f.dp1::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York'),'grace_ends_at',((f.dp1::timestamp+'12:00'::time) AT TIME ZONE 'America/New_York'),
   'assigned_shift_date',f.dp1,'period_key','probe-event:E-'||src.subject_id,'period_start_date',f.d0,'period_end_date',f.d0+7,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
 END LOOP;
 PERFORM set_config('haven.operation_occurrence_command','',true);
END $$;
INSERT INTO cf_ids SELECT 'occ_a1_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('dp1',cf.dp1),('d0',cf.d0),('d1',cf.d1),('d2',cf.d2)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_asset1 AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_a2_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('dp1',cf.dp1),('d0',cf.d0),('d1',cf.d1),('d2',cf.d2)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_asset2 AND t.assigned_shift_date=x.d;
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
INSERT INTO cf_ids SELECT 'occ_fac_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d0',cf.d0),('d1',cf.d1)) x(n,d) JOIN public.operation_task_instances t ON t.activity_id=cf.act_fac AND t.assigned_shift_date=x.d;
INSERT INTO cf_ids SELECT 'occ_res_'||n,t.id FROM cf CROSS JOIN LATERAL (VALUES('d0',cf.d0),('d1',cf.d1)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=cf.subj_res1 AND t.assigned_shift_date=x.d;
SELECT pg_temp.c_assert((SELECT count(*)=12 FROM cf_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
-- Asset 1's overlapping occurrence is cancelled so that only its d0 occurrence covers the performed date; asset 2 keeps both.
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cancel_a1_dp1',public.cancel_operation_occurrence_review(pg_temp.rid('occ_a1_dp1'),'Fixture: overlapping week withdrawn',pg_temp.k('cancel-a1-dp1'));
RESET ROLE;
-- Source records: an asset check performed at the past-due instant and recorded ten minutes later by maintenance (routine timing), a generator test by the aide, a weight review by the nurse.
SELECT pg_temp.src('aed-1','1','final',site_a,act_asset,'asset',asset1,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-2','1','final',site_a,act_asset,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due,'{"pads_ok":true,"battery_pct":80}')) FROM cf;
SELECT pg_temp.src('gen-1','1','final',site_a,act_fac,'facility',NULL,aide,past_due+interval '5 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','note','Ran fine')) FROM cf;
SELECT pg_temp.src('wt-1','1','final',site_a,act_res,'resident',res1,nurse,past_due+interval '5 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','note','Weight stable')) FROM cf;
-- FIXTURES-END

-- 1. A final matching record satisfies exactly its occurrence once: receipt with the source columns, the source author as recorder, occurrence completed, audit written.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_aed1',pg_temp.deliver('aed1-000001','probe-asset','aed-1','1','final',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'ev_aed1',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_aed1';
INSERT INTO cf_ids SELECT 'r_aed1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='del_aed1';
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'event'->>'state'='satisfied' AND (result->'event'->>'attention')::boolean=false AND result->'event'->>'reason' IS NULL
 AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_a1_d0') AND (result->'event'->>'receipt_id')::uuid=pg_temp.rid('r_aed1') AND result->'event'->>'delivery_kind'='session' AND (result->'event'->>'delivered_by')::uuid=(SELECT admin_a FROM cf)
 AND (result->'event'->>'subject_id')::uuid=(SELECT subj_asset1 FROM cf) AND result->'event'->>'authority_class'='asset' AND (result->'event'->>'activity_id')::uuid=(SELECT act_asset FROM cf)
 AND result->'occurrence'->>'status'='completed' AND result->'occurrence'->>'execution_state'='completed'
 AND result->'receipt'->>'receipt_kind'='performance' AND (result->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM cf) AND result->'receipt'->>'recorder_role'='maintenance_role'
 AND result->'receipt'->>'performer_kind'='self' AND result->'receipt'->>'entry_kind'='routine' AND result->'receipt'->>'completion_state'='completed'
 AND result->'receipt'->>'source_key'='probe-asset' AND result->'receipt'->>'source_record_id'='aed-1' AND result->'receipt'->>'source_record_version'='1' AND (result->'receipt'->>'source_event_id')::uuid=pg_temp.rid('ev_aed1')
 AND (result->'receipt'->>'performed_at')::timestamptz=(SELECT past_due FROM cf) AND result->'receipt'->'values'='{"pads_ok":true,"battery_pct":90}'::jsonb
 FROM cf_results WHERE label='del_aed1'),'final matching source did not satisfy its occurrence');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['candidates','event','occurrence','receipt','replayed'] FROM jsonb_object_keys(pg_temp.res('del_aed1')) k),'delivery reply keys drifted');
SELECT pg_temp.c_assert((SELECT jsonb_array_length(result->'candidates')=1 AND NOT (result->'candidates' ? pg_temp.rid('occ_a1_dp1')::text) FROM cf_results WHERE label='del_aed1'),'a cancelled occurrence was a candidate');
SELECT pg_temp.c_assert((SELECT effective_receipt_id=pg_temp.rid('r_aed1') AND status='completed' AND execution_state='completed' AND signed_by=(SELECT maint FROM cf) AND verified_by=(SELECT maint FROM cf) AND completed_at IS NOT NULL
 AND performed_at=(SELECT past_due FROM cf) AND sla_met=true AND completion_notes='From the source log' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d0')),'occurrence projection not written by the source');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_a1_d0')),'more than one receipt for the source occurrence');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_a1_d0') AND event_type='source_linked' AND actor_id=(SELECT admin_a FROM cf)
 AND (event_data->>'source_event_id')::uuid=pg_temp.rid('ev_aed1') AND event_data->>'source_key'='probe-asset' AND event_data->>'source_record_version'='1' AND (event_data->>'receipt_id')::uuid=pg_temp.rid('r_aed1')),'source_linked audit row missing');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_a1_d0') AND event_type='completed' AND (event_data->>'receipt_id')::uuid=pg_temp.rid('r_aed1') AND (event_data->>'recorder_id')::uuid=(SELECT maint FROM cf)),'completed audit row missing');
SELECT pg_temp.c_assert((SELECT request_key=pg_temp.k('aed1-000001') AND snapshot->>'version'='1' AND snapshot->>'finality'='final' FROM public.operation_source_events WHERE id=pg_temp.rid('ev_aed1')),'ledger row did not keep the snapshot');
-- 1a. Replay by the same key returns the same row; the same version under another key converges too; a different content under the same key conflicts; nothing new is written.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_aed1_replay',pg_temp.deliver('aed1-000001','probe-asset','aed-1','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'event'->>'id')::uuid=pg_temp.rid('ev_aed1') AND (result->'receipt'->>'id')::uuid=pg_temp.rid('r_aed1') FROM cf_results WHERE label='del_aed1_replay'),'replay did not return the one delivery');
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['candidates','event','occurrence','receipt','replayed'] FROM jsonb_object_keys(pg_temp.res('del_aed1_replay')) k),'replay reply keys drifted');
INSERT INTO cf_results SELECT 'del_aed1_again',pg_temp.deliver('aed1-000002','probe-asset','aed-1','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'event'->>'id')::uuid=pg_temp.rid('ev_aed1') AND result->'event'->>'request_key'=pg_temp.k('aed1-000001') FROM cf_results WHERE label='del_aed1_again'),'a second delivery of the same version did not converge');
SELECT pg_temp.c_expect($q$SELECT pg_temp.deliver('aed1-000001','probe-asset','aed-1','1','voided',(SELECT site_a FROM cf))$q$,'already saved with different content');
RESET ROLE;
-- The service converges on the same row too, under its own key.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
INSERT INTO cf_results SELECT 'del_aed1_service',pg_temp.deliver_service('aed1-svc-0001','probe-asset','aed-1','1','final',site_a,org) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'event'->>'id')::uuid=pg_temp.rid('ev_aed1') FROM cf_results WHERE label='del_aed1_service'),'service delivery of the same version did not converge');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_source_events WHERE source_record_id='aed-1') AND (SELECT count(*)=1 FROM public.operation_execution_receipts WHERE source_record_id='aed-1'),'replay or convergence created a row');
-- The session wrapper refuses the service identity and the service wrapper refuses a session.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.c_denied($q$SELECT pg_temp.deliver('aed1-wrong-0001','probe-asset','aed-1','1','final',(SELECT site_a FROM cf))$q$);
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_service(pg_temp.k('aed1-svc-0002'),jsonb_build_object('source_key','probe-asset','source_record_id','aed-1','source_record_version','1','event_kind','final','facility_id',(SELECT site_a FROM cf)))$q$,'organization_id is required');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT pg_temp.deliver_service('aed1-svc-0003','probe-asset','aed-1','1','final',(SELECT site_a FROM cf),(SELECT org FROM cf))$q$);
-- Shape: payload rules raise before any row exists.
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_review('short',jsonb_build_object('source_key','probe-asset','source_record_id','aed-1','source_record_version','1','event_kind','final','facility_id',(SELECT site_a FROM cf)))$q$,'request key is required');
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_review(pg_temp.k('shape-000001'),'{"source_key":"probe-asset","source_record_id":"aed-1","source_record_version":"1","event_kind":"final","facility_id":"x"}')$q$,'facility_id must be a uuid');
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_review(pg_temp.k('shape-000002'),jsonb_build_object('source_key','probe-asset','source_record_id','aed-1','source_record_version','1','event_kind','final','facility_id',(SELECT site_a FROM cf),'extra',1))$q$,'not editable');
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_review(pg_temp.k('shape-000003'),jsonb_build_object('source_key','probe-asset','source_record_id','aed-1','source_record_version','1','event_kind','maybe','facility_id',(SELECT site_a FROM cf)))$q$,'event_kind must be final or voided');
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_review(pg_temp.k('shape-000004'),jsonb_build_object('source_key','Probe Asset','source_record_id','aed-1','source_record_version','1','event_kind','final','facility_id',(SELECT site_a FROM cf)))$q$,'source_key must be a slug');
SELECT pg_temp.c_expect($q$SELECT public.deliver_operation_source_event_review(pg_temp.k('shape-000005'),jsonb_build_object('source_key','probe-asset','source_record_id','aed-1','source_record_version','1','event_kind','final','facility_id',(SELECT site_a FROM cf),'organization_id',gen_random_uuid()))$q$,'organization_id does not match');
SELECT pg_temp.c_expect($q$SELECT pg_temp.deliver('shape-000006','not-registered','aed-1','1','final',(SELECT site_a FROM cf))$q$,'not allowlisted');
SELECT pg_temp.c_expect($q$SELECT pg_temp.deliver('shape-000007','probe-asset','aed 1','1','final',(SELECT site_a FROM cf))$q$,'source_record_id must be a stable identifier');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_source_events),'a shape refusal wrote a ledger row');
RESET ROLE;

-- 2. Wrong period, site, subject, draft, stale, missing, voided-for-final, non-allowlisted activity and a broken reader: each is a recorded refusal or a visible pending row; no receipt.
SELECT pg_temp.src('aed-draft','1','draft',site_a,act_asset,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-void','1','voided',site_a,act_asset,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-siteb','1','final',site_b,act_asset,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-unenrolled','1','final',site_a,act_asset,'asset',asset3,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-otheract','1','final',site_a,act_other,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-reskind','1','final',site_a,act_asset,'resident',res1,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.src('aed-offperiod','1','final',site_a,act_asset,'asset',asset2,maint,past_due-interval '40 days'+interval '10 minutes',pg_temp.stmt(past_due-interval '40 days')) FROM cf;
SELECT pg_temp.src('wt-badstmt','1','final',site_a,act_res,'resident',res1,nurse,past_due+interval '10 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','values',jsonb_build_object('weight_lb',150))) FROM cf;
SELECT pg_temp.src('wt-lateunstated','1','final',site_a,act_res,'resident',res1,nurse,past_due+interval '3 hours',jsonb_build_object('performed_at',past_due,'outcome','performed')) FROM cf;
SELECT pg_temp.src('wt-aide','1','final',site_a,act_res,'resident',res1,aide,past_due+interval '10 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed')) FROM cf;
SELECT pg_temp.src('wt-stranger','1','final',site_a,act_res,'resident',res1,gen_random_uuid(),past_due+interval '10 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed')) FROM cf;
SELECT pg_temp.src('aed-unknownfield','1','final',site_a,act_asset,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due),'{"surprise":true}'::jsonb) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_draft',pg_temp.deliver('draft-000001','probe-asset','aed-draft','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_void',pg_temp.deliver('void-000001','probe-asset','aed-void','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_stale',pg_temp.deliver('stale-000001','probe-asset','aed-2','0','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_missing',pg_temp.deliver('missing-00001','probe-asset','aed-nope','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_siteb',pg_temp.deliver('siteb-000001','probe-asset','aed-siteb','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_unenrolled',pg_temp.deliver('unenrolled-01','probe-asset','aed-unenrolled','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_otheract',pg_temp.deliver('otheract-0001','probe-asset','aed-otheract','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_reskind',pg_temp.deliver('reskind-00001','probe-asset','aed-reskind','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_offperiod',pg_temp.deliver('offperiod-001','probe-asset','aed-offperiod','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_badstmt',pg_temp.deliver('badstmt-00001','probe-res','wt-badstmt','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_lateunstated',pg_temp.deliver('lateunst-0001','probe-res','wt-lateunstated','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_aide',pg_temp.deliver('aide-000001','probe-res','wt-aide','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_stranger',pg_temp.deliver('stranger-0001','probe-res','wt-stranger','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_unknownfield',pg_temp.deliver('unknownf-0001','probe-asset','aed-unknownfield','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_broken',pg_temp.deliver('broken-000001','probe-broken','aed-2','1','final',site_a) FROM cf;
INSERT INTO cf_results SELECT 'del_voidnothing',pg_temp.deliver('voidnone-0001','probe-asset','aed-void','1','voided',site_a) FROM cf;
RESET ROLE;
SELECT pg_temp.c_assert((SELECT bool_and(result->'event'->>'state'=x.state AND result->'event'->>'reason'=x.reason AND (result->'event'->>'attention')::boolean=x.attention AND jsonb_typeof(result->'receipt')='null' AND (result->>'replayed')::boolean=false)
 FROM cf_results r JOIN (VALUES('del_draft','refused','source_not_final',false),('del_void','refused','source_voided',false),('del_stale','refused','source_version_changed',false),('del_missing','refused','record_missing',false),
  ('del_siteb','refused','facility_mismatch',false),('del_unenrolled','unmatched','subject_not_enrolled',true),('del_otheract','refused','activity_not_allowlisted',false),('del_reskind','refused','subject_kind_mismatch',false),
  ('del_offperiod','unmatched','no_candidate',true),('del_badstmt','refused','statement_invalid',false),('del_lateunstated','refused','statement_invalid',false),('del_aide','refused','recorder_not_authorized',true),
  ('del_stranger','refused','recorder_unknown',false),('del_unknownfield','refused','reader_failed',true),('del_broken','refused','reader_failed',true),('del_voidnothing','refused','nothing_to_invalidate',false)) x(label,state,reason,attention) ON x.label=r.label),
 'a refused or pending delivery did not record its reason');
SELECT pg_temp.c_assert((SELECT result->'event'->>'detail' LIKE 'Recorded values are invalid: value weight_lb is not a defined input%' FROM cf_results WHERE label='del_badstmt') AND (SELECT result->'event'->>'detail' LIKE '%entered as late%' FROM cf_results WHERE label='del_lateunstated')
 AND (SELECT result->'event'->>'detail' LIKE '%probe reader is broken%' FROM cf_results WHERE label='del_broken') AND (SELECT result->'event'->>'detail' LIKE '%unknown field surprise%' FROM cf_results WHERE label='del_unknownfield'),'refusal detail lost the statement wording');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE source_event_id IS NOT NULL),'a refused or pending delivery wrote a receipt');
SELECT pg_temp.c_assert((SELECT bool_and(status='pending' AND execution_state='none') FROM public.operation_task_instances WHERE id IN(pg_temp.rid('occ_a2_d0'),pg_temp.rid('occ_a2_dp1'),pg_temp.rid('occ_res_d0'))),'a refused delivery touched an occurrence');
SELECT pg_temp.c_assert((SELECT (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_res_d0') FROM cf_results WHERE label='del_aide') AND (SELECT count(*)=4 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_res_d0') AND event_type='source_pending'),'refusals on a matched occurrence were not recorded against it');
SELECT pg_temp.c_assert((SELECT count(*)=17 FROM public.operation_source_events),'ledger count drifted after refusals');
-- Rows without a resolved subject keep only identity and finality of the record: no author, native subject id or statement (they are readable under site access alone).
SELECT pg_temp.c_assert((SELECT bool_and((snapshot->>'redacted')::boolean AND NOT (snapshot ? 'statement') AND NOT (snapshot ? 'recorded_by') AND NOT (snapshot->'subject' ? 'id'))
 FROM public.operation_source_events WHERE subject_id IS NULL AND snapshot IS NOT NULL),'a delivery without a resolved subject kept protected content');
SELECT pg_temp.c_assert((SELECT snapshot ? 'statement' AND snapshot ? 'recorded_by' FROM public.operation_source_events WHERE id=pg_temp.rid('ev_aed1')),'a resolved delivery lost its snapshot');
SELECT pg_temp.c_assert((SELECT snapshot->>'exists'='false' AND NOT (snapshot ? 'statement') FROM cf_results r JOIN public.operation_source_events e ON e.id=(r.result->'event'->>'id')::uuid WHERE r.label='del_missing'),'a missing record left content');
-- A refused delivery never occupies the record version: the same stale version delivered again is a new refusal, not a replay; an attention refusal is superseded by the next attempt.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_stale_again',pg_temp.deliver('stale-000002','probe-asset','aed-2','0','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'event'->>'reason'='source_version_changed' AND (result->'event'->>'id')::uuid<>(pg_temp.res('del_stale')->'event'->>'id')::uuid FROM cf_results WHERE label='del_stale_again'),'a refused delivery blocked a later delivery of the same version');
INSERT INTO cf_results SELECT 'del_aide_again',pg_temp.deliver('aide-000002','probe-res','wt-aide','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'event'->>'reason'='recorder_not_authorized' AND (result->'event'->>'attention')::boolean FROM cf_results WHERE label='del_aide_again'),'a second attempt at an attention refusal did not run');
SELECT pg_temp.c_assert((SELECT attention=false AND detail LIKE '%superseded by a later delivery)' FROM public.operation_source_events WHERE id=(pg_temp.res('del_aide')->'event'->>'id')::uuid),'the earlier attention refusal was not superseded');
RESET ROLE;
-- A record performed in the future cannot be final: the statement refuses it.
SELECT pg_temp.src('aed-future','1','final',site_a,act_asset,'asset',asset2,maint,clock_timestamp()+interval '1 day',pg_temp.stmt(clock_timestamp()+interval '1 day')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_future',pg_temp.deliver('future-000001','probe-asset','aed-future','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='statement_invalid' AND result->'event'->>'detail'='Performed time cannot be in the future' AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_future'),'a future record satisfied an occurrence');
-- The other site's administrator cannot deliver for site A and sees none of its ledger.
RESET ROLE;
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT pg_temp.deliver('siteb-admin-01','probe-asset','aed-2','1','final',(SELECT site_a FROM cf))$q$);
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_source_events) AND (SELECT count(*)=0 FROM public.operation_source_adapters WHERE organization_id<>haven.organization_id()),'the other site sees deliveries');
RESET ROLE;
-- An aide who cannot record resident work cannot deliver a resident record, not even a stale version whose refusal would carry the live snapshot: denied before the reader runs.
SELECT pg_temp.c_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT pg_temp.deliver('aide-res-0001','probe-res','wt-1','1','final',(SELECT site_a FROM cf))$q$);
SELECT pg_temp.c_denied($q$SELECT pg_temp.deliver('aide-res-0002','probe-res','wt-1','0','final',(SELECT site_a FROM cf))$q$);
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_source_events WHERE source_key='probe-res'),'a denied aide can read resident deliveries');
RESET ROLE;
-- The other site's administrator claiming their own site for a site-A record converges on nothing and reads nothing: the row is a redacted facility_mismatch refusal at site B.
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT pg_temp.deliver('aed1-siteb-001','probe-asset','aed-1','1','final',(SELECT site_b FROM cf))$q$);
INSERT INTO cf_results SELECT 'del_draft_siteb',pg_temp.deliver('draft-siteb-01','probe-asset','aed-draft','1','final',site_b) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'event'->>'reason'='facility_mismatch' AND (result->'event'->'snapshot'->>'redacted')::boolean AND NOT (result->'event'->'snapshot' ? 'statement') AND NOT (result->'event'->'snapshot' ? 'recorded_by') AND jsonb_typeof(result->'receipt')='null' AND jsonb_typeof(result->'occurrence')='null'
 FROM cf_results WHERE label='del_draft_siteb'),'another site read a site-A record through a refusal');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(facility_id=(SELECT site_b FROM cf)) FROM public.operation_source_events),'another site sees site-A deliveries');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_source_events WHERE source_record_id='wt-1'),'a denied delivery left a row');

-- 3. Ambiguity: asset 2's record performed on d0 matches two occurrences; select resolves it only among candidates; a non-candidate is refused; a stale revision conflicts.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_aed2',pg_temp.deliver('aed2-000001','probe-asset','aed-2','1','final',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'ev_aed2',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_aed2';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='ambiguous' AND result->'event'->>'reason'='several_candidates' AND (result->'event'->>'attention')::boolean AND jsonb_array_length(result->'candidates')=2
 AND result->'candidates' ? pg_temp.rid('occ_a2_d0')::text AND result->'candidates' ? pg_temp.rid('occ_a2_dp1')::text AND result->'event'->>'task_instance_id' IS NULL AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_aed2'),'two covering occurrences were not reported as ambiguous');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0001'),pg_temp.erev('ev_aed2'),jsonb_build_object('action','select','occurrence_id',pg_temp.rid('occ_a1_d1')))$q$,'not a candidate');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0002'),repeat('a',64),jsonb_build_object('action','select','occurrence_id',pg_temp.rid('occ_a2_d0')))$q$,'Event changed since it was read','current_event_revision='||pg_temp.erev('ev_aed2'),'P0001');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0003'),pg_temp.erev('ev_aed2'),'{"action":"select"}')$q$,'select requires occurrence_id');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0003'),pg_temp.erev('ev_aed2'),'{"action":"dismiss"}')$q$,'dismiss reason is required');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0003'),pg_temp.erev('ev_aed2'),'{"action":"retry","occurrence_id":"00000000-0000-4000-8000-000000000000"}')$q$,'applies to select only');
SELECT pg_temp.c_assert((SELECT state='ambiguous' AND attention FROM public.operation_source_events WHERE id=pg_temp.rid('ev_aed2')) AND (SELECT count(*)=0 FROM public.operation_source_event_attempts),'a refused reconcile changed the event or left an attempt');
INSERT INTO cf_results VALUES('erev_aed2_before',to_jsonb(pg_temp.erev('ev_aed2')));
INSERT INTO cf_results SELECT 'rec_aed2',public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0010'),pg_temp.erev('ev_aed2'),jsonb_build_object('action','select','occurrence_id',pg_temp.rid('occ_a2_d0')));
INSERT INTO cf_ids SELECT 'r_aed2',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_aed2';
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean=false AND result->'event'->>'state'='satisfied' AND (result->'event'->>'attention')::boolean=false AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_a2_d0')
 AND (result->'event'->>'reconciled_by')::uuid=(SELECT admin_a FROM cf) AND result->'event'->>'reconciled_at' IS NOT NULL AND result->'receipt'->>'source_record_id'='aed-2' AND result->'occurrence'->>'status'='completed' FROM cf_results WHERE label='rec_aed2'),'select did not satisfy the chosen candidate');
SELECT pg_temp.c_assert((SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_dp1')),'select touched the other candidate');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(action='select' AND from_state='ambiguous' AND to_state='satisfied' AND actor_id=(SELECT admin_a FROM cf) AND (outcome->>'occurrence_id')::uuid=pg_temp.rid('occ_a2_d0')) FROM public.operation_source_event_attempts WHERE event_id=pg_temp.rid('ev_aed2')),'select attempt not recorded');
-- Reconcile replay and the settled guard.
INSERT INTO cf_results SELECT 'rec_aed2_replay',public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0010'),pg_temp.res('erev_aed2_before')#>>'{}',jsonb_build_object('action','select','occurrence_id',pg_temp.rid('occ_a2_d0')));
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND result->'event'->>'state'='satisfied' FROM cf_results WHERE label='rec_aed2_replay'),'reconcile replay did not return the same outcome');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0010'),pg_temp.erev('ev_aed2'),'{"action":"retry"}')$q$,'already saved with different content');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-aed2-0011'),pg_temp.erev('ev_aed2'),'{"action":"retry"}')$q$,'Source delivery is settled');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_source_event_attempts WHERE event_id=pg_temp.rid('ev_aed2')),'a refused reconcile left an attempt');
RESET ROLE;
-- Reconcile authority: maintenance (not in the broad operations scope) and the other site are refused; the pending list is site-scoped under RLS.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-maint-0001'),pg_temp.erev('ev_aed2'),'{"action":"retry"}')$q$);
SELECT pg_temp.c_assert((SELECT count(*)>=2 FROM public.operation_source_events WHERE attention),'maintenance cannot see the pending list at its site');
RESET ROLE;
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_aed2'),pg_temp.k('rec-b-000001'),repeat('a',64),'{"action":"retry"}')$q$);
RESET ROLE;
-- Dismiss with a reason closes a pending row and touches no occurrence; the dismissed row is settled.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_ids SELECT 'ev_offperiod',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_offperiod';
INSERT INTO cf_results SELECT 'rec_offperiod',public.reconcile_operation_source_event_review(pg_temp.rid('ev_offperiod'),pg_temp.k('rec-off-000001'),pg_temp.erev('ev_offperiod'),'{"action":"dismiss","reason":"Record predates the schedule"}');
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='dismissed' AND (result->'event'->>'attention')::boolean=false AND jsonb_typeof(result->'occurrence')='null' AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='rec_offperiod'),'dismiss did not settle the row');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_offperiod'),pg_temp.k('rec-off-000002'),pg_temp.erev('ev_offperiod'),'{"action":"retry"}')$q$,'Source delivery is settled');
-- Retry of an unenrolled subject after the binding exists finds the occurrence.
INSERT INTO cf_ids SELECT 'ev_unenrolled',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_unenrolled';
INSERT INTO cf_results SELECT 'rec_unenrolled_still',public.reconcile_operation_source_event_review(pg_temp.rid('ev_unenrolled'),pg_temp.k('rec-unen-00001'),pg_temp.erev('ev_unenrolled'),'{"action":"retry"}');
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='unmatched' AND result->'event'->>'reason'='subject_not_enrolled' AND (result->'event'->>'attention')::boolean FROM cf_results WHERE label='rec_unenrolled_still'),'retry without enrolment did not stay pending');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(from_state='unmatched' AND to_state='unmatched') FROM public.operation_source_event_attempts WHERE event_id=pg_temp.rid('ev_unenrolled')),'retry attempt not recorded');
RESET ROLE;

-- 4. A human receipt on the target makes a delivery a conflict; nothing is overwritten; the conflict names the occurrence and writes source_pending.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_human_fac',public.record_operation_work_review(pg_temp.rid('occ_fac_d0'),pg_temp.k('human-fac-0001'),'{"outcome":"performed","note":"Done by hand"}');
INSERT INTO cf_ids SELECT 'r_human_fac',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_human_fac';
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_gen1',pg_temp.deliver('gen1-000001','probe-site','gen-1','1','final',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'ev_gen1',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_gen1';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='conflict' AND result->'event'->>'reason'='already_recorded' AND (result->'event'->>'attention')::boolean AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fac_d0')
 AND result->'event'->>'detail' LIKE '%a person%' AND jsonb_typeof(result->'receipt')='null' AND result->'occurrence'->>'execution_state'='performed_missing_evidence' FROM cf_results WHERE label='del_gen1'),'a human receipt was not reported as a conflict');
SELECT pg_temp.c_assert((SELECT effective_receipt_id=pg_temp.rid('r_human_fac') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fac_d0')),'a source delivery overwrote a human receipt');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_fac_d0') AND event_type='source_pending' AND event_data->>'state'='conflict' AND (event_data->>'current_receipt_id')::uuid=pg_temp.rid('r_human_fac')),'source_pending audit row missing');
-- After the person reverses their work, a retry lets the source satisfy: evidence-requiring work from a source is performed with missing evidence, never completed.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rev_human_fac',public.reverse_operation_work_review(pg_temp.rid('occ_fac_d0'),pg_temp.k('rev-fac-000001'),pg_temp.rid('r_human_fac'),pg_temp.rev('r_human_fac'),'{"reason":"Recorded on the wrong week"}');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_gen1',public.reconcile_operation_source_event_review(pg_temp.rid('ev_gen1'),pg_temp.k('rec-gen1-0001'),pg_temp.erev('ev_gen1'),'{"action":"retry"}');
INSERT INTO cf_ids SELECT 'r_gen1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_gen1';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='satisfied' AND (result->'event'->>'attention')::boolean=false AND result->'receipt'->>'completion_state'='performed_missing_evidence' AND result->'receipt'->>'evidence_status'='missing'
 AND (result->'receipt'->>'recorder_id')::uuid=(SELECT aide FROM cf) AND result->'occurrence'->>'status'='in_progress' AND result->'occurrence'->>'execution_state'='performed_missing_evidence' FROM cf_results WHERE label='rec_gen1'),'source did not satisfy as performed-with-missing-evidence after the reversal');
SELECT pg_temp.c_assert((SELECT (SELECT chain_id FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_gen1'))<>(SELECT chain_id FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_human_fac'))),'the source receipt joined the reversed chain');
SELECT pg_temp.c_assert((SELECT count(*)=3 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_fac_d0')),'the reversed human chain was not retained');
RESET ROLE;

-- 5. A corrected source version supersedes the earlier source receipt as a correction, keeps the corrected receipt verbatim, reopens review when the rule requires it.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_wt1',pg_temp.deliver('wt1-000001','probe-res','wt-1','1','final',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'r_wt1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='del_wt1';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='satisfied' AND result->'receipt'->>'completion_state'='awaiting_verification' AND (result->'receipt'->>'recorder_id')::uuid=(SELECT nurse FROM cf) AND result->'occurrence'->>'execution_state'='awaiting_verification' FROM cf_results WHERE label='del_wt1'),'review-required source work is not awaiting verification');
INSERT INTO cf_results SELECT 'ver_wt1',public.verify_operation_work_review(pg_temp.rid('occ_res_d0'),pg_temp.k('ver-wt1-00001'),jsonb_build_object('decision','verified','receipt_id',pg_temp.rid('r_wt1'),'receipt_revision',pg_temp.rev('r_wt1')));
INSERT INTO cf_ids SELECT 'v_wt1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='ver_wt1';
SELECT pg_temp.c_assert((SELECT status='completed' AND verification_receipt_id=pg_temp.rid('v_wt1') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d0')),'review of the source receipt did not complete the occurrence');
CREATE TEMP TABLE cf_snapshot AS SELECT id receipt_id,to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at'] receipt_json FROM public.operation_execution_receipts r;
GRANT SELECT ON cf_snapshot TO authenticated;
RESET ROLE;
SELECT pg_temp.src('wt-1','2','final',site_a,act_res,'resident',res1,nurse,past_due+interval '20 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','note','Weight down two pounds','entry_kind','late','entry_reason','Corrected in the weight log')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_wt1_v2',pg_temp.deliver('wt1-000002','probe-res','wt-1','2','final',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'r_wt1_v2',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='del_wt1_v2';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='corrected' AND (result->'event'->>'attention')::boolean=false AND (result->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_wt1') AND (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_wt1')
 AND (result->'receipt'->>'correction_seq')::int=1 AND result->'receipt'->>'correction_reason' LIKE 'Source record probe-res wt-1 corrected: version 1 superseded by 2' AND result->'receipt'->>'source_record_version'='2'
 AND result->'receipt'->>'note'='Weight down two pounds' AND result->'receipt'->>'entry_kind'='late' AND result->'receipt'->>'completion_state'='awaiting_verification'
 AND result->'occurrence'->>'execution_state'='awaiting_verification' AND result->'occurrence'->>'status'='in_progress' FROM cf_results WHERE label='del_wt1_v2'),'a corrected version did not supersede the earlier source receipt');
SELECT pg_temp.c_assert((SELECT to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at']=s.receipt_json FROM public.operation_execution_receipts r JOIN cf_snapshot s ON s.receipt_id=r.id WHERE r.id=pg_temp.rid('r_wt1')),'the corrected source receipt was rewritten');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id=pg_temp.rid('r_wt1_v2') FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_wt1')) AND (SELECT superseded_by_receipt_id=pg_temp.rid('r_wt1_v2') FROM public.operation_execution_receipts WHERE id=pg_temp.rid('v_wt1')),'the earlier receipt or its review was not superseded');
SELECT pg_temp.c_assert((SELECT verification_receipt_id IS NULL AND second_sign_by IS NULL AND effective_receipt_id=pg_temp.rid('r_wt1_v2') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d0')),'occurrence did not reopen review after the source correction');
-- The stale first version delivered again after the correction is refused as version changed (its own row already exists, so a fresh key is used with a different record).
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_res_d0') AND event_type='corrected' AND (event_data->>'source_event_id')::uuid=(SELECT id FROM public.operation_source_events WHERE source_record_id='wt-1' AND source_record_version='2')),'corrected audit row missing for the source correction');
-- A source correction of a receipt a person has since corrected is a conflict, never an overwrite.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cor_human_aed1',public.correct_operation_work_review(pg_temp.rid('occ_a1_d0'),pg_temp.k('cor-aed1-00001'),pg_temp.rid('r_aed1'),pg_temp.rev('r_aed1'),'{"reason":"Battery misread","entry_kind":"late","outcome":"performed","values":{"pads_ok":true,"battery_pct":85}}');
RESET ROLE;
INSERT INTO cf_ids SELECT 'c_human_aed1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_human_aed1';
SELECT pg_temp.src('aed-1','2','final',site_a,act_asset,'asset',asset1,maint,past_due+interval '30 minutes',pg_temp.stmt(past_due,'{"pads_ok":true,"battery_pct":88}')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_aed1_v2',pg_temp.deliver('aed1-000003','probe-asset','aed-1','2','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='conflict' AND result->'event'->>'reason'='already_recorded' AND result->'event'->>'detail' LIKE '%a person%' AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_aed1_v2'),'a source correction overwrote a human correction');
SELECT pg_temp.c_assert((SELECT effective_receipt_id=pg_temp.rid('c_human_aed1') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a1_d0')),'human correction lost its effective slot');
RESET ROLE;

-- 6. A void reverses the source receipt into retained history with an attention row; a void after a human correction is source_not_effective; a stale-version final after a void is refused.
SELECT pg_temp.src('wt-1','3','voided',site_a,act_res,'resident',res1,nurse,past_due+interval '40 minutes',NULL) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_wt1_void',pg_temp.deliver('wt1-void-0001','probe-res','wt-1','3','voided',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'ev_wt1_void',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_wt1_void';
INSERT INTO cf_ids SELECT 'x_wt1',(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='del_wt1_void';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='invalidated' AND (result->'event'->>'attention')::boolean AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_res_d0')
 AND result->'receipt'->>'receipt_kind'='reversal' AND result->'receipt'->>'completion_state'='reversed' AND (result->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_wt1_v2') AND (result->'receipt'->>'chain_id')::uuid=pg_temp.rid('r_wt1')
 AND result->'receipt'->>'correction_reason' LIKE 'Source record probe-res wt-1 voided (version 3)' AND result->'receipt'->>'source_record_version'='3'
 AND result->'occurrence'->>'execution_state'='none' AND result->'occurrence'->>'status' IN('pending','missed') FROM cf_results WHERE label='del_wt1_void'),'a void did not reverse the source receipt');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id=pg_temp.rid('x_wt1') FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_wt1_v2')) AND (SELECT to_jsonb(r)-ARRAY['superseded_by_receipt_id','superseded_at']=s.receipt_json FROM public.operation_execution_receipts r JOIN cf_snapshot s ON s.receipt_id=r.id WHERE r.id=pg_temp.rid('r_wt1')),'a void erased or rewrote earlier receipts');
SELECT pg_temp.c_assert((SELECT count(*)=4 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d0')) AND (SELECT effective_receipt_id IS NULL AND performed_at IS NULL AND completed_at IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d0')),'void left a false completion');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_res_d0') AND event_type='source_invalidated' AND (event_data->>'reversed_receipt_id')::uuid=pg_temp.rid('r_wt1_v2') AND event_data->>'reversed_source_record_version'='2')
 AND (SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_res_d0') AND event_type='reversed'),'invalidation audit rows missing');
-- Only dismiss closes an invalidated row; a retry is refused; the invalidated row stays until then.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_wt1_void'),pg_temp.k('rec-wt1v-0001'),pg_temp.erev('ev_wt1_void'),'{"action":"retry"}')$q$,'Source delivery is settled');
INSERT INTO cf_results SELECT 'rec_wt1_void',public.reconcile_operation_source_event_review(pg_temp.rid('ev_wt1_void'),pg_temp.k('rec-wt1v-0002'),pg_temp.erev('ev_wt1_void'),'{"action":"dismiss","reason":"Nurse re-entered the weight"}');
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='dismissed' AND (result->'event'->>'attention')::boolean=false AND (result->'receipt'->>'id')::uuid=pg_temp.rid('x_wt1') FROM cf_results WHERE label='rec_wt1_void'),'dismiss of an invalidated row lost its receipt');
-- The occurrence can be recorded again as a new chain after the void; a later void of the same source finds its receipt no longer effective.
RESET ROLE;
SELECT pg_temp.c_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_human_res',public.record_operation_work_review(pg_temp.rid('occ_res_d0'),pg_temp.k('human-res-0001'),'{"outcome":"performed","note":"Re-entered by hand","entry_kind":"late","entry_reason":"After the void"}');
SELECT pg_temp.c_assert((SELECT (result->'receipt'->>'chain_id')::uuid=(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_human_res'),'re-recording after a void did not start a new chain');
RESET ROLE;
SELECT pg_temp.src('wt-1','4','voided',site_a,act_res,'resident',res1,nurse,past_due+interval '50 minutes',NULL) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_wt1_void2',pg_temp.deliver('wt1-void-0002','probe-res','wt-1','4','voided',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='source_not_effective' AND (result->'event'->>'attention')::boolean AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_res_d0') AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_wt1_void2'),'a second void touched a human recording');
SELECT pg_temp.c_assert((SELECT execution_state='awaiting_verification' AND effective_receipt_id=(SELECT (result->'receipt'->>'id')::uuid FROM cf_results WHERE label='rec_human_res') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_res_d0')),'a refused void changed the occurrence');
-- A void whose source is not voided (reader says final) is refused; a final whose source is voided is refused (the reader is the authority).
INSERT INTO cf_results SELECT 'del_aed2_notvoid',pg_temp.deliver('aed2-nv-00001','probe-asset','aed-2','1','voided',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='source_not_voided' FROM cf_results WHERE label='del_aed2_notvoid'),'a void of a final record was accepted');
RESET ROLE;
-- A void by a person outside the recorder list still invalidates: invalidation is about the record, not the author's role.
SELECT pg_temp.src('aed-2','2','voided',site_a,act_asset,'asset',asset2,aide,past_due+interval '60 minutes',NULL) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_aed2_void',pg_temp.deliver('aed2-void-0001','probe-asset','aed-2','2','voided',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='invalidated' AND (result->'receipt'->>'recorder_id')::uuid=(SELECT aide FROM cf) AND result->'occurrence'->>'status' IN('pending','missed') FROM cf_results WHERE label='del_aed2_void'),'void by the record author was refused');
SELECT pg_temp.c_assert((SELECT status='missed' AND missed_at IS NOT NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d0')),'void of a past-grace occurrence did not return it to missed');
RESET ROLE;

-- 6b. A record satisfies at most one occurrence: a corrected version whose performed date falls in another period invalidates the earlier receipt on the first occurrence and satisfies the second; a void then finds exactly the one effective receipt.
RESET ROLE;
SELECT pg_temp.c_clear();
DO $$ DECLARE f cf; src public.operation_task_instances; BEGIN
 SELECT * INTO f FROM cf;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 SELECT t.* INTO src FROM public.operation_task_instances t WHERE t.activity_id=f.act_fac AND t.assigned_shift_date=f.d0;
 INSERT INTO public.operation_task_instances SELECT (jsonb_populate_record(src,jsonb_build_object('id',gen_random_uuid(),'occurrence_kind','event','source_event_key','probe-event','source_event_id','F-old',
  'source_event_at',((f.d0-1)::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York','governing_at',((f.d0-1)::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York',
  'due_at',((f.d0-1)::timestamp+'10:00'::time) AT TIME ZONE 'America/New_York','grace_ends_at',NULL,'status','pending','execution_state','none','effective_receipt_id',NULL,'verification_receipt_id',NULL,
  'performed_at',NULL,'completed_at',NULL,'signed_by',NULL,'signed_at',NULL,'second_sign_by',NULL,'second_signed_at',NULL,'verified_by',NULL,'verified_at',NULL,'sla_met',NULL,'completion_notes',NULL,'created_by',NULL,'updated_by',NULL,'started_at',NULL,
  'assigned_shift_date',f.d0-1,'period_key','probe-event:F-old','period_start_date',f.d0-7,'period_end_date',f.d0-1,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).*;
 PERFORM set_config('haven.operation_occurrence_command','',true);
END $$;
INSERT INTO cf_ids SELECT 'occ_fac_old',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_fac AND t.period_key='probe-event:F-old';
SELECT pg_temp.src('gen-1','2','final',site_a,act_fac,'facility',NULL,aide,past_due-interval '2 days'+interval '5 minutes',jsonb_build_object('performed_at',past_due-interval '2 days','outcome','performed','note','Date corrected to two days earlier')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_gen1_v2',pg_temp.deliver('gen1-000002','probe-site','gen-1','2','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='satisfied' AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fac_old') AND result->'receipt'->>'source_record_version'='2' AND (result->'receipt'->>'chain_id')::uuid=(result->'receipt'->>'id')::uuid FROM cf_results WHERE label='del_gen1_v2'),'a moved version did not satisfy the other occurrence as a fresh chain');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id IS NOT NULL FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_gen1')) AND (SELECT execution_state='none' AND effective_receipt_id IS NULL AND status IN('pending','missed') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fac_d0')),'the earlier version stayed effective on the first occurrence');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE source_record_id='gen-1' AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'one record has two effective receipts');
SELECT pg_temp.c_assert((SELECT correction_reason LIKE 'Source record probe-site gen-1 version 1 superseded by version 2 covering another occurrence' FROM public.operation_execution_receipts WHERE receipt_kind='reversal' AND corrects_receipt_id=pg_temp.rid('r_gen1')),'the moved reversal lost its reason');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_fac_d0') AND event_type='source_invalidated') AND (SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.rid('occ_fac_old') AND event_type='source_linked' AND (event_data->>'moved_from_task_instance_id')::uuid=pg_temp.rid('occ_fac_d0')),'moved-version audit rows missing');
SELECT pg_temp.src('gen-1','3','voided',site_a,act_fac,'facility',NULL,aide,past_due+interval '90 minutes',NULL) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_gen1_void',pg_temp.deliver('gen1-void-0001','probe-site','gen-1','3','voided',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='invalidated' AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fac_old') FROM cf_results WHERE label='del_gen1_void') AND (SELECT count(*)=0 FROM public.operation_execution_receipts WHERE source_record_id='gen-1' AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'the void left an effective receipt for a voided record');
RESET ROLE;
-- 6c. A deactivated author cannot be the recorder; a broken reader on retry leaves the pending row exactly as it was; the delivery snapshot never changes on retry.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT former,former||'@source.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Former"}'::jsonb FROM (SELECT gen_random_uuid() former,org FROM cf) x;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT u.id,u.email,'Former','maintenance_role'::public.app_role,(SELECT org FROM cf),false FROM auth.users u WHERE u.raw_user_meta_data->>'full_name'='Former';
INSERT INTO cf_ids SELECT 'former',id FROM public.user_profiles WHERE full_name='Former' AND is_active=false;
SELECT pg_temp.src('gen-former','1','final',site_a,act_fac,'facility',NULL,pg_temp.rid('former'),past_due+interval '10 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_former',pg_temp.deliver('former-000001','probe-site','gen-former','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='recorder_not_current' AND (result->'event'->>'attention')::boolean AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_former'),'a deactivated author recorded work');
INSERT INTO cf_ids SELECT 'ev_broken',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_broken';
CREATE TEMP TABLE cf_broken_before AS SELECT to_jsonb(e) j FROM public.operation_source_events e WHERE e.id=pg_temp.rid('ev_broken');
SELECT pg_temp.c_expect($q$SELECT public.reconcile_operation_source_event_review(pg_temp.rid('ev_broken'),pg_temp.k('rec-broken-001'),pg_temp.erev('ev_broken'),'{"action":"retry"}')$q$,'Source reader unavailable');
SELECT pg_temp.c_assert((SELECT to_jsonb(e)=(SELECT j FROM cf_broken_before) FROM public.operation_source_events e WHERE e.id=pg_temp.rid('ev_broken')) AND (SELECT count(*)=0 FROM public.operation_source_event_attempts WHERE event_id=pg_temp.rid('ev_broken')),'a failed reader on retry changed the pending row');
SELECT pg_temp.c_assert((SELECT snapshot=(pg_temp.res('del_unenrolled')->'event'->'snapshot') FROM public.operation_source_events WHERE id=pg_temp.rid('ev_unenrolled')),'the delivery snapshot changed on retry');
RESET ROLE;

-- 6d. An invalid later version moves nothing: with the site occurrence satisfied by a valid version, a version by an author outside the recorder list dated in the other period is refused and the earlier satisfaction stays effective.
SELECT pg_temp.src('gen-2','1','final',site_a,act_fac,'facility',NULL,aide,past_due+interval '5 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','note','Valid first version')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_gen2',pg_temp.deliver('gen2-000001','probe-site','gen-2','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='satisfied' AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fac_d0') FROM cf_results WHERE label='del_gen2'),'gen-2 fixture did not satisfy');
RESET ROLE;
SELECT pg_temp.src('gen-2','2','final',site_a,act_fac,'facility',NULL,nurse,past_due-interval '2 days'+interval '5 minutes',jsonb_build_object('performed_at',past_due-interval '2 days','outcome','performed')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_gen2_v2',pg_temp.deliver('gen2-000002','probe-site','gen-2','2','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='recorder_not_authorized' AND (result->'event'->>'attention')::boolean AND jsonb_typeof(result->'receipt')='null' FROM cf_results WHERE label='del_gen2_v2'),'an invalid later version was not refused');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id IS NULL FROM public.operation_execution_receipts WHERE id=(pg_temp.res('del_gen2')->'receipt'->>'id')::uuid) AND (SELECT execution_state='performed_missing_evidence' AND effective_receipt_id=(pg_temp.res('del_gen2')->'receipt'->>'id')::uuid FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fac_d0')),'an invalid later version stripped the earlier satisfaction');
SELECT pg_temp.c_assert((SELECT execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fac_old')),'an invalid later version touched the other occurrence');
RESET ROLE;
-- 6e. A resolved scope is never dropped from a ledger row: the resident conflict row keeps its subject after a retry that refuses because the source moved on, so its full snapshot stays under resident authority.
SELECT pg_temp.src('wt-9','1','final',site_a,act_res,'resident',res1,nurse,past_due+interval '5 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','note','Private weight note')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_wt9',pg_temp.deliver('wt9-000001','probe-res','wt-9','1','final',site_a) FROM cf;
INSERT INTO cf_ids SELECT 'ev_wt9',(result->'event'->>'id')::uuid FROM cf_results WHERE label='del_wt9';
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='conflict' AND (result->'event'->>'subject_id')::uuid=(SELECT subj_res1 FROM cf) AND result->'event'->'snapshot' ? 'statement' FROM cf_results WHERE label='del_wt9'),'wt-9 fixture is not a resident conflict row');
RESET ROLE;
SELECT pg_temp.src('wt-9','2','final',site_a,act_res,'resident',res1,nurse,past_due+interval '6 minutes',jsonb_build_object('performed_at',past_due,'outcome','performed','note','Private weight note')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'rec_wt9',public.reconcile_operation_source_event_review(pg_temp.rid('ev_wt9'),pg_temp.k('rec-wt9-00001'),pg_temp.erev('ev_wt9'),'{"action":"retry"}');
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='source_version_changed' AND (result->'event'->>'subject_id')::uuid=(SELECT subj_res1 FROM cf) AND result->'event'->>'authority_class'='resident' FROM cf_results WHERE label='rec_wt9'),'a refusing retry dropped the resolved subject scope');
RESET ROLE;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_source_events WHERE id=pg_temp.rid('ev_wt9')) AND (SELECT count(*)=0 FROM public.operation_source_event_attempts WHERE event_id=pg_temp.rid('ev_wt9')),'a site actor without resident scope read a resident delivery after its retry');
RESET ROLE;
-- 6f. A subject that is no longer current: the row keeps no subject and a redacted snapshot, so the site can see and dismiss it.
UPDATE public.facility_assets SET status='retired' WHERE id=(SELECT asset1 FROM cf);
SELECT pg_temp.src('aed-1-retired','1','final',site_a,act_asset,'asset',asset1,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_retired',pg_temp.deliver('retiredasset-1','probe-asset','aed-1-retired','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='unmatched' AND result->'event'->>'reason'='subject_not_current' AND (result->'event'->>'attention')::boolean AND result->'event'->>'subject_id' IS NULL AND (result->'event'->'snapshot'->>'redacted')::boolean FROM cf_results WHERE label='del_retired'),'a retired subject was matched or kept its content');
INSERT INTO cf_results SELECT 'rec_retired',public.reconcile_operation_source_event_review((pg_temp.res('del_retired')->'event'->>'id')::uuid,pg_temp.k('rec-retired-01'),pg_temp.res('del_retired')->'event'->>'revision','{"action":"dismiss","reason":"Asset retired"}');
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='dismissed' FROM cf_results WHERE label='rec_retired'),'a retired-subject row could not be dismissed');
RESET ROLE;
UPDATE public.facility_assets SET status='active' WHERE id=(SELECT asset1 FROM cf);

-- 7. Cancelled occurrences are not candidates: after asset 2's d0 occurrence (returned to missed by the void) is cancelled, a fresh final record performed on d0 matches only the overlapping occurrence.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cancel_a2_d0',public.cancel_operation_occurrence_review(pg_temp.rid('occ_a2_d0'),'Fixture: withdrawn after the void',pg_temp.k('cancel-a2-d0'));
SELECT pg_temp.c_assert((SELECT status='cancelled' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_a2_d0')),'fixture cancellation failed');
RESET ROLE;
SELECT pg_temp.src('aed-2-late','1','final',site_a,act_asset,'asset',asset2,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due,'{"pads_ok":true,"battery_pct":77}')) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'del_aed2_late',pg_temp.deliver('aed2-late-0001','probe-asset','aed-2-late','1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='satisfied' AND jsonb_array_length(result->'candidates')=1 AND (result->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_a2_dp1') AND NOT (result->'candidates' ? pg_temp.rid('occ_a2_d0')::text) FROM cf_results WHERE label='del_aed2_late'),'a cancelled occurrence was a candidate');
RESET ROLE;

-- 8. Guards: no direct DML on the allowlists, ledger, attempts or receipt source columns, with or without the forged settings; no delete or truncate; the token is not readable.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'forged','asset','operation_source_probe_read' FROM cf$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_rules(organization_id,source_key,activity_id) SELECT org,'probe-asset',act_other FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_adapters SET status='retired',retired_at=now() WHERE source_key='probe-asset'$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_events(organization_id,facility_id,source_key,source_record_id,source_record_version,event_kind,delivery_kind,delivered_by,delivered_at,request_key,request_hash,state,revision) SELECT org,site_a,'probe-asset','forged','1','final','session',admin_a,now(),'forged-000001','x','unmatched','x' FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_events SET state='satisfied',attention=false WHERE id=pg_temp.rid('ev_unenrolled')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_events SET attention=false WHERE id=pg_temp.rid('ev_unenrolled')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.operation_source_events WHERE id=pg_temp.rid('ev_unenrolled')$q$);
SELECT pg_temp.c_denied($q$TRUNCATE public.operation_source_events$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_event_attempts(event_id,seq,request_key,request_hash,actor_id,actor_role,at,action,from_state,to_state) SELECT pg_temp.rid('ev_unenrolled'),9,'forged-att-01','x',admin_a,'facility_admin',now(),'dismiss','unmatched','dismissed' FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_execution_receipts SET source_event_id=NULL,source_key=NULL,source_record_id=NULL,source_record_version=NULL WHERE id=pg_temp.rid('r_aed2')$q$);
SELECT pg_temp.c_denied($q$SELECT haven.operation_source_approved()$q$);
SELECT pg_temp.c_denied($q$SELECT haven.deliver_operation_source_event((SELECT org FROM cf),NULL,'service','forged-000002','{}')$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT set_config('haven.operation_source_command','approved',true);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_events SET state='satisfied',attention=false WHERE id=pg_temp.rid('ev_unenrolled')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed',execution_state='completed' WHERE id=pg_temp.rid('occ_a2_d2')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT set_config('haven.operation_source_command','',true);
RESET ROLE;
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.c_denied($q$INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'forged','asset','operation_source_probe_read' FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_events SET state='satisfied',attention=false WHERE id=pg_temp.rid('ev_unenrolled')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed',execution_state='completed',effective_receipt_id=pg_temp.rid('r_aed2') WHERE id=pg_temp.rid('occ_a2_d2')$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT set_config('haven.operation_source_command','approved',true);
SELECT pg_temp.c_denied($q$UPDATE public.operation_task_instances SET status='completed',execution_state='completed',effective_receipt_id=pg_temp.rid('r_aed2') WHERE id=pg_temp.rid('occ_a2_d2')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.operation_source_events SET state='satisfied',attention=false WHERE id=pg_temp.rid('ev_unenrolled')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT set_config('haven.operation_source_command','',true);
RESET ROLE;
-- The owner-run definer with the real token still cannot settle a settled row, re-raise attention, move identity or register through the service path.
DO $$ BEGIN PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true); PERFORM set_config('haven.operation_source_command',haven.operation_occurrence_token(),true); END $$;
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_events SET attention=true WHERE id=pg_temp.rid('ev_aed2')$q$,'attention is cleared once');
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_events SET state='unmatched' WHERE id=pg_temp.rid('ev_aed2')$q$,'Source delivery is settled');
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_events SET source_record_version='9' WHERE id=pg_temp.rid('ev_aed2')$q$,'identity is immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_events SET receipt_id=NULL WHERE id=pg_temp.rid('ev_aed2')$q$,'receipt is immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_events SET detail='x' WHERE id=pg_temp.rid('ev_aed2')$q$,'Source delivery is settled');
SELECT pg_temp.c_expect($q$DELETE FROM public.operation_source_event_attempts$q$,'immutable');
SELECT pg_temp.c_expect($q$UPDATE public.operation_execution_receipts SET source_record_version='9' WHERE id=pg_temp.rid('r_aed2')$q$,'immutable');
SELECT pg_temp.c_service();
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'forged','asset','operation_source_probe_read' FROM cf$q$,'registered by migration only');
SELECT pg_temp.c_clear();
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'no-reader','asset','operation_source_probe_missing' FROM cf$q$,'does not exist');
SELECT pg_temp.c_expect($q$DELETE FROM public.operation_source_rules$q$,'immutable');
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT set_config('haven.operation_source_command','',true);
-- A retired adapter refuses new deliveries but keeps its history readable.
INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'probe-retire','asset','operation_source_probe_read' FROM cf;
UPDATE public.operation_source_adapters SET status='retired',retired_at=now() WHERE source_key='probe-retire';
SELECT pg_temp.c_expect($q$UPDATE public.operation_source_adapters SET status='registered',retired_at=NULL WHERE source_key='probe-retire'$q$,'not re-registered');
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT pg_temp.deliver('retired-00001','probe-retire','aed-2','1','final',(SELECT site_a FROM cf))$q$,'not allowlisted');
RESET ROLE;

-- 9. A forced audit-insert failure inside a savepoint leaves ledger, receipts and occurrences exactly as they were.
CREATE FUNCTION haven.col147_probe_audit_bomb() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN('source_linked','source_invalidated','source_pending') THEN RAISE EXCEPTION 'COL-147 forced audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER col147_probe_audit_bomb BEFORE INSERT ON public.operation_audit_log FOR EACH ROW EXECUTE FUNCTION haven.col147_probe_audit_bomb();
CREATE TEMP TABLE cf_bomb_receipts AS SELECT to_jsonb(r) j FROM public.operation_execution_receipts r;
CREATE TEMP TABLE cf_bomb_events AS SELECT to_jsonb(e) j FROM public.operation_source_events e;
CREATE TEMP TABLE cf_bomb_tasks AS SELECT to_jsonb(t) j FROM public.operation_task_instances t;
SELECT pg_temp.src('aed-2-bomb','1','final',site_a,act_asset,'asset',asset1,maint,past_due+interval '10 minutes',pg_temp.stmt(past_due)) FROM cf;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT pg_temp.deliver('bomb-000001','probe-asset','aed-2-bomb','1','final',(SELECT site_a FROM cf))$q$,'forced audit failure');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT count(*)=(SELECT count(*) FROM cf_bomb_receipts) FROM public.operation_execution_receipts) AND (SELECT count(*)=(SELECT count(*) FROM cf_bomb_events) FROM public.operation_source_events),'a failed audit insert left a receipt or ledger row');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT to_jsonb(t) FROM public.operation_task_instances t EXCEPT SELECT j FROM cf_bomb_tasks),'a failed audit insert changed an occurrence');
DROP TRIGGER col147_probe_audit_bomb ON public.operation_audit_log;
DROP FUNCTION haven.col147_probe_audit_bomb();

-- 10. Reads: the site administrator sees the ledger, attempts and the source receipts in order; generic audit payloads stay hidden; the public RPCs are invokers; earlier probes' invariants hold.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)>=20 FROM public.operation_source_events) AND (SELECT count(*)>=4 FROM public.operation_source_event_attempts) AND (SELECT count(*)=4 FROM public.operation_source_adapters WHERE status='registered'),'site administrator cannot read the ledger');
SELECT pg_temp.c_assert((SELECT array_agg(receipt_kind||':'||coalesce(source_record_version,'-') ORDER BY recorded_at)=ARRAY['performance:1','verification:-','performance:2','reversal:3','performance:-'] FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_res_d0')),'source history not readable in recorded order');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name IN('operation_source_events','operation_source_event_attempts','operation_source_adapters','operation_source_rules')),'generic audit payloads of the ledger leaked');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT bool_and(num_nonnulls(source_event_id,source_key,source_record_id,source_record_version) IN(0,4)) FROM public.operation_execution_receipts),'receipt source columns not set together');
SELECT pg_temp.c_assert((SELECT bool_and((state IN('satisfied','corrected','invalidated') AND receipt_id IS NOT NULL) OR (state='dismissed') OR receipt_id IS NULL) FROM public.operation_source_events),'ledger receipt linkage drifted');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(source_record_id='gen-2') FROM public.operation_execution_receipts r WHERE r.source_event_id IS NOT NULL AND r.receipt_kind='performance' AND r.superseded_by_receipt_id IS NULL AND r.task_instance_id=pg_temp.rid('occ_fac_d0')),'source receipt effective count drifted');
SELECT pg_temp.c_assert((SELECT count(*)=count(DISTINCT (organization_id,source_key,source_record_id)) FROM public.operation_execution_receipts WHERE source_event_id IS NOT NULL AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'a record has more than one effective receipt');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('deliver_operation_source_event_review','deliver_operation_source_event_service','reconcile_operation_source_event_review') AND p.prosecdef),'public source RPC is definer');
SELECT 'COL-147 source link behavior PASS' result;
ROLLBACK;
