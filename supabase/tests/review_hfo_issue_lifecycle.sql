-- COL-144: issue lifecycle on the disposable replay. Proves that an issue is
-- assigned, accepted, covered, waited, resumed, resolved, reopened and linked
-- only through session commands under current site and subject authority,
-- with replay by request key and content, a stale-revision conflict, an
-- immutable event for every transition and an audit row on the linked task;
-- that no lifecycle command touches a receipt or an occurrence; that a
-- backup covers only an absent owner or with a stated reason; and that the
-- backlog shows unassigned, waiting, reassigned and uncovered work with
-- read-time currentness. Authenticated SQL behaviour with synthetic fixtures;
-- not hosted, browser or staff acceptance. Everything rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.i_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-144 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.i_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-144 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.i_expect(stmt text,fragment text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN IF position(fragment IN SQLERRM)>0 THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-144 expected rejection containing "%": %',fragment,stmt;
END $$;

-- Nothing in the migrations assigned, resolved or linked an issue, recorded work, bound a subject or confirmed a schedule.
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_issue_events),'a migration created an issue event');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_issues),'a migration created an issue');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_execution_receipts),'a migration created a receipt');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_activity_bindings),'a migration created a binding');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_facility_requirements WHERE schedule_status='confirmed' OR schedule_rule IS NOT NULL),'a migration stored or confirmed a schedule');

-- FIXTURES-BEGIN
CREATE TEMP TABLE ifx AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() nurse,gen_random_uuid() nurse_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,gen_random_uuid() aide2,gen_random_uuid() aide2_session,gen_random_uuid() former,gen_random_uuid() former_session,
 gen_random_uuid() mgr,gen_random_uuid() mgr_session,gen_random_uuid() mgr2,gen_random_uuid() mgr2_session,gen_random_uuid() fam,gen_random_uuid() fam_session,
 gen_random_uuid() site_b,gen_random_uuid() act_asset,gen_random_uuid() act_res,gen_random_uuid() asset1,gen_random_uuid() asset2,gen_random_uuid() res1,
 gen_random_uuid() subj_asset1,gen_random_uuid() subj_asset2,gen_random_uuid() subj_res1,
 (current_date+((2-extract(dow FROM current_date)::int+7)%7)+7)::date d1,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
ALTER TABLE ifx ADD COLUMN d2 date,ADD COLUMN d3 date;
UPDATE ifx SET d2=d1+7,d3=d1+14;
CREATE TEMP TABLE ifx_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE ifx_results(label text PRIMARY KEY,result jsonb);
CREATE TEMP TABLE ifx_snap(label text PRIMARY KEY,row_json jsonb);
CREATE TEMP TABLE ifx_payload(label text PRIMARY KEY,payload jsonb);
GRANT SELECT ON ifx TO authenticated,service_role; GRANT ALL ON ifx_ids,ifx_results,ifx_snap,ifx_payload TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Issue Site B','Test','Test','00000',1 FROM ifx;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM ifx
 UNION ALL SELECT admin_a,admin_a||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM ifx
 UNION ALL SELECT admin_b,admin_b||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM ifx
 UNION ALL SELECT maint,maint||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM ifx
 UNION ALL SELECT nurse,nurse||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','nurse'),'{"full_name":"Nurse"}'::jsonb FROM ifx
 UNION ALL SELECT aide,aide||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM ifx
 UNION ALL SELECT aide2,aide2||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Second aide"}'::jsonb FROM ifx
 UNION ALL SELECT former,former||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Former aide"}'::jsonb FROM ifx
 UNION ALL SELECT mgr,mgr||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Manager"}'::jsonb FROM ifx
 UNION ALL SELECT mgr2,mgr2||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','manager'),'{"full_name":"Second manager"}'::jsonb FROM ifx
 UNION ALL SELECT fam,fam||'@issue.invalid',jsonb_build_object('organization_id',org,'app_role','family'),'{"full_name":"Family member"}'::jsonb FROM ifx;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@issue.invalid','Corporate','owner'::public.app_role,org,true FROM ifx
 UNION ALL SELECT admin_a,admin_a||'@issue.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM ifx
 UNION ALL SELECT admin_b,admin_b||'@issue.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM ifx
 UNION ALL SELECT maint,maint||'@issue.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM ifx
 UNION ALL SELECT nurse,nurse||'@issue.invalid','Nurse','nurse'::public.app_role,org,true FROM ifx
 UNION ALL SELECT aide,aide||'@issue.invalid','Aide','housekeeper'::public.app_role,org,true FROM ifx
 UNION ALL SELECT aide2,aide2||'@issue.invalid','Second aide','housekeeper'::public.app_role,org,true FROM ifx
 UNION ALL SELECT former,former||'@issue.invalid','Former aide','housekeeper'::public.app_role,org,true FROM ifx
 UNION ALL SELECT mgr,mgr||'@issue.invalid','Manager','manager'::public.app_role,org,true FROM ifx
 UNION ALL SELECT mgr2,mgr2||'@issue.invalid','Second manager','manager'::public.app_role,org,true FROM ifx
 UNION ALL SELECT fam,fam||'@issue.invalid','Family member','family'::public.app_role,org,true FROM ifx
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM ifx UNION ALL SELECT admin_a_session,admin_a FROM ifx UNION ALL SELECT admin_b_session,admin_b FROM ifx
 UNION ALL SELECT maint_session,maint FROM ifx UNION ALL SELECT nurse_session,nurse FROM ifx UNION ALL SELECT aide_session,aide FROM ifx UNION ALL SELECT aide2_session,aide2 FROM ifx
 UNION ALL SELECT former_session,former FROM ifx UNION ALL SELECT mgr_session,mgr FROM ifx UNION ALL SELECT mgr2_session,mgr2 FROM ifx UNION ALL SELECT fam_session,fam FROM ifx;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,revoked_at)
 SELECT owner_actor,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT admin_a,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT admin_b,site_b,org,NULL::timestamptz FROM ifx
 UNION ALL SELECT maint,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT nurse,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT aide,site_a,org,NULL::timestamptz FROM ifx
 UNION ALL SELECT aide2,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT mgr,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT mgr2,site_a,org,NULL::timestamptz FROM ifx UNION ALL SELECT fam,site_a,org,NULL::timestamptz FROM ifx
 UNION ALL SELECT former,site_a,org,clock_timestamp()-interval '1 day' FROM ifx;
INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record)
 SELECT org,site_a,admin_a,'resident',owner_actor,'Fixture resident authority',true FROM ifx
 UNION ALL SELECT org,site_a,nurse,'resident',owner_actor,'Fixture nurse resident recorder',true FROM ifx
 UNION ALL SELECT org,site_a,mgr,'resident',owner_actor,'Fixture manager resident reader',false FROM ifx;
INSERT INTO public.operation_activities(id,organization_id,facility_id,activity_key,name,activity_kind,subject_kind,origin)
 SELECT act_asset,org,NULL::uuid,'hfo-144-fixture:'||act_asset,'AED monthly check','structured_observation','asset','admin_log' FROM ifx
 UNION ALL SELECT act_res,org,NULL,'hfo-144-fixture:'||act_res,'Resident weight review','record_review','resident','admin_log' FROM ifx;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name) SELECT asset1,org,site_a,'aed','AED lobby' FROM ifx UNION ALL SELECT asset2,org,site_a,'aed','AED wing B' FROM ifx;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status) SELECT res1,org,site_a,'Protected','Resident','1940-01-01','female','active' FROM ifx;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id) SELECT subj_asset1,org,site_a,'asset',asset1 FROM ifx UNION ALL SELECT subj_asset2,org,site_a,'asset',asset2 FROM ifx;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,resident_id) SELECT subj_res1,org,site_a,'resident',res1 FROM ifx;
CREATE FUNCTION pg_temp.i_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f ifx; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM ifx;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='aide' THEN u:=f.aide; sess:=f.aide_session; r:='housekeeper';
 ELSIF p_kind='aide2' THEN u:=f.aide2; sess:=f.aide2_session; r:='housekeeper';
 ELSIF p_kind='mgr' THEN u:=f.mgr; sess:=f.mgr_session; r:='manager';
 ELSIF p_kind='mgr2' THEN u:=f.mgr2; sess:=f.mgr2_session; r:='manager';
 ELSE u:=f.nurse; sess:=f.nurse_session; r:='nurse'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.i_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.i_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ(d date,hh text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(d,'YYYY-MM-DD'),'end_date',to_char(d+6,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE 'America/New_York'),'grace_ends_at',NULL,'remind_at',NULL,'timezone','America/New_York','adjustments','[]'::jsonb,'shift',NULL)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col144-'||p $$;
-- The revision the current session may read for an issue (NULL when the issue is hidden).
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT issue_revision FROM public.operation_issues WHERE id=(SELECT id FROM ifx_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.iid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM ifx_ids WHERE label=p_label $$;
GRANT ALL ON FUNCTION pg_temp.occ(date,text),pg_temp.run(text,date,date,uuid),pg_temp.i_login(text),pg_temp.i_service(),pg_temp.i_clear(),pg_temp.k(text),pg_temp.rev(text),pg_temp.iid(text) TO authenticated,service_role;

-- Central versions (owner), site configurations and bindings (site admin), occurrences (service).
SELECT pg_temp.i_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'v_asset',public.save_operation_requirement_draft_review(act_asset,jsonb_build_object('title','AED monthly check','wording','Check the AED pads and battery.','allowed_recorder_roles',jsonb_build_array('maintenance_role','facility_admin'))) FROM ifx;
INSERT INTO ifx_results SELECT 'v_res',public.save_operation_requirement_draft_review(act_res,jsonb_build_object('title','Resident weight review','wording','Review the monthly weight.','allowed_recorder_roles',jsonb_build_array('nurse','facility_admin'))) FROM ifx;
INSERT INTO ifx_ids SELECT label,(result->>'id')::uuid FROM ifx_results WHERE label LIKE 'v\_%';
INSERT INTO ifx_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,clock_timestamp()) FROM ifx_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.i_assert((SELECT count(*)=2 FROM ifx_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.i_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'fr_asset',public.save_operation_facility_requirement_draft_review(act_asset,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ifx_ids WHERE label='v_asset'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00"}}'::jsonb)) FROM ifx;
INSERT INTO ifx_results SELECT 'fr_res',public.save_operation_facility_requirement_draft_review(act_res,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',(SELECT id FROM ifx_ids WHERE label='v_res'),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"09:00"}}'::jsonb)) FROM ifx;
INSERT INTO ifx_ids SELECT label,(result->>'id')::uuid FROM ifx_results WHERE label LIKE 'fr\_%';
INSERT INTO ifx_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,clock_timestamp()) FROM ifx_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.i_assert((SELECT count(*)=2 FROM ifx_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO ifx_results SELECT 'b_asset1',public.enroll_operation_binding_review(act_asset,site_a,subj_asset1,'asset',NULL,'{"source":"admin_log","reason":"AED listed"}',clock_timestamp()) FROM ifx;
INSERT INTO ifx_results SELECT 'b_asset2',public.enroll_operation_binding_review(act_asset,site_a,subj_asset2,'asset',NULL,'{"source":"admin_log","reason":"Second AED listed"}',clock_timestamp()) FROM ifx;
INSERT INTO ifx_results SELECT 'b_res1',public.enroll_operation_binding_review(act_res,site_a,subj_res1,'resident',NULL,'{"source":"admin_log","reason":"Weight review roster"}',clock_timestamp()) FROM ifx;
RESET ROLE;
SELECT pg_temp.i_service();
SET LOCAL ROLE service_role;
INSERT INTO ifx_results SELECT 'g_asset',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ifx_ids WHERE label='fr_asset'),
 jsonb_build_array(pg_temp.occ(d1,'10:00'),pg_temp.occ(d2,'10:00'),pg_temp.occ(d3,'10:00')),pg_temp.run('run-asset',d1,d3,(SELECT id FROM ifx_ids WHERE label='fr_asset'))) FROM ifx;
INSERT INTO ifx_results SELECT 'g_res',public.generate_operation_occurrences_service(site_a,(SELECT id FROM ifx_ids WHERE label='fr_res'),
 jsonb_build_array(pg_temp.occ(d1,'09:00')),pg_temp.run('run-res',d1,d1,(SELECT id FROM ifx_ids WHERE label='fr_res'))) FROM ifx;
SELECT pg_temp.i_assert((SELECT (result->'counts'->>'created')::int=6 FROM ifx_results WHERE label='g_asset'),'asset occurrences not generated');
SELECT pg_temp.i_assert((SELECT (result->'counts'->>'created')::int=1 FROM ifx_results WHERE label='g_res'),'resident occurrence not generated');
INSERT INTO ifx_ids SELECT 'occ_a1_'||n,t.id FROM ifx CROSS JOIN LATERAL (VALUES('d1',ifx.d1),('d2',ifx.d2),('d3',ifx.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=ifx.subj_asset1 AND t.assigned_shift_date=x.d;
INSERT INTO ifx_ids SELECT 'occ_a2_'||n,t.id FROM ifx CROSS JOIN LATERAL (VALUES('d1',ifx.d1),('d2',ifx.d2),('d3',ifx.d3)) x(n,d) JOIN public.operation_task_instances t ON t.subject_id=ifx.subj_asset2 AND t.assigned_shift_date=x.d;
INSERT INTO ifx_ids SELECT 'occ_res_d1',t.id FROM ifx JOIN public.operation_task_instances t ON t.subject_id=ifx.subj_res1 AND t.assigned_shift_date=ifx.d1;
SELECT pg_temp.i_assert((SELECT count(*)=7 FROM ifx_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
RESET ROLE;
-- Receipts and issues from the COL-142 commands: a failed check with its issue, a performance on the same asset for a later resolution,
-- a performance on the other asset, a help request, a second open problem on the failed asset, and a subject-scoped resident problem.
SELECT pg_temp.i_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'rec_fail',public.record_operation_work_review(pg_temp.iid('occ_a2_d1'),pg_temp.k('fail-000001'),'{"outcome":"failed","issue":{"summary":"Pads expired and battery low","severity":"high"}}');
INSERT INTO ifx_ids SELECT 'issue_fail',(result->'issue'->>'id')::uuid FROM ifx_results WHERE label='rec_fail';
INSERT INTO ifx_ids SELECT 'r_fail',(result->'receipt'->>'id')::uuid FROM ifx_results WHERE label='rec_fail';
INSERT INTO ifx_results SELECT 'rec_fix',public.record_operation_work_review(pg_temp.iid('occ_a2_d2'),pg_temp.k('fix-000001'),'{"outcome":"performed","note":"Pads and battery replaced"}');
INSERT INTO ifx_ids SELECT 'r_fix',(result->'receipt'->>'id')::uuid FROM ifx_results WHERE label='rec_fix';
INSERT INTO ifx_results SELECT 'rec_other',public.record_operation_work_review(pg_temp.iid('occ_a1_d1'),pg_temp.k('other-000001'),'{"outcome":"performed"}');
INSERT INTO ifx_ids SELECT 'r_other',(result->'receipt'->>'id')::uuid FROM ifx_results WHERE label='rec_other';
INSERT INTO ifx_results SELECT 'iss_help',public.report_operation_issue_review(pg_temp.k('help-000001'),jsonb_build_object('task_instance_id',pg_temp.iid('occ_a1_d2'),'kind','help_request','summary','Need a ladder for the lobby unit'));
INSERT INTO ifx_ids SELECT 'issue_help',(result->'issue'->>'id')::uuid FROM ifx_results WHERE label='iss_help';
INSERT INTO ifx_results SELECT 'iss_cab',public.report_operation_issue_review(pg_temp.k('cab-000001'),jsonb_build_object('task_instance_id',pg_temp.iid('occ_a2_d3'),'kind','problem','summary','Cabinet latch loose on wing B'));
INSERT INTO ifx_ids SELECT 'issue_cab',(result->'issue'->>'id')::uuid FROM ifx_results WHERE label='iss_cab';
RESET ROLE;
SELECT pg_temp.i_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'iss_res',public.report_operation_issue_review(pg_temp.k('res-000001'),jsonb_build_object('activity_id',(SELECT act_res FROM ifx),'facility_id',(SELECT site_a FROM ifx),'subject_id',(SELECT subj_res1 FROM ifx),'kind','problem','summary','Scale reads inconsistently'));
INSERT INTO ifx_ids SELECT 'issue_res',(result->'issue'->>'id')::uuid FROM ifx_results WHERE label='iss_res';
RESET ROLE;
SELECT pg_temp.i_assert((SELECT count(*)=4 AND bool_and(status='open' AND issue_revision ~ '^[0-9a-f]{64}$' AND owner_user_id IS NULL AND reopen_count=0) FROM public.operation_issues),'fixture issues not open with a revision');
SELECT pg_temp.i_assert((SELECT receipt_id=pg_temp.iid('r_fail') FROM public.operation_issues WHERE id=pg_temp.iid('issue_fail')),'failed receipt did not link its issue');
INSERT INTO ifx_snap SELECT 'r_fail',to_jsonb(r) FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_fail');
INSERT INTO ifx_snap SELECT 'r_fix',to_jsonb(r) FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_fix');
INSERT INTO ifx_snap SELECT 'r_other',to_jsonb(r) FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_other');
INSERT INTO ifx_snap SELECT 'occ_a2_d1',to_jsonb(t) FROM public.operation_task_instances t WHERE id=pg_temp.iid('occ_a2_d1');
INSERT INTO ifx_snap SELECT 'occ_a1_d2',to_jsonb(t) FROM public.operation_task_instances t WHERE id=pg_temp.iid('occ_a1_d2');
INSERT INTO ifx_snap SELECT 'occ_a1_d1',to_jsonb(t) FROM public.operation_task_instances t WHERE id=pg_temp.iid('occ_a1_d1');
-- FIXTURES-END

-- Assign (manager only): shape, current owner and backup, stale revision, then one event with its audit row.
SELECT pg_temp.i_login('mgr');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert(pg_temp.rev('issue_fail') IS NOT NULL,'manager cannot read the issue revision');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),'short',pg_temp.rev('issue_fail'),'{}')$q$,'A request key is required');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),'not-a-revision','{}')$q$,'An expected issue revision is required');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'[]')$q$,'Issue payload must be an object');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"status":"resolved"}')$q$,'not editable');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"note":"nobody"}')$q$,'An owner user or role is required');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"owner_user_id":"x"}')$q$,'owner_user_id must be a uuid');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"owner_role":"janitor"}')$q$,'owner_role must be an application role');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT former FROM ifx)))$q$,'Owner is not current staff at this site');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx),'backup_user_id',(SELECT admin_b FROM ifx)))$q$,'Backup is not current staff at this site');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx),'backup_user_id',(SELECT nurse FROM ifx)))$q$,'Backup must differ from the owner');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"owner_role":"nurse","backup_role":"nurse"}')$q$,'Backup must differ from the owner');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"owner_role":"family"}')$q$,'Owner role must be an operations role');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),'{"owner_role":"nurse","backup_role":"broker"}')$q$,'Backup role must be an operations role');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT fam FROM ifx)))$q$,'Owner is not current staff at this site');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),repeat('0',64),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx)))$q$,'Issue changed since it was read');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_issue_events),'a rejected assignment created an event');
INSERT INTO ifx_results SELECT 'as1',public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx),'backup_user_id',(SELECT aide FROM ifx),'note','Nurse owns, aide covers'));
SELECT pg_temp.i_assert((SELECT (result->>'replayed')::boolean=false AND result->'issue'->>'status'='assigned' AND (result->'issue'->>'owner_user_id')::uuid=(SELECT nurse FROM ifx) AND (result->'issue'->>'backup_user_id')::uuid=(SELECT aide FROM ifx)
 AND result->'issue'->>'assigned_at' IS NOT NULL AND result->'issue'->>'accepted_at' IS NULL AND result->'event'->>'event_kind'='assigned' AND result->'event'->>'from_status'='open' AND result->'event'->>'to_status'='assigned'
 AND (result->'event'->>'actor_id')::uuid=(SELECT mgr FROM ifx) AND result->'event'->>'actor_role'='manager' AND result->'event'->'details'->>'note'='Nurse owns, aide covers' AND result->'event'->'details'->>'previous_owner_user_id' IS NULL
 AND result->'issue'->>'issue_revision'<>result->'event'->>'expected_revision' FROM ifx_results WHERE label='as1'),'assignment did not record the owner, backup and event');
SELECT pg_temp.i_assert((SELECT count(*)=1 FROM public.operation_issue_events WHERE issue_id=pg_temp.iid('issue_fail')),'assignment event count wrong');
RESET ROLE;
SELECT pg_temp.i_assert((SELECT count(*)=1 FROM public.operation_audit_log WHERE task_instance_id=pg_temp.iid('occ_a2_d1') AND event_type='updated' AND event_data->>'event_kind'='assigned' AND (event_data->>'issue_id')::uuid=pg_temp.iid('issue_fail') AND actor_id=(SELECT mgr FROM ifx)),'assignment audit row missing on the linked task');
SET LOCAL ROLE authenticated;
-- Replay: same key and content returns the same event even after the revision moved; changed content conflicts; a different key with a stale revision conflicts.
INSERT INTO ifx_results SELECT 'as1_replay',public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),(SELECT result->'event'->>'expected_revision' FROM ifx_results WHERE label='as1'),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx),'backup_user_id',(SELECT aide FROM ifx),'note','Nurse owns, aide covers'));
SELECT pg_temp.i_assert((SELECT (result->>'replayed')::boolean AND result->'event'->>'id'=(SELECT result->'event'->>'id' FROM ifx_results WHERE label='as1') AND result->'issue'->>'status'='assigned' FROM ifx_results WHERE label='as1_replay'),'assignment replay did not return the same event');
SELECT pg_temp.i_assert((SELECT count(*)=1 FROM public.operation_issue_events WHERE issue_id=pg_temp.iid('issue_fail')),'replay created a second event');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT aide FROM ifx)))$q$,'already saved with different content');
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000002'),(SELECT result->'event'->>'expected_revision' FROM ifx_results WHERE label='as1'),jsonb_build_object('owner_user_id',(SELECT aide FROM ifx)))$q$,'Issue changed since it was read');
-- A non-manager cannot assign; a site administrator reassigns and the previous owner is kept in the event.
RESET ROLE;
SELECT pg_temp.i_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000003'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT aide FROM ifx)))$q$);
RESET ROLE;
SELECT pg_temp.i_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'as2',public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000004'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT aide FROM ifx),'backup_user_id',(SELECT mgr2 FROM ifx)));
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='reassigned' AND result->'event'->>'from_status'='assigned' AND result->'event'->>'to_status'='assigned' AND (result->'event'->'details'->>'previous_owner_user_id')::uuid=(SELECT nurse FROM ifx)
 AND (result->'event'->'details'->>'previous_owner_current')::boolean AND (result->'issue'->>'owner_user_id')::uuid=(SELECT aide FROM ifx) AND (result->'issue'->>'backup_user_id')::uuid=(SELECT mgr2 FROM ifx) FROM ifx_results WHERE label='as2'),'reassignment did not keep the previous owner');
RESET ROLE;

-- Accept: the owner accepts; a backup covers only an absent owner or with a stated reason; nobody else.
SELECT pg_temp.i_login('mgr2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.accept_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ac-000001'),pg_temp.rev('issue_fail'),'{}')$q$,'Covering for a current owner requires cover_reason');
RESET ROLE;
SELECT pg_temp.i_login('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.accept_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ac-000002'),pg_temp.rev('issue_fail'),'{}')$q$);
RESET ROLE;
SELECT pg_temp.i_login('aide');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'ac1',public.accept_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ac-000003'),pg_temp.rev('issue_fail'),'{"note":"On it"}');
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='accepted' AND (result->'issue'->>'accepted_by')::uuid=(SELECT aide FROM ifx) AND result->'issue'->>'accepted_at' IS NOT NULL AND result->'issue'->>'status'='assigned' FROM ifx_results WHERE label='ac1'),'owner acceptance not recorded');
SELECT pg_temp.i_expect($q$SELECT public.accept_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ac-000004'),pg_temp.rev('issue_fail'),'{}')$q$,'Issue is already accepted');
RESET ROLE;
-- The owner's site grant is revoked: the backlog shows the owner as not current and the backup covers with history.
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT aide FROM ifx);
SELECT pg_temp.i_login('mgr2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert((SELECT owner_current=false AND backup_current=true AND status='assigned' FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_fail')),'backlog did not show the departed owner');
INSERT INTO ifx_results SELECT 'cover',public.accept_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ac-000005'),pg_temp.rev('issue_fail'),'{}');
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='covered' AND (result->'issue'->>'accepted_by')::uuid=(SELECT mgr2 FROM ifx) AND (result->'event'->'details'->>'owner_current')::boolean=false
 AND (result->'event'->'details'->>'previous_accepted_by')::uuid=(SELECT aide FROM ifx) FROM ifx_results WHERE label='cover'),'backup cover not recorded with history');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=(SELECT aide FROM ifx);
-- The covering backup is swapped out: the acceptance no longer belongs to the owner, an owner-role holder or the new backup, so it is cleared with history.
SELECT pg_temp.i_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'as_fail2',public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000005'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT aide FROM ifx),'backup_user_id',(SELECT nurse FROM ifx)));
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='reassigned' AND result->'issue'->>'accepted_at' IS NULL AND result->'issue'->>'accepted_by' IS NULL AND (result->'event'->'details'->>'acceptance_cleared')::boolean
 AND (result->'event'->'details'->>'previous_accepted_by')::uuid=(SELECT mgr2 FROM ifx) AND (result->'issue'->>'backup_user_id')::uuid=(SELECT nurse FROM ifx) FROM ifx_results WHERE label='as_fail2'),'stale acceptance survived the backup swap');
RESET ROLE;
-- With a stated reason the backup may cover a current owner (help issue, assigned by the manager, then covered by its backup).
SELECT pg_temp.i_login('mgr');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'as_help',public.assign_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('as-000010'),pg_temp.rev('issue_help'),jsonb_build_object('owner_role','maintenance_role','backup_user_id',(SELECT mgr FROM ifx)));
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='assigned' AND result->'issue'->>'owner_role'='maintenance_role' AND result->'issue'->>'owner_user_id' IS NULL FROM ifx_results WHERE label='as_help'),'role-only assignment failed');
INSERT INTO ifx_results SELECT 'cover_help',public.accept_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('ac-000010'),pg_temp.rev('issue_help'),'{"cover_reason":"Maintenance is on leave this week"}');
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='covered' AND (result->'event'->'details'->>'owner_current')::boolean AND result->'event'->'details'->>'cover_reason'='Maintenance is on leave this week' FROM ifx_results WHERE label='cover_help'),'reasoned cover not recorded');
RESET ROLE;
-- The role owner (maintenance) accepts as the owner.
SELECT pg_temp.i_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'ac_help',public.accept_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('ac-000011'),pg_temp.rev('issue_help'),'{}');
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='accepted' AND (result->'issue'->>'accepted_by')::uuid=(SELECT maint FROM ifx) FROM ifx_results WHERE label='ac_help'),'role owner could not accept');
RESET ROLE;

-- Waiting: reason and a future follow-up; the backlog flags an overdue follow-up at read time; resume returns to assigned or open.
SELECT pg_temp.i_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('follow_up_at',clock_timestamp()+interval '2 days'))$q$,'A waiting reason is required');
SELECT pg_temp.i_expect($q$SELECT public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('reason','Parts on order'))$q$,'follow_up_at must be a timestamp');
SELECT pg_temp.i_expect($q$SELECT public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('reason','Parts on order','follow_up_at',clock_timestamp()-interval '1 hour'))$q$,'follow_up_at must be in the future');
INSERT INTO ifx_payload SELECT 'wa1',jsonb_build_object('reason','Parts on order','follow_up_at',to_char((clock_timestamp()+interval '2 days') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
INSERT INTO ifx_results SELECT 'wa1',public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000001'),pg_temp.rev('issue_fail'),(SELECT payload FROM ifx_payload WHERE label='wa1'));
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='waiting' AND result->'issue'->>'waiting_reason'='Parts on order' AND result->'issue'->>'follow_up_at' IS NOT NULL AND result->'event'->>'event_kind'='waiting' AND result->'event'->>'from_status'='assigned' AND result->'event'->>'to_status'='waiting' FROM ifx_results WHERE label='wa1'),'waiting not recorded');
SELECT pg_temp.i_assert((SELECT follow_up_overdue=false AND status='waiting' AND last_event_kind='waiting' FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_fail')),'backlog flagged a future follow-up as overdue');
SELECT pg_temp.i_expect($q$SELECT public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000002'),pg_temp.rev('issue_fail'),jsonb_build_object('reason','Again','follow_up_at',clock_timestamp()+interval '2 days'))$q$,'Issue cannot wait from this state');
RESET ROLE;
-- The follow-up instant passes (fixture moves it under the owner token); the backlog flags it without any notification.
SELECT set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
UPDATE public.operation_issues SET follow_up_at=clock_timestamp()-interval '1 minute' WHERE id=pg_temp.iid('issue_fail');
SELECT set_config('haven.operation_occurrence_command','',true);
SELECT pg_temp.i_login('mgr2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert((SELECT follow_up_overdue FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_fail')),'backlog did not flag the overdue follow-up');
RESET ROLE;
-- The accepted wait still replays after its follow-up instant passed, from the owner's own session and from another session time zone.
SELECT pg_temp.i_login('aide');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'wa1_replay',public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000001'),pg_temp.rev('issue_fail'),(SELECT payload FROM ifx_payload WHERE label='wa1'));
SELECT pg_temp.i_assert((SELECT (result->>'replayed')::boolean AND result->'event'->>'id'=(SELECT result->'event'->>'id' FROM ifx_results WHERE label='wa1') FROM ifx_results WHERE label='wa1_replay'),'wait replay failed after the follow-up passed');
INSERT INTO ifx_payload SELECT 'tz',to_jsonb(current_setting('TimeZone'));
SET LOCAL TimeZone='Asia/Tokyo';
INSERT INTO ifx_results SELECT 'wa1_replay_tz',public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000001'),pg_temp.rev('issue_fail'),(SELECT payload FROM ifx_payload WHERE label='wa1'));
SELECT pg_temp.i_assert((SELECT (result->>'replayed')::boolean FROM ifx_results WHERE label='wa1_replay_tz'),'wait replay failed from another session time zone');
SELECT set_config('TimeZone',(SELECT payload#>>'{}' FROM ifx_payload WHERE label='tz'),true);
SELECT pg_temp.i_assert((SELECT count(*)=1 FROM public.operation_issue_events WHERE issue_id=pg_temp.iid('issue_fail') AND event_kind='waiting'),'wait replay created a second event');
RESET ROLE;
SELECT pg_temp.i_login('mgr2');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'rs1',public.resume_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('rs-000001'),pg_temp.rev('issue_fail'),'{"note":"Parts arrived"}');
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='assigned' AND result->'issue'->>'waiting_reason' IS NULL AND result->'issue'->>'follow_up_at' IS NULL AND result->'event'->>'event_kind'='resumed' AND result->'event'->'details'->>'waiting_reason'='Parts on order' FROM ifx_results WHERE label='rs1'),'resume did not return to assigned with history');
SELECT pg_temp.i_expect($q$SELECT public.resume_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('rs-000002'),pg_temp.rev('issue_fail'),'{}')$q$,'Issue is not waiting');
RESET ROLE;
-- An unassigned issue may wait (manager) and resumes to open.
SELECT pg_temp.i_login('nurse');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 'wa_res',public.wait_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('wa-000010'),pg_temp.rev('issue_res'),jsonb_build_object('reason','Awaiting the scale vendor','follow_up_at',clock_timestamp()+interval '3 days'));
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='waiting' AND result->'event'->>'from_status'='open' FROM ifx_results WHERE label='wa_res'),'open issue could not wait');
INSERT INTO ifx_results SELECT 'rs_res',public.resume_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('rs-000010'),pg_temp.rev('issue_res'),'{}');
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='open' AND result->'event'->>'to_status'='open' FROM ifx_results WHERE label='rs_res'),'resume of an unassigned issue did not return to open');
-- The first owner ever named is an assignment even while waiting; the issue stays waiting and resumes to assigned.
INSERT INTO ifx_results SELECT 'wa_res2',public.wait_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('wa-000012'),pg_temp.rev('issue_res'),jsonb_build_object('reason','Vendor visit booked','follow_up_at',clock_timestamp()+interval '4 days'));
INSERT INTO ifx_results SELECT 'as_res',public.assign_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('as-000030'),pg_temp.rev('issue_res'),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx)));
SELECT pg_temp.i_assert((SELECT result->'event'->>'event_kind'='assigned' AND result->'event'->>'from_status'='waiting' AND result->'event'->>'to_status'='waiting' AND result->'issue'->>'status'='waiting' AND (result->'issue'->>'owner_user_id')::uuid=(SELECT nurse FROM ifx) FROM ifx_results WHERE label='as_res'),'first owner from waiting was not an assignment');
INSERT INTO ifx_results SELECT 'rs_res2',public.resume_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('rs-000012'),pg_temp.rev('issue_res'),'{}');
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='assigned' FROM ifx_results WHERE label='rs_res2'),'resume after the first assignment did not return to assigned');
RESET ROLE;

-- Resolve: summary required; a cited receipt must be a readable performance receipt on the same subject; nothing on any receipt or occurrence moves.
SELECT pg_temp.i_login('aide2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000001'),pg_temp.rev('issue_fail'),'{"resolution_summary":"Not mine"}')$q$);
RESET ROLE;
SELECT pg_temp.i_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000001'),pg_temp.rev('issue_fail'),'{}')$q$,'A resolution summary is required');
SELECT pg_temp.i_expect($q$SELECT public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('resolution_summary','Replaced','resolution_receipt_id',pg_temp.iid('r_other')))$q$,'readable performance receipt for this subject');
SELECT pg_temp.i_expect($q$SELECT public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('resolution_summary','Replaced','resolution_receipt_id',gen_random_uuid()))$q$,'readable performance receipt for this subject');
INSERT INTO ifx_results SELECT 're1',public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000001'),pg_temp.rev('issue_fail'),jsonb_build_object('resolution_summary','Pads and battery replaced on the second check','resolution_receipt_id',pg_temp.iid('r_fix')));
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='resolved' AND (result->'issue'->>'resolved_by')::uuid=(SELECT aide FROM ifx) AND result->'issue'->>'resolved_at' IS NOT NULL AND (result->'issue'->>'resolution_receipt_id')::uuid=pg_temp.iid('r_fix')
 AND result->'issue'->>'resolution_summary'='Pads and battery replaced on the second check' AND result->'event'->>'event_kind'='resolved' AND result->'event'->>'to_status'='resolved' FROM ifx_results WHERE label='re1'),'resolution not recorded');
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_fail')),'resolved issue still in the backlog');
SELECT pg_temp.i_expect($q$SELECT public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000002'),pg_temp.rev('issue_fail'),'{"resolution_summary":"Again"}')$q$,'Issue is resolved');
SELECT pg_temp.i_expect($q$SELECT public.wait_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('wa-000003'),pg_temp.rev('issue_fail'),jsonb_build_object('reason','x','follow_up_at',clock_timestamp()+interval '1 day'))$q$,'Issue cannot wait from this state');
RESET ROLE;
SELECT pg_temp.i_login('mgr');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('as-000020'),pg_temp.rev('issue_fail'),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx)))$q$,'Issue is resolved');
RESET ROLE;
SELECT pg_temp.i_assert((SELECT to_jsonb(r)=(SELECT row_json FROM ifx_snap WHERE label='r_fail') FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_fail'))
 AND (SELECT to_jsonb(r)=(SELECT row_json FROM ifx_snap WHERE label='r_fix') FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_fix'))
 AND (SELECT to_jsonb(t)=(SELECT row_json FROM ifx_snap WHERE label='occ_a2_d1') FROM public.operation_task_instances t WHERE id=pg_temp.iid('occ_a2_d1')),'the lifecycle changed a receipt or an occurrence');

-- Reopen: reporter or manager, with a reason; the resolution stays in the events and the count is visible.
SELECT pg_temp.i_login('aide2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.reopen_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ro-000001'),pg_temp.rev('issue_fail'),'{"reason":"Not mine"}')$q$);
RESET ROLE;
SELECT pg_temp.i_login('aide');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.reopen_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ro-000001'),pg_temp.rev('issue_fail'),'{"reason":"Owner cannot reopen"}')$q$);
RESET ROLE;
SELECT pg_temp.i_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.reopen_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ro-000001'),pg_temp.rev('issue_fail'),'{}')$q$,'A reopen reason is required');
INSERT INTO ifx_results SELECT 'ro1',public.reopen_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ro-000001'),pg_temp.rev('issue_fail'),'{"reason":"Battery warning is back"}');
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='assigned' AND (result->'issue'->>'owner_user_id')::uuid=(SELECT aide FROM ifx) AND (result->'issue'->>'reopen_count')::int=1 AND result->'issue'->>'resolved_at' IS NULL AND result->'issue'->>'resolution_summary' IS NULL AND result->'issue'->>'resolution_receipt_id' IS NULL
 AND result->'event'->>'event_kind'='reopened' AND result->'event'->>'from_status'='resolved' AND result->'event'->'details'->'previous_resolution'->>'resolution_summary'='Pads and battery replaced on the second check'
 AND (result->'event'->'details'->'previous_resolution'->>'resolution_receipt_id')::uuid=pg_temp.iid('r_fix') FROM ifx_results WHERE label='ro1'),'reopen did not keep the resolution in history');
SELECT pg_temp.i_assert((SELECT count(*)=1 FROM public.operation_issue_events WHERE issue_id=pg_temp.iid('issue_fail') AND event_kind='resolved' AND details->>'resolution_summary'='Pads and battery replaced on the second check'),'resolved event lost after reopen');
SELECT pg_temp.i_expect($q$SELECT public.reopen_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ro-000002'),pg_temp.rev('issue_fail'),'{"reason":"Twice"}')$q$,'Issue is not resolved');
SELECT pg_temp.i_assert((SELECT status='assigned' AND owner_current AND reopen_count=1 FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_fail')),'reopened issue not back in the backlog');
RESET ROLE;
-- A manager resolves and reopens; the count climbs and an unassigned resolved issue reopens to open.
SELECT pg_temp.i_login('mgr');
SET LOCAL ROLE authenticated;
INSERT INTO ifx_results SELECT 're2',public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('re-000003'),pg_temp.rev('issue_fail'),'{"resolution_summary":"Unit replaced"}');
INSERT INTO ifx_results SELECT 'ro2',public.reopen_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('ro-000003'),pg_temp.rev('issue_fail'),'{"reason":"Replacement failed self-test"}');
SELECT pg_temp.i_assert((SELECT (result->'issue'->>'reopen_count')::int=2 AND result->'issue'->>'status'='assigned' FROM ifx_results WHERE label='ro2'),'second reopen not counted');
INSERT INTO ifx_results SELECT 're_res',public.resolve_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('re-000010'),pg_temp.rev('issue_res'),'{"resolution_summary":"Scale recalibrated"}');
INSERT INTO ifx_results SELECT 'ro_res',public.reopen_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('ro-000010'),pg_temp.rev('issue_res'),'{"reason":"Drift returned"}');
SELECT pg_temp.i_assert((SELECT result->'issue'->>'status'='assigned' AND (result->'issue'->>'owner_user_id')::uuid=(SELECT nurse FROM ifx) FROM ifx_results WHERE label='ro_res'),'owned issue did not reopen to assigned');
RESET ROLE;

-- Link: an open issue is linked once to a readable performance receipt on its subject; the receipt and occurrence stay as they were.
SELECT pg_temp.i_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.link_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('li-000001'),pg_temp.rev('issue_help'),'{}')$q$,'receipt_id is required');
SELECT pg_temp.i_expect($q$SELECT public.link_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('li-000001'),pg_temp.rev('issue_help'),jsonb_build_object('receipt_id',pg_temp.iid('r_fix')))$q$,'readable performance receipt for this subject');
INSERT INTO ifx_results SELECT 'li1',public.link_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('li-000001'),pg_temp.rev('issue_help'),jsonb_build_object('receipt_id',pg_temp.iid('r_other')));
SELECT pg_temp.i_assert((SELECT (result->'issue'->>'receipt_id')::uuid=pg_temp.iid('r_other') AND result->'issue'->>'status'='assigned' AND result->'event'->>'event_kind'='linked' AND result->'event'->>'from_status'=result->'event'->>'to_status' FROM ifx_results WHERE label='li1'),'link not recorded');
SELECT pg_temp.i_expect($q$SELECT public.link_operation_issue_review(pg_temp.iid('issue_help'),pg_temp.k('li-000002'),pg_temp.rev('issue_help'),jsonb_build_object('receipt_id',pg_temp.iid('r_other')))$q$,'already linked to a receipt');
SELECT pg_temp.i_expect($q$SELECT public.link_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('li-000003'),pg_temp.rev('issue_fail'),jsonb_build_object('receipt_id',pg_temp.iid('r_fix')))$q$,'already linked to a receipt');
-- A failed check's receipt can also be linked to an earlier open issue on the same asset without touching the receipt or reversing the inspection.
INSERT INTO ifx_results SELECT 'li_cab',public.link_operation_issue_review(pg_temp.iid('issue_cab'),pg_temp.k('li-000004'),pg_temp.rev('issue_cab'),jsonb_build_object('receipt_id',pg_temp.iid('r_fail')));
SELECT pg_temp.i_assert((SELECT (result->'issue'->>'receipt_id')::uuid=pg_temp.iid('r_fail') AND result->'issue'->>'status'='open' FROM ifx_results WHERE label='li_cab'),'link to the failed receipt not recorded');
RESET ROLE;
SELECT pg_temp.i_assert((SELECT to_jsonb(r)=(SELECT row_json FROM ifx_snap WHERE label='r_other') FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_other'))
 AND (SELECT to_jsonb(r)=(SELECT row_json FROM ifx_snap WHERE label='r_fail') FROM public.operation_execution_receipts r WHERE id=pg_temp.iid('r_fail'))
 AND (SELECT to_jsonb(t)=(SELECT row_json FROM ifx_snap WHERE label='occ_a1_d2') FROM public.operation_task_instances t WHERE id=pg_temp.iid('occ_a1_d2'))
 AND (SELECT to_jsonb(t)=(SELECT row_json FROM ifx_snap WHERE label='occ_a1_d1') FROM public.operation_task_instances t WHERE id=pg_temp.iid('occ_a1_d1')),'linking changed a receipt or an occurrence');
SELECT pg_temp.i_assert((SELECT execution_state='failed' AND status='in_progress' FROM public.operation_task_instances WHERE id=pg_temp.iid('occ_a2_d1')),'the inspection fact was reversed');

-- An occurrence with an unresolved issue cannot be cancelled or removed; the issue would vanish from the backlog.
SELECT pg_temp.i_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_expect($q$SELECT public.cancel_operation_occurrence_review(pg_temp.iid('occ_a2_d3'),'Unit removed',pg_temp.k('ca-000001'))$q$,'Occurrence has an open issue');
SELECT pg_temp.i_expect($q$SELECT public.cancel_operation_occurrence_review(pg_temp.iid('occ_a2_d3'),'Unit removed',pg_temp.k('ca-000001'),true)$q$,'Occurrence has an open issue');
SELECT pg_temp.i_assert((SELECT status='pending' AND deleted_at IS NULL FROM public.operation_task_instances WHERE id=pg_temp.iid('occ_a2_d3')),'occurrence with an open issue was cancelled');
RESET ROLE;

-- Authority: the other site's administrator is denied and sees nothing; a revoked session is denied before any row; a manager without the subject scope is denied on a resident issue.
SELECT pg_temp.i_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('b-000001'),repeat('0',64),jsonb_build_object('owner_user_id',(SELECT admin_b FROM ifx)))$q$);
SELECT pg_temp.i_denied($q$SELECT public.resolve_operation_issue_review(gen_random_uuid(),pg_temp.k('b-000002'),repeat('0',64),'{"resolution_summary":"x"}')$q$);
SELECT pg_temp.i_assert((SELECT count(*)=0 FROM public.operation_issues)AND(SELECT count(*)=0 FROM public.operation_issue_events)AND(SELECT count(*)=0 FROM public.operation_issue_backlog),'the other site can read issues, events or the backlog');
SELECT pg_temp.i_assert((SELECT haven.operation_issue_user_current(aide,org,site_a) IS NULL AND haven.operation_issue_owner_current(NULL,'nurse',org,site_a) IS NULL FROM ifx),'currentness helper answered for another site');
SELECT pg_temp.i_assert((SELECT haven.operation_issue_user_current(admin_b,org,site_b) FROM ifx),'currentness helper refused the caller''s own site');
RESET ROLE;
SELECT pg_temp.i_login('mgr2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_res'),pg_temp.k('m-000001'),repeat('0',64),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx)))$q$);
SELECT pg_temp.i_assert((SELECT count(*)=0 FROM public.operation_issues WHERE id=pg_temp.iid('issue_res')),'manager without resident scope can read the resident issue');
RESET ROLE;
SELECT pg_temp.i_login('mgr');
DELETE FROM auth.sessions WHERE id=(SELECT mgr_session FROM ifx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$SELECT public.assign_operation_issue_review(pg_temp.iid('issue_cab'),pg_temp.k('m-000002'),repeat('0',64),jsonb_build_object('owner_user_id',(SELECT nurse FROM ifx)))$q$);
RESET ROLE;
SELECT pg_temp.i_assert((SELECT count(*)=0 FROM public.operation_issue_events WHERE request_key IN(pg_temp.k('b-000001'),pg_temp.k('b-000002'),pg_temp.k('m-000001'),pg_temp.k('m-000002'))),'a denied command created an event');

-- Direct writes: no client DML; the service cannot move an issue or write an event even with a forged setting; events are immutable even under the owner token.
SELECT pg_temp.i_login('mgr2');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_denied($q$UPDATE public.operation_issues SET status='resolved' WHERE id=pg_temp.iid('issue_fail')$q$);
SELECT pg_temp.i_denied($q$INSERT INTO public.operation_issue_events(organization_id,facility_id,issue_id,event_kind,from_status,to_status,actor_id,actor_role,expected_revision,request_key,request_hash) SELECT org,site_a,pg_temp.iid('issue_fail'),'resolved','assigned','resolved',mgr2,'manager','x','forged-000001','x' FROM ifx$q$);
SELECT pg_temp.i_denied($q$DELETE FROM public.operation_issue_events WHERE issue_id=pg_temp.iid('issue_fail')$q$);
SELECT pg_temp.i_denied($q$SELECT haven.operation_occurrence_token()$q$);
RESET ROLE;
SELECT pg_temp.i_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.i_denied($q$UPDATE public.operation_issues SET status='resolved',resolved_at=now(),resolved_by=(SELECT mgr2 FROM ifx),resolution_summary='forged' WHERE id=pg_temp.iid('issue_fail')$q$);
SELECT set_config('haven.operation_occurrence_command','approved',true);
SELECT pg_temp.i_denied($q$UPDATE public.operation_issues SET status='resolved',resolved_at=now(),resolved_by=(SELECT mgr2 FROM ifx),resolution_summary='forged' WHERE id=pg_temp.iid('issue_fail')$q$);
SELECT pg_temp.i_denied($q$INSERT INTO public.operation_issue_events(organization_id,facility_id,issue_id,event_kind,from_status,to_status,actor_id,actor_role,expected_revision,request_key,request_hash) SELECT org,site_a,pg_temp.iid('issue_fail'),'resolved','assigned','resolved',mgr2,'manager','x','forged-000002','x' FROM ifx$q$);
SELECT pg_temp.i_denied($q$SELECT public.resolve_operation_issue_review(pg_temp.iid('issue_fail'),pg_temp.k('svc-000001'),repeat('0',64),'{"resolution_summary":"service"}')$q$);
SELECT set_config('haven.operation_occurrence_command','',true);
RESET ROLE;
SELECT pg_temp.i_clear();
SELECT pg_temp.i_assert((SELECT status='assigned' AND resolution_summary IS NULL FROM public.operation_issues WHERE id=pg_temp.iid('issue_fail')),'service moved an issue');
SELECT set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
SELECT pg_temp.i_expect($q$UPDATE public.operation_issue_events SET details='{}' WHERE issue_id=pg_temp.iid('issue_fail')$q$,'immutable history');
SELECT pg_temp.i_expect($q$DELETE FROM public.operation_issues WHERE id=pg_temp.iid('issue_cab')$q$,'immutable history');
SELECT pg_temp.i_expect($q$UPDATE public.operation_issues SET summary='rewritten' WHERE id=pg_temp.iid('issue_cab')$q$,'Issue identity is immutable');
SELECT pg_temp.i_expect($q$UPDATE public.operation_issues SET receipt_id=pg_temp.iid('r_fix') WHERE id=pg_temp.iid('issue_cab')$q$,'set once');
SELECT set_config('haven.operation_occurrence_command','',true);

-- Reads: the site administrator sees the whole backlog with currentness and the last events; generic audit payloads stay hidden; no public RPC is definer.
SELECT pg_temp.i_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.i_assert((SELECT count(*)=4 FROM public.operation_issue_backlog),'site administrator cannot read the backlog');
SELECT pg_temp.i_assert((SELECT status='assigned' AND owner_current AND backup_current AND NOT follow_up_overdue AND execution_state='failed' AND last_event_kind='reopened' AND reopen_count=2 FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_fail')),'backlog projection wrong for the reopened issue');
SELECT pg_temp.i_assert((SELECT status='assigned' AND owner_role='maintenance_role' AND owner_current AND last_event_kind='linked' FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_help')),'backlog projection wrong for the role-owned issue');
SELECT pg_temp.i_assert((SELECT status='open' AND owner_current IS NULL AND last_event_kind='linked' AND execution_state='none' FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_cab')),'backlog projection wrong for the unassigned issue');
SELECT pg_temp.i_assert((SELECT status='assigned' AND owner_current AND backup_current IS NULL AND last_event_kind='reopened' AND execution_state IS NULL FROM public.operation_issue_backlog WHERE id=pg_temp.iid('issue_res')),'backlog projection wrong for the subject-scoped issue');
SELECT pg_temp.i_assert((SELECT count(*)=(SELECT count(*) FROM ifx_results WHERE label IN('as1','as2','ac1','cover','as_fail2','as_help','cover_help','ac_help','wa1','rs1','wa_res','rs_res','wa_res2','as_res','rs_res2','re1','ro1','re2','ro2','re_res','ro_res','li1','li_cab')) FROM public.operation_issue_events),'event count differs from the accepted commands');
SELECT pg_temp.i_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name IN('operation_issue_events','operation_issues')),'generic audit payloads of issues leaked');
RESET ROLE;
SELECT pg_temp.i_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%\_operation\_issue\_review' AND p.prosecdef),'public issue RPC is definer');
SELECT pg_temp.i_assert((SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='haven' AND p.proname IN('assign_operation_issue','accept_operation_issue','wait_operation_issue','resume_operation_issue','resolve_operation_issue','reopen_operation_issue','link_operation_issue','lock_operation_issue_authority')),'haven issue commands are not definer');
SELECT 'COL-144 issue lifecycle behavior PASS' result;
ROLLBACK;
