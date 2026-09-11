-- COL-159: dietary, facility-services and general-admin evidence connected to
-- the checklist through the COL-147 source-link mechanism, on the disposable
-- replay. Uses the real catalog activities (336) at Homewood Lodge with
-- synthetic versions, configurations, bindings and occurrences (the weekly
-- Tuesday rule is a fixture, not Homewood's schedule; Q09/Q11/Q14/Q28 stay
-- open). Proves: registration is exactly the three new adapters and eleven
-- new rules beside the COL-154 rows, no review or human-path activity is
-- allowlisted and the migration recorded nothing; an AED operation check
-- satisfies exactly its component and leaves the equipment component pending;
-- a vendor extinguisher inspection satisfies the inspection as an on-behalf
-- entry while the separate currency check stays pending and the asset's
-- service dates, the certificate document and the building profile are
-- untouched; one vendor visit is two records (fire, sprinkler); every wrong
-- kind, subject, performer, certificate, instant or outcome is refused by
-- name and writes nothing; a meal substitution is meal-level and satisfies its
-- period once (a second in the period is a visible conflict); a menu approval
-- keeps its labels verbatim; a failed emergency food check opens an issue that
-- its void leaves open; corrections chain, kinds never change, an asset move
-- invalidates and satisfies as a fresh chain; the other site and every
-- direct-DML path behave as the contract says. Rolls back.
BEGIN;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated,service_role;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.c_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'COL-159 %',msg; END IF; END $$;
CREATE FUNCTION pg_temp.c_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'COL-159 expected authority denial: %',stmt;
END $$;
CREATE FUNCTION pg_temp.c_expect(stmt text,fragment text,detail_fragment text DEFAULT NULL,p_sqlstate text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ DECLARE d text; BEGIN
 BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS d=PG_EXCEPTION_DETAIL;
  IF position(fragment IN SQLERRM)>0 AND (detail_fragment IS NULL OR coalesce(d,'')=detail_fragment) AND (p_sqlstate IS NULL OR SQLSTATE=p_sqlstate) THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'COL-159 expected rejection containing "%": %',fragment,stmt;
END $$;

-- 0. Registration is exactly the COL-154 rows plus the three COL-159 adapters and eleven rules; no review or human-path activity is allowlisted; nothing was delivered or recorded.
SELECT pg_temp.c_assert((SELECT array_agg(source_key||':'||subject_kind||':'||reader_function||':'||status ORDER BY source_key) FROM public.operation_source_adapters)
 =ARRAY['asset-observation:asset:operation_source_read_asset_observation:registered','asset-service:asset:operation_source_read_asset_service:registered','dietary-record:facility:operation_source_read_dietary_record:registered',
  'drill-log:facility:operation_source_read_drill_log:registered','facility-service:facility:operation_source_read_facility_service:registered'],'adapters not registered exactly');
SELECT pg_temp.c_assert((SELECT array_agg(ru.source_key||':'||a.activity_key ORDER BY ru.source_key,a.activity_key) FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id)
 =ARRAY['asset-observation:hfo-al-a07-03','asset-observation:hfo-al-w01-01','asset-observation:hfo-al-w01-02','asset-observation:hfo-al-w04-01','asset-observation:hfo-al-w04-02',
  'asset-service:hfo-al-m11-01','asset-service:hfo-al-y03-01','asset-service:hfo-al-y05-01','dietary-record:hfo-al-m01-01','dietary-record:hfo-al-m08-01','dietary-record:hfo-al-y01-01',
  'drill-log:hfo-al-m05-01','drill-log:hfo-al-m06-01','facility-service:hfo-al-y02-01','facility-service:hfo-al-y04-01','facility-service:hfo-al-y04-02'],'rules not registered exactly');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE a.activity_kind='record_review'
 OR a.activity_key IN('hfo-al-d01-01','hfo-al-d02-01','hfo-al-d02-02','hfo-al-d03-01','hfo-al-d03-02','hfo-al-d11-01','hfo-al-d16-01','hfo-al-w03-01','hfo-al-m10-01','hfo-al-y06-01','hfo-al-y07-01','hfo-al-a07-01','hfo-al-a07-02','hfo-al-a08-01','hfo-al-a08-02')),'a review or human-path activity is allowlisted');
SELECT pg_temp.c_assert((SELECT bool_and(organization_id='00000000-0000-0000-0000-000000000001') FROM public.operation_source_adapters),'adapter registration drifted');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM public.operation_source_events) AND NOT EXISTS(SELECT 1 FROM public.operation_source_record_requests) AND NOT EXISTS(SELECT 1 FROM public.facility_service_records) AND NOT EXISTS(SELECT 1 FROM public.dietary_records)
 AND NOT EXISTS(SELECT 1 FROM public.asset_observations),'the migration delivered or recorded something');
SELECT pg_temp.c_assert((SELECT pg_get_constraintdef(oid) LIKE '%aed_operation_check%aed_equipment_check%' FROM pg_constraint WHERE conname='asset_observations_observation_kind_check'),'observation kinds not widened');

-- FIXTURES-BEGIN
CREATE TEMP TABLE cf AS SELECT gen_random_uuid() owner_actor,gen_random_uuid() owner_session,gen_random_uuid() admin_a,gen_random_uuid() admin_a_session,
 gen_random_uuid() admin_b,gen_random_uuid() admin_b_session,gen_random_uuid() maint,gen_random_uuid() maint_session,gen_random_uuid() cook,gen_random_uuid() cook_session,gen_random_uuid() aide,gen_random_uuid() aide_session,
 gen_random_uuid() site_b,gen_random_uuid() aed1,gen_random_uuid() ext1,gen_random_uuid() ext2,gen_random_uuid() hood1,gen_random_uuid() ac1,gen_random_uuid() ac_ret,gen_random_uuid() aed_b,
 gen_random_uuid() subj_aed1,gen_random_uuid() subj_ext1,gen_random_uuid() subj_ext2,gen_random_uuid() subj_hood1,gen_random_uuid() subj_ac1,
 gen_random_uuid() vendor_ok,gen_random_uuid() vendor_unlinked,gen_random_uuid() doc1,gen_random_uuid() doc_b,gen_random_uuid() doc_arch,gen_random_uuid() ms_lunch,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-w04-01') act_aed_op,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-w04-02') act_aed_eq,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-y03-01') act_ext_insp,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-a07-03') act_ext_cur,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-y05-01') act_hood,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-m11-01') act_ac,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-y02-01') act_fire_safety,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-y04-01') act_fire,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-y04-02') act_sprk,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-m01-01') act_food,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-m08-01') act_meal,
 (SELECT id FROM public.operation_activities WHERE organization_id=f.organization_id AND activity_key='hfo-al-y01-01') act_menu,
 -- Dates are anchored on the facility-local day: versions, configurations and bindings take effect at 23:59 yesterday; d0 is today; the routine instant is five
 -- minutes ago and the late instant twenty minutes ago; every occurrence's d0 period starts yesterday so a late instant matches whatever the hour.
 ((current_timestamp AT TIME ZONE 'America/New_York')::date::timestamp-interval '1 minute') AT TIME ZONE 'America/New_York' since,
 date_trunc('minute',clock_timestamp()-interval '5 minutes') recent,date_trunc('minute',clock_timestamp()-interval '20 minutes') past_due,
 f.id site_a,f.organization_id org,f.entity_id entity FROM public.facilities f WHERE f.id='00000000-0000-0000-0002-000000000003' AND deleted_at IS NULL;
ALTER TABLE cf ADD COLUMN d0 date,ADD COLUMN d1 date,ADD COLUMN dold date;
UPDATE cf SET d0=(clock_timestamp() AT TIME ZONE 'America/New_York')::date;
UPDATE cf SET d1=d0+7,dold=d0-3;
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM cf) AND (SELECT num_nonnulls(act_aed_op,act_aed_eq,act_ext_insp,act_ext_cur,act_hood,act_ac,act_fire_safety,act_fire,act_sprk,act_food,act_meal,act_menu)=12 FROM cf),'Homewood or the catalog activities are missing');
CREATE TEMP TABLE cf_ids(label text PRIMARY KEY,id uuid);
CREATE TEMP TABLE cf_results(label text PRIMARY KEY,result jsonb);
GRANT SELECT ON cf TO authenticated,service_role; GRANT ALL ON cf_ids,cf_results TO authenticated,service_role;
INSERT INTO public.facilities(id,organization_id,entity_id,name,address_line_1,city,zip,total_licensed_beds) SELECT site_b,org,entity,'Service Site B','Test','Test','00000',1 FROM cf;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner_actor,owner_actor||'@svc.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Corporate"}'::jsonb FROM cf
 UNION ALL SELECT admin_a,admin_a||'@svc.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site A admin"}'::jsonb FROM cf
 UNION ALL SELECT admin_b,admin_b||'@svc.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Site B admin"}'::jsonb FROM cf
 UNION ALL SELECT maint,maint||'@svc.invalid',jsonb_build_object('organization_id',org,'app_role','maintenance_role'),'{"full_name":"Maintenance"}'::jsonb FROM cf
 UNION ALL SELECT cook,cook||'@svc.invalid',jsonb_build_object('organization_id',org,'app_role','dietary'),'{"full_name":"Dietary"}'::jsonb FROM cf
 UNION ALL SELECT aide,aide||'@svc.invalid',jsonb_build_object('organization_id',org,'app_role','housekeeper'),'{"full_name":"Aide"}'::jsonb FROM cf;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active)
 SELECT owner_actor,owner_actor||'@svc.invalid','Corporate','owner'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_a,admin_a||'@svc.invalid','Site A admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT admin_b,admin_b||'@svc.invalid','Site B admin','facility_admin'::public.app_role,org,true FROM cf
 UNION ALL SELECT maint,maint||'@svc.invalid','Maintenance','maintenance_role'::public.app_role,org,true FROM cf
 UNION ALL SELECT cook,cook||'@svc.invalid','Dietary','dietary'::public.app_role,org,true FROM cf
 UNION ALL SELECT aide,aide||'@svc.invalid','Aide','housekeeper'::public.app_role,org,true FROM cf
 ON CONFLICT(id) DO UPDATE SET app_role=excluded.app_role,organization_id=excluded.organization_id,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner_actor FROM cf UNION ALL SELECT admin_a_session,admin_a FROM cf UNION ALL SELECT admin_b_session,admin_b FROM cf
 UNION ALL SELECT maint_session,maint FROM cf UNION ALL SELECT cook_session,cook FROM cf UNION ALL SELECT aide_session,aide FROM cf;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner_actor,site_a,org FROM cf UNION ALL SELECT admin_a,site_a,org FROM cf UNION ALL SELECT admin_b,site_b,org FROM cf UNION ALL SELECT maint,site_a,org FROM cf UNION ALL SELECT cook,site_a,org FROM cf UNION ALL SELECT aide,site_a,org FROM cf;
INSERT INTO public.facility_assets(id,organization_id,facility_id,asset_type,name,status,last_service_at,next_service_due_at)
 SELECT aed1,org,site_a,'aed','AED lobby','active',NULL,NULL FROM cf UNION ALL SELECT ext1,org,site_a,'fire_extinguisher','Extinguisher kitchen','active',(SELECT d0-400 FROM cf),(SELECT d0-35 FROM cf) FROM cf
 UNION ALL SELECT ext2,org,site_a,'fire_extinguisher','Extinguisher hall','active',NULL,NULL FROM cf UNION ALL SELECT hood1,org,site_a,'hood_suppression','Kitchen hood','active',NULL,NULL FROM cf
 UNION ALL SELECT ac1,org,site_a,'ac_unit','AC unit east','active',NULL,NULL FROM cf UNION ALL SELECT ac_ret,org,site_a,'ac_unit','AC unit retired','retired',NULL,NULL FROM cf
 UNION ALL SELECT aed_b,org,site_b,'aed','Site B AED','active',NULL,NULL FROM cf;
INSERT INTO public.operation_activity_subjects(id,organization_id,facility_id,subject_kind,asset_id)
 SELECT subj_aed1,org,site_a,'asset',aed1 FROM cf UNION ALL SELECT subj_ext1,org,site_a,'asset',ext1 FROM cf UNION ALL SELECT subj_ext2,org,site_a,'asset',ext2 FROM cf
 UNION ALL SELECT subj_hood1,org,site_a,'asset',hood1 FROM cf UNION ALL SELECT subj_ac1,org,site_a,'asset',ac1 FROM cf;
INSERT INTO public.vendors(id,organization_id,name,category) SELECT vendor_ok,org,'Probe Fire Services','maintenance'::public.vendor_category FROM cf UNION ALL SELECT vendor_unlinked,org,'Probe Unlinked Vendor','maintenance'::public.vendor_category FROM cf;
INSERT INTO public.vendor_facilities(organization_id,vendor_id,facility_id) SELECT org,vendor_ok,site_a FROM cf;
INSERT INTO public.facility_documents(id,organization_id,facility_id,document_category,document_name,file_path,uploaded_by,vault_series_id)
 SELECT doc1,org,site_a,'fire_inspections','Extinguisher certificate','probe/cert.pdf',admin_a,gen_random_uuid() FROM cf
 UNION ALL SELECT doc_b,org,site_b,'fire_inspections','Site B certificate','probe/cert-b.pdf',admin_b,gen_random_uuid() FROM cf
 UNION ALL SELECT doc_arch,org,site_a,'fire_inspections','Archived certificate','probe/cert-old.pdf',admin_a,gen_random_uuid() FROM cf;
UPDATE public.facility_documents SET archived_at=now() WHERE id=(SELECT doc_arch FROM cf);
INSERT INTO public.meal_services(id,organization_id,facility_id,service_date,meal_period,venue,scheduled_start,scheduled_end)
 SELECT ms_lunch,org,site_a,d0,'lunch','main_dining',(d0::timestamp+'12:00'::time) AT TIME ZONE 'America/New_York',(d0::timestamp+'13:00'::time) AT TIME ZONE 'America/New_York' FROM cf;
CREATE FUNCTION pg_temp.c_login(p_kind text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE f cf; u uuid; sess uuid; r text; BEGIN
 SELECT * INTO f FROM cf;
 IF p_kind='owner' THEN u:=f.owner_actor; sess:=f.owner_session; r:='owner';
 ELSIF p_kind='admin_a' THEN u:=f.admin_a; sess:=f.admin_a_session; r:='facility_admin';
 ELSIF p_kind='admin_b' THEN u:=f.admin_b; sess:=f.admin_b_session; r:='facility_admin';
 ELSIF p_kind='maint' THEN u:=f.maint; sess:=f.maint_session; r:='maintenance_role';
 ELSIF p_kind='cook' THEN u:=f.cook; sess:=f.cook_session; r:='dietary';
 ELSE u:=f.aide; sess:=f.aide_session; r:='housekeeper'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sess,'iat',extract(epoch FROM clock_timestamp())::bigint,
  'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=u),'role','authenticated','app_role',r,'organization_id',f.org)::text,true);
END $$;
CREATE FUNCTION pg_temp.c_service() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
CREATE FUNCTION pg_temp.c_clear() RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claims','',true) $$;
CREATE FUNCTION pg_temp.occ2(d date,p_start date,p_end date,tzname text,hh text,grace_minutes int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('occurrence_date',to_char(d,'YYYY-MM-DD'),'period',jsonb_build_object('start_date',to_char(p_start,'YYYY-MM-DD'),'end_date',to_char(p_end,'YYYY-MM-DD')),
  'due_at',((d::timestamp+hh::time) AT TIME ZONE tzname),'grace_ends_at',CASE WHEN grace_minutes IS NULL THEN NULL ELSE ((d::timestamp+hh::time) AT TIME ZONE tzname)+make_interval(mins=>grace_minutes) END,
  'remind_at',NULL,'timezone',tzname,'adjustments','[]'::jsonb)
$$;
CREATE FUNCTION pg_temp.run(p_id text,d_from date,d_to date,p_config uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('run_id',p_id,'evaluator_version','hfo-evaluator/1','date_from',to_char(d_from,'YYYY-MM-DD'),'date_to',to_char(d_to,'YYYY-MM-DD'),
  'rule',(SELECT schedule_rule FROM public.operation_facility_requirements WHERE id=p_config),'occurrence_kind','scheduled')
$$;
CREATE FUNCTION pg_temp.k(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'col159-'||p $$;
CREATE FUNCTION pg_temp.rid(p_label text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM cf_ids WHERE label=p_label $$;
CREATE FUNCTION pg_temp.res(p_label text) RETURNS jsonb LANGUAGE sql AS $$ SELECT result FROM cf_results WHERE label=p_label $$;
CREATE FUNCTION pg_temp.rev(p_label text) RETURNS text LANGUAGE sql AS $$ SELECT revision FROM public.operation_execution_receipts WHERE id=(SELECT id FROM cf_ids WHERE label=p_label) $$;
CREATE FUNCTION pg_temp.obs(p_key text,p_asset uuid,p_kind text,p_at timestamptz,p_outcome text,p_readings jsonb DEFAULT '{}'::jsonb,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_asset_observation_review(pg_temp.k(p_key),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',p_asset,'observation_kind',p_kind,'observed_at',p_at,'basis','staff_observed','outcome',p_outcome,'readings',p_readings)||p_extra)
$$;
CREATE FUNCTION pg_temp.svc(p_key text,p_kind text,p_asset uuid,p_at timestamptz,p_outcome text,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_facility_service_review(pg_temp.k(p_key),jsonb_strip_nulls(jsonb_build_object('facility_id',(SELECT site_a FROM cf),'service_kind',p_kind,'asset_id',p_asset,'performed_at',p_at,'outcome',p_outcome))||p_extra)
$$;
CREATE FUNCTION pg_temp.diet(p_key text,p_kind text,p_at timestamptz,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_dietary_record_review(pg_temp.k(p_key),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'record_kind',p_kind,'performed_at',p_at)||p_extra)
$$;
CREATE FUNCTION pg_temp.deliver(p_key text,p_source text,p_id text,p_version text,p_kind text,p_facility uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.deliver_operation_source_event_review(pg_temp.k(p_key),jsonb_build_object('source_key',p_source,'source_record_id',p_id,'source_record_version',p_version,'event_kind',p_kind,'facility_id',p_facility))
$$;
CREATE FUNCTION pg_temp.subst(p_key text,p_date date,p_period text,p_at timestamptz,p_extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.diet(p_key,'meal_substitution',p_at,jsonb_build_object('service_date',to_char(p_date,'YYYY-MM-DD'),'meal_period',p_period,'planned_item','Baked chicken','substitute_item','Turkey loaf','substitution_reason','Delivery short')||p_extra)
$$;
GRANT ALL ON FUNCTION pg_temp.occ2(date,date,date,text,text,int),pg_temp.run(text,date,date,uuid),pg_temp.c_login(text),pg_temp.c_service(),pg_temp.c_clear(),pg_temp.k(text),pg_temp.rid(text),pg_temp.res(text),pg_temp.rev(text),
 pg_temp.obs(text,uuid,text,timestamptz,text,jsonb,jsonb),pg_temp.svc(text,text,uuid,timestamptz,text,jsonb),pg_temp.diet(text,text,timestamptz,jsonb),pg_temp.deliver(text,text,text,text,text,uuid),pg_temp.subst(text,date,text,timestamptz,jsonb) TO authenticated,service_role;

-- Central versions (owner): recorder lists and typed inputs are fixtures.
SELECT pg_temp.c_login('owner');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'v_'||x.label,public.save_operation_requirement_draft_review(x.act,jsonb_build_object('title',x.title,'wording',x.title||'.','allowed_recorder_roles',x.roles)||x.extra)
 FROM cf CROSS JOIN LATERAL (VALUES
  ('aed_op',cf.act_aed_op,'Check AED operation','["maintenance_role","facility_admin"]'::jsonb,jsonb_build_object('required_inputs',jsonb_build_array(jsonb_build_object('key','status_ok','label','Status indicator OK','type','boolean','required',true)))),
  ('aed_eq',cf.act_aed_eq,'Check AED equipment currency','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('ext_insp',cf.act_ext_insp,'Record fire extinguisher inspection','["maintenance_role","facility_admin"]'::jsonb,jsonb_build_object('required_inputs',jsonb_build_array(jsonb_build_object('key','tag_year','label','Tag year','type','number','required',false,'min',2000,'max',2100)))),
  ('ext_cur',cf.act_ext_cur,'Check extinguisher currency','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('hood',cf.act_hood,'Record hood cleaning','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('ac',cf.act_ac,'Change AC filter','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('fire_safety',cf.act_fire_safety,'Record fire safety inspection','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('fire',cf.act_fire,'Record fire inspection','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('sprk',cf.act_sprk,'Record sprinkler inspection','["maintenance_role","facility_admin"]'::jsonb,'{}'::jsonb),
  ('food',cf.act_food,'Check emergency food supply','["dietary","maintenance_role","facility_admin"]'::jsonb,jsonb_build_object('required_inputs',jsonb_build_array(jsonb_build_object('key','cases_counted','label','Cases counted','type','number','required',false,'min',0,'max',1000)))),
  ('meal',cf.act_meal,'Record meal substitution','["dietary","facility_admin"]'::jsonb,'{}'::jsonb),
  ('menu',cf.act_menu,'Record dietitian menu approval','["dietary","facility_admin"]'::jsonb,'{}'::jsonb)) x(label,act,title,roles,extra);
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'v\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'v\_%';
SELECT pg_temp.c_assert((SELECT count(*)=12 FROM cf_results WHERE label LIKE 'pub\_v%' AND result->>'status'='published'),'central versions not published');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'fr_'||x.label,public.save_operation_facility_requirement_draft_review(x.act,site_a,jsonb_build_object('applicability','applicable','requirement_version_id',pg_temp.rid('v_'||x.label),
 'schedule_status','confirmed','schedule_rule','{"rule_version":1,"timezone":"America/New_York","recurrence":{"kind":"weekly","weekday":"tuesday"},"deadline":{"time":"10:00","grace_minutes":120}}'::jsonb))
 FROM cf CROSS JOIN LATERAL (VALUES('aed_op',cf.act_aed_op),('aed_eq',cf.act_aed_eq),('ext_insp',cf.act_ext_insp),('ext_cur',cf.act_ext_cur),('hood',cf.act_hood),('ac',cf.act_ac),
  ('fire_safety',cf.act_fire_safety),('fire',cf.act_fire),('sprk',cf.act_sprk),('food',cf.act_food),('meal',cf.act_meal),('menu',cf.act_menu)) x(label,act);
INSERT INTO cf_ids SELECT label,(result->>'id')::uuid FROM cf_results WHERE label LIKE 'fr\_%';
INSERT INTO cf_results SELECT 'pub_'||label,public.publish_operation_facility_requirement_review(id,(SELECT since FROM cf)) FROM cf_ids WHERE label LIKE 'fr\_%';
SELECT pg_temp.c_assert((SELECT count(*)=12 FROM cf_results WHERE label LIKE 'pub_fr%' AND result->>'status'='published'),'site configurations not published');
INSERT INTO cf_results SELECT 'b_'||x.label,public.enroll_operation_binding_review(x.act,site_a,x.subj,'asset',NULL,jsonb_build_object('source','admin_log','reason',x.label),since)
 FROM cf CROSS JOIN LATERAL (VALUES('aed_op_aed1',cf.act_aed_op,cf.subj_aed1),('aed_eq_aed1',cf.act_aed_eq,cf.subj_aed1),('ext_insp_ext1',cf.act_ext_insp,cf.subj_ext1),('ext_insp_ext2',cf.act_ext_insp,cf.subj_ext2),
  ('ext_cur_ext1',cf.act_ext_cur,cf.subj_ext1),('hood_hood1',cf.act_hood,cf.subj_hood1),('ac_ac1',cf.act_ac,cf.subj_ac1)) x(label,act,subj);
RESET ROLE;
-- Occurrences from the service generator: every d0 period starts yesterday (so a late instant matches whatever the hour); d1 is the following week.
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
INSERT INTO cf_results SELECT 'g_'||x.label,public.generate_operation_occurrences_service(site_a,pg_temp.rid('fr_'||x.label),
 jsonb_build_array(pg_temp.occ2(d0,d0-1,d0+5,'America/New_York','10:00',120),pg_temp.occ2(d1,d1,d1+6,'America/New_York','10:00',120)),pg_temp.run('run-'||x.label,d0,d1,pg_temp.rid('fr_'||x.label)))
 FROM cf CROSS JOIN LATERAL (VALUES('aed_op'),('aed_eq'),('ext_insp'),('ext_cur'),('hood'),('ac'),('fire_safety'),('fire'),('sprk'),('food'),('meal'),('menu')) x(label);
SELECT pg_temp.c_assert((SELECT (result->'counts'->>'created')::int=4 FROM cf_results WHERE label='g_ext_insp') AND (SELECT bool_and((result->'counts'->>'created')::int=2) FROM cf_results WHERE label LIKE 'g\_%' AND label<>'g_ext_insp'),'occurrences not generated');
INSERT INTO cf_ids SELECT 'occ_aed_op_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_aed_op AND t.subject_id=cf.subj_aed1 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_aed_eq_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_aed_eq AND t.subject_id=cf.subj_aed1 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_ext_insp1_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_ext_insp AND t.subject_id=cf.subj_ext1 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_ext_insp2_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_ext_insp AND t.subject_id=cf.subj_ext2 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_ext_cur_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_ext_cur AND t.subject_id=cf.subj_ext1 AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_hood_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_hood AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_ac_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_ac AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_fire_safety_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_fire_safety AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_fire_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_fire AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_sprk_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_sprk AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_food_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_food AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_meal_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_meal AND t.assigned_shift_date=cf.d0;
INSERT INTO cf_ids SELECT 'occ_menu_d0',t.id FROM cf JOIN public.operation_task_instances t ON t.activity_id=cf.act_menu AND t.assigned_shift_date=cf.d0;
SELECT pg_temp.c_assert((SELECT count(*)=13 FROM cf_ids WHERE label LIKE 'occ\_%'),'occurrence identities not captured');
RESET ROLE;
SELECT pg_temp.c_clear();
-- Snapshots of everything a service record must never write.
CREATE TEMP TABLE cf_untouched AS SELECT
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.facility_assets a WHERE a.facility_id=(SELECT site_a FROM cf)) assets,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.facility_building_profiles p WHERE p.facility_id=(SELECT site_a FROM cf)) profile,
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.facility_documents d WHERE d.id IN(SELECT doc1 FROM cf UNION SELECT doc_arch FROM cf UNION SELECT doc_b FROM cf)) documents,
 (SELECT to_jsonb(f)-'updated_at' FROM public.facilities f WHERE f.id=(SELECT site_a FROM cf)) facility,
 (SELECT count(*) FROM public.maintenance_tickets) tickets,(SELECT count(*) FROM public.maintenance_task_completions) completions,
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.meal_services m WHERE m.id=(SELECT ms_lunch FROM cf)) meal_service;
-- FIXTURES-END

-- 1. AED: an operation check satisfies exactly its component for its AED; the equipment component stays pending until its own record; a check against an extinguisher is refused by name; a second operation check in the week is a visible conflict.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'obs_aed_op',pg_temp.obs('aed-op-000001',aed1,'aed_operation_check',recent,'pass','{"status_ok":true}') FROM cf;
INSERT INTO cf_ids SELECT 'o_aed_op',(result->'record'->>'id')::uuid FROM cf_results WHERE label='obs_aed_op';
INSERT INTO cf_ids SELECT 'r_aed_op',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='obs_aed_op';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_aed_op_d0')
 AND result->'delivery'->'event'->>'source_key'='asset-observation' AND result->'delivery'->'receipt'->'values'='{"status_ok":true}'::jsonb AND result->'delivery'->'receipt'->>'completion_state'='completed'
 AND result->'record'->>'observation_kind'='aed_operation_check' FROM cf_results WHERE label='obs_aed_op'),'an AED operation check did not satisfy its component');
SELECT pg_temp.c_assert((SELECT status='completed' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_aed_op_d0')) AND (SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_aed_eq_d0')),'the AED equipment component was touched by the operation check');
RESET ROLE;
-- The aide (outside the recorder list) records the still-pending equipment check: final record, delivery refused with attention, nothing satisfied.
SELECT pg_temp.c_login('aide');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'obs_aed_aide',pg_temp.obs('aed-aide-00001',aed1,'aed_equipment_check',recent,'pass') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='refused' AND result->'delivery'->'event'->>'reason'='recorder_not_authorized' AND (result->'delivery'->'event'->>'attention')::boolean AND result->'record'->>'finalized_at' IS NOT NULL FROM cf_results WHERE label='obs_aed_aide'),'an unauthorised recorder was hidden or satisfied');
SELECT pg_temp.c_assert((SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_aed_eq_d0')),'an unauthorised recorder touched the occurrence');
RESET ROLE;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'obs_aed_eq',pg_temp.obs('aed-eq-000001',aed1,'aed_equipment_check',recent,'pass','{}'::jsonb,'{"note":"Pads and battery in date"}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_aed_eq_d0') AND result->'delivery'->'receipt'->>'note'='Pads and battery in date' FROM cf_results WHERE label='obs_aed_eq'),'an AED equipment check did not satisfy its component');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('aed-bad-000001',(SELECT ext1 FROM cf),'aed_operation_check',(SELECT recent FROM cf),'pass')$q$,'An AED check is recorded against an AED');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('aed-bad-000002',(SELECT aed1 FROM cf),'generator_test',(SELECT recent FROM cf),'pass')$q$,'A generator test is recorded against a generator');
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('aed-bad-000003',(SELECT aed1 FROM cf),'pad_check',(SELECT recent FROM cf),'pass')$q$,'observation_kind must be');
INSERT INTO cf_results SELECT 'obs_aed_op_dup',pg_temp.obs('aed-op-000002',aed1,'aed_operation_check',recent,'pass','{"status_ok":true}') FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='conflict' AND result->'delivery'->'event'->>'reason'='already_recorded' AND (result->'delivery'->'event'->>'attention')::boolean FROM cf_results WHERE label='obs_aed_op_dup'),'a duplicate AED check was not a visible conflict');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_aed_op_d0')) AND (SELECT count(*)=4 FROM public.asset_observations),'duplicate handling drifted');
-- The generator/CO kinds are unchanged by the widening: a generator test against the AED is still refused by the 154 wording (above); the 154 record command still refuses a self-test by name.
SELECT pg_temp.c_expect($q$SELECT pg_temp.obs('aed-bad-000004',(SELECT aed1 FROM cf),'aed_operation_check',(SELECT recent FROM cf),'pass','{}','{"basis":"automatic_self_test"}')$q$,'is not a staff observation');
RESET ROLE;

-- 2. Services: a vendor extinguisher inspection satisfies the inspection once as an on-behalf entry with the vendor as performer; the separate currency check stays pending; the asset's service dates, the certificate document, the building profile and the tickets are untouched.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('ext-insp-00001','extinguisher_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','vendor','vendor_id',(SELECT vendor_ok FROM cf)))$q$,'must be entered on behalf with a reason');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('ext-insp-00001','extinguisher_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','vendor','vendor_id',(SELECT vendor_unlinked FROM cf),'entry_reason','Vendor visit'))$q$,'Performer vendor is not linked to this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('ext-insp-00001','extinguisher_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','vendor','vendor_id',(SELECT vendor_ok FROM cf),'performed_by',(SELECT maint FROM cf),'entry_reason','Vendor visit'))$q$,'performed_by must be empty for a vendor performer');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('ext-insp-00001','extinguisher_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','vendor','entry_reason','Vendor visit'))$q$,'vendor_id must be set for a vendor performer');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('ext-insp-00001','extinguisher_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','staff','vendor_id',(SELECT vendor_ok FROM cf)))$q$,'must be empty for a staff performer');
INSERT INTO cf_results SELECT 'svc_ext1',pg_temp.svc('ext-insp-00001','extinguisher_inspection',ext1,recent,'pass',jsonb_build_object('performer_kind','vendor','vendor_id',vendor_ok,'performer_label','Technician on the certificate','entry_reason','Vendor visit; certificate on file',
 'certificate_document_id',doc1,'next_due_on',to_char(d0+365,'YYYY-MM-DD'),'readings',jsonb_build_object('tag_year',2026))) FROM cf;
INSERT INTO cf_ids SELECT 's_ext1',(result->'record'->>'id')::uuid FROM cf_results WHERE label='svc_ext1';
INSERT INTO cf_ids SELECT 'ev_ext1',(result->'delivery'->'event'->>'id')::uuid FROM cf_results WHERE label='svc_ext1';
INSERT INTO cf_ids SELECT 'r_ext1',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='svc_ext1';
SELECT pg_temp.c_assert((SELECT array_agg(k ORDER BY k)=ARRAY['delivery','linked','record','replayed'] FROM jsonb_object_keys(pg_temp.res('svc_ext1')) k),'record reply keys drifted');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->>'replayed')::boolean=false AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'attention')::boolean=false
 AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_ext_insp1_d0') AND (result->'delivery'->'event'->>'subject_id')::uuid=(SELECT subj_ext1 FROM cf) AND result->'delivery'->'event'->>'source_key'='asset-service'
 AND result->'delivery'->'event'->>'source_record_id'=pg_temp.rid('s_ext1')::text AND result->'delivery'->'event'->>'source_record_version'='1'
 AND (result->'delivery'->'receipt'->>'recorder_id')::uuid=(SELECT admin_a FROM cf) AND result->'delivery'->'receipt'->>'performer_kind'='vendor' AND (result->'delivery'->'receipt'->>'performer_vendor_id')::uuid=(SELECT vendor_ok FROM cf)
 AND result->'delivery'->'receipt'->>'performer_label'='Technician on the certificate' AND result->'delivery'->'receipt'->>'entry_kind'='on_behalf' AND result->'delivery'->'receipt'->>'entry_reason'='Vendor visit; certificate on file'
 AND result->'delivery'->'receipt'->'values'='{"tag_year":2026}'::jsonb AND result->'delivery'->'receipt'->>'completion_state'='completed' AND (result->'delivery'->'receipt'->>'performed_at')::timestamptz=(SELECT recent FROM cf)
 AND (result->'record'->>'next_due_on')::date=(SELECT d0+365 FROM cf) AND (result->'record'->>'certificate_document_id')::uuid=(SELECT doc1 FROM cf) AND (result->'record'->>'record_version')::int=1 AND result->'record'->>'performed_by' IS NULL
 FROM cf_results WHERE label='svc_ext1'),'a vendor extinguisher inspection did not satisfy its occurrence as an on-behalf vendor entry');
SELECT pg_temp.c_assert((SELECT status='completed' AND effective_receipt_id=pg_temp.rid('r_ext1') FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ext_insp1_d0'))
 AND (SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ext_cur_d0'))
 AND (SELECT status='pending' AND execution_state='none' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ext_insp2_d0')),'an inspection touched the currency check or the other extinguisher');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(action='record' AND source_key='asset-service' AND source_event_id=pg_temp.rid('ev_ext1')) FROM public.operation_source_record_requests WHERE source_record_id=pg_temp.rid('s_ext1')::text),'request row not written');
-- Replay by key returns the same reply; the same key with other content conflicts.
INSERT INTO cf_results SELECT 'svc_ext1_replay',pg_temp.svc('ext-insp-00001','extinguisher_inspection',ext1,recent,'pass',jsonb_build_object('performer_kind','vendor','vendor_id',vendor_ok,'performer_label','Technician on the certificate','entry_reason','Vendor visit; certificate on file',
 'certificate_document_id',doc1,'next_due_on',to_char(d0+365,'YYYY-MM-DD'),'readings',jsonb_build_object('tag_year',2026))) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND (result->'record'->>'id')::uuid=pg_temp.rid('s_ext1') AND (result->'delivery'->'event'->>'id')::uuid=pg_temp.rid('ev_ext1') FROM cf_results WHERE label='svc_ext1_replay'),'replay did not return the stored reply');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('ext-insp-00001','extinguisher_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','vendor','vendor_id',(SELECT vendor_ok FROM cf),'entry_reason','Other'))$q$,'already saved with different content');
-- A second inspection of the same extinguisher in the week is a visible conflict, never a second satisfaction.
INSERT INTO cf_results SELECT 'svc_ext1_dup',pg_temp.svc('ext-insp-00002','extinguisher_inspection',ext1,recent,'pass',jsonb_build_object('performer_kind','staff')) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='conflict' AND result->'delivery'->'event'->>'reason'='already_recorded' AND (result->'delivery'->'event'->>'attention')::boolean FROM cf_results WHERE label='svc_ext1_dup'),'a duplicate inspection was not a conflict');
-- 2a. One vendor visit is two records: a fire inspection (staff self) and a sprinkler inspection (vendor) satisfy their own components; the fire safety inspection stays pending.
INSERT INTO cf_results SELECT 'svc_fire',pg_temp.svc('fire-insp-0001','fire_inspection',NULL,recent,'pass',jsonb_build_object('performer_kind','staff','note','Panel and pulls tested','certificate_document_id',doc1)) FROM cf;
INSERT INTO cf_results SELECT 'svc_sprk',pg_temp.svc('sprk-insp-0001','sprinkler_inspection',NULL,recent,'pass',jsonb_build_object('performer_kind','vendor','vendor_id',vendor_ok,'entry_reason','Vendor visit','next_due_on',to_char(d0+90,'YYYY-MM-DD'))) FROM cf;
INSERT INTO cf_ids SELECT 's_fire',(result->'record'->>'id')::uuid FROM cf_results WHERE label='svc_fire';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fire_d0') AND result->'delivery'->'event'->>'source_key'='facility-service' AND result->'delivery'->'receipt'->>'performer_kind'='self'
 AND result->'delivery'->'receipt'->>'entry_kind'='routine' AND (result->'record'->>'performed_by')::uuid=(SELECT admin_a FROM cf) AND result->'record'->>'asset_id' IS NULL FROM cf_results WHERE label='svc_fire'),'a staff fire inspection did not satisfy its component');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_sprk_d0') AND result->'delivery'->'receipt'->>'performer_kind'='vendor' AND result->'delivery'->'receipt'->>'performer_label'='Probe Fire Services' FROM cf_results WHERE label='svc_sprk'),'a vendor sprinkler inspection did not satisfy its component with the vendor name as label');
SELECT pg_temp.c_assert((SELECT status='pending' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_fire_safety_d0')),'a fire inspection satisfied the fire safety inspection');
-- Hood cleaning and AC filter change satisfy their asset occurrences (the fixture rule stands in for the unresolved Q09 answer).
RESET ROLE;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'svc_hood',pg_temp.svc('hood-clean-001','hood_cleaning',hood1,recent,'pass',jsonb_build_object('performer_kind','vendor','vendor_id',vendor_ok,'entry_reason','Cleaning crew; certificate on the hood')) FROM cf;
INSERT INTO cf_results SELECT 'svc_ac',pg_temp.svc('ac-filter-0001','ac_filter_change',ac1,recent,'pass','{}'::jsonb) FROM cf;
INSERT INTO cf_ids SELECT 's_ac',(result->'record'->>'id')::uuid FROM cf_results WHERE label='svc_ac';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_hood_d0') FROM cf_results WHERE label='svc_hood')
 AND (SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_ac_d0') AND result->'record'->>'performer_kind'='staff' AND (result->'record'->>'performed_by')::uuid=(SELECT maint FROM cf) FROM cf_results WHERE label='svc_ac'),'hood cleaning or AC filter change did not satisfy');
-- 2b. Refusals by name write nothing: wrong subject shape, wrong asset type, retired asset, other site's or archived certificate, next-due before the service date, future instant, unstated late, failed without issue, stranger staff, unknown kind, unknown field.
CREATE TEMP TABLE cf_before AS SELECT (SELECT count(*) FROM public.facility_service_records) svc,(SELECT count(*) FROM public.dietary_records) diet,(SELECT count(*) FROM public.operation_source_record_requests) req,(SELECT count(*) FROM public.operation_source_events) ev;
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000001','fire_safety_inspection',(SELECT ext1 FROM cf),(SELECT recent FROM cf),'pass')$q$,'is recorded against the site, not an asset');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000002','extinguisher_inspection',NULL,(SELECT recent FROM cf),'pass')$q$,'is recorded against a named asset');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000003','hood_cleaning',(SELECT ac1 FROM cf),(SELECT recent FROM cf),'pass')$q$,'A hood cleaning is recorded against a hood suppression system or kitchen equipment');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000004','ac_filter_change',(SELECT hood1 FROM cf),(SELECT recent FROM cf),'pass')$q$,'An AC filter change is recorded against an AC unit');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000005','extinguisher_inspection',(SELECT aed1 FROM cf),(SELECT recent FROM cf),'pass')$q$,'An extinguisher inspection is recorded against a fire extinguisher');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000006','ac_filter_change',(SELECT ac_ret FROM cf),(SELECT recent FROM cf),'pass')$q$,'Asset is not current at this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000007','ac_filter_change',(SELECT aed_b FROM cf),(SELECT recent FROM cf),'pass')$q$,'Asset is not current at this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000008','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('certificate_document_id',(SELECT doc_b FROM cf)))$q$,'Certificate is not a current document of this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000009','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('certificate_document_id',(SELECT doc_arch FROM cf)))$q$,'Certificate is not a current document of this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000010','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('next_due_on',to_char((SELECT d0 FROM cf),'YYYY-MM-DD')))$q$,'next_due_on must be after the service date');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000011','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('next_due_on','soon'))$q$,'must be a calendar date');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000012','fire_inspection',NULL,clock_timestamp()+interval '1 hour','pass')$q$,'Performed time cannot be in the future');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000013','fire_inspection',NULL,(SELECT past_due FROM cf),'pass')$q$,'must be entered as late with a reason');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000014','fire_inspection',NULL,(SELECT recent FROM cf),'fail')$q$,'A failed outcome requires an issue summary');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000015','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','staff','performed_by',(SELECT admin_b FROM cf),'entry_reason','Covering'))$q$,'Performer is not current staff at this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000016','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','staff','performed_by',(SELECT admin_a FROM cf)))$q$,'must be entered on behalf with a reason');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000017','elevator_inspection',NULL,(SELECT recent FROM cf),'pass')$q$,'service_kind must be');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000018','fire_inspection',NULL,(SELECT recent FROM cf),'pass','{"surprise":true}')$q$,'not editable');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000019','fire_inspection',NULL,(SELECT recent FROM cf),'pass','{"readings":{"Bad Key":1}}')$q$,'readings must be keyed');
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bad-000020','fire_inspection',NULL,(SELECT recent FROM cf),'pass',jsonb_build_object('performer_kind','contractor'))$q$,'performer_kind must be staff or vendor');
SELECT pg_temp.c_expect($q$SELECT public.record_facility_service_review('short','{}')$q$,'A request key is required');
SELECT pg_temp.c_assert((SELECT svc=(SELECT count(*) FROM public.facility_service_records) AND req=(SELECT count(*) FROM public.operation_source_record_requests) AND ev=(SELECT count(*) FROM public.operation_source_events) FROM cf_before),'a refused service record wrote something');
-- A late inspection with its reason is recorded as late; a facility-kind record delivered through the asset-service key is a recorded reader failure, never a satisfaction.
INSERT INTO cf_results SELECT 'svc_fire_safety',pg_temp.svc('fs-insp-000001','fire_safety_inspection',NULL,past_due,'pass',jsonb_build_object('entry_reason','Walked the inspector out first')) FROM cf;
INSERT INTO cf_ids SELECT 's_fire_safety',(result->'record'->>'id')::uuid FROM cf_results WHERE label='svc_fire_safety';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'receipt'->>'entry_kind'='late' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_fire_safety_d0') FROM cf_results WHERE label='svc_fire_safety'),'a late fire safety inspection was not recorded as late');
INSERT INTO cf_results SELECT 'del_wrong_key',pg_temp.deliver('wrong-key-0001','asset-service',pg_temp.rid('s_fire')::text,'1','final',site_a) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'event'->>'state'='refused' AND result->'event'->>'reason'='reader_failed' AND result->'event'->>'detail' LIKE '%facility-service adapter%' FROM cf_results WHERE label='del_wrong_key'),'a site service delivered through the asset adapter was not a recorded reader failure');
RESET ROLE;
-- Nothing a service record must never write has changed.
SELECT pg_temp.c_assert((SELECT assets=(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.facility_assets a WHERE a.facility_id=(SELECT site_a FROM cf)) FROM cf_untouched),'a service record wrote an asset');
SELECT pg_temp.c_assert((SELECT profile IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.facility_building_profiles p WHERE p.facility_id=(SELECT site_a FROM cf)) FROM cf_untouched),'a service record wrote the building profile');
SELECT pg_temp.c_assert((SELECT documents=(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.facility_documents d WHERE d.id IN(SELECT doc1 FROM cf UNION SELECT doc_arch FROM cf UNION SELECT doc_b FROM cf)) FROM cf_untouched),'a service record wrote a document');
SELECT pg_temp.c_assert((SELECT facility=(SELECT to_jsonb(f)-'updated_at' FROM public.facilities f WHERE f.id=(SELECT site_a FROM cf)) FROM cf_untouched),'a service record wrote the facility');
SELECT pg_temp.c_assert((SELECT tickets=(SELECT count(*) FROM public.maintenance_tickets) AND completions=(SELECT count(*) FROM public.maintenance_task_completions) FROM cf_untouched),'a service record wrote a maintenance ticket or completion');
SELECT pg_temp.c_assert((SELECT last_service_at=(SELECT d0-400 FROM cf) AND next_service_due_at=(SELECT d0-35 FROM cf) AND last_service_vendor_id IS NULL FROM public.facility_assets WHERE id=(SELECT ext1 FROM cf)),'the inspected extinguisher service dates moved');

-- 3. Dietary: a meal substitution is meal-level and satisfies its period once; a second in the period is a visible conflict; wrong-date, wrong-service and failed substitutions are refused; a menu approval keeps its labels verbatim; a failed emergency food check opens an issue that its void leaves open.
SELECT pg_temp.c_login('cook');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'sub_lunch',pg_temp.subst('sub-000001',d0,'lunch',recent,jsonb_build_object('meal_service_id',ms_lunch)) FROM cf;
INSERT INTO cf_ids SELECT 'd_sub_lunch',(result->'record'->>'id')::uuid FROM cf_results WHERE label='sub_lunch';
INSERT INTO cf_ids SELECT 'r_sub_lunch',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='sub_lunch';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_meal_d0') AND result->'delivery'->'event'->>'source_key'='dietary-record'
 AND (result->'delivery'->'receipt'->>'recorder_id')::uuid=(SELECT cook FROM cf) AND result->'delivery'->'receipt'->>'performer_kind'='self' AND result->'delivery'->'receipt'->>'outcome'='performed'
 AND result->'record'->>'planned_item'='Baked chicken' AND result->'record'->>'substitute_item'='Turkey loaf' AND result->'record'->>'meal_period'='lunch' AND (result->'record'->>'meal_service_id')::uuid=(SELECT ms_lunch FROM cf)
 AND (result->'record'->>'service_date')::date=(SELECT d0 FROM cf) AND result->'record'->>'outcome'='performed' FROM cf_results WHERE label='sub_lunch'),'a meal substitution did not satisfy its period as a meal-level record');
INSERT INTO cf_results SELECT 'sub_dinner',pg_temp.subst('sub-000002',d0,'dinner',recent) FROM cf;
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='conflict' AND result->'delivery'->'event'->>'reason'='already_recorded' AND (result->'delivery'->'event'->>'attention')::boolean AND result->'record'->>'finalized_at' IS NOT NULL FROM cf_results WHERE label='sub_dinner'),'a second substitution in the period was not a visible conflict');
SELECT pg_temp.c_assert((SELECT count(*)=1 FROM public.operation_execution_receipts WHERE task_instance_id=pg_temp.rid('occ_meal_d0')) AND (SELECT count(*)=2 FROM public.dietary_records WHERE record_kind='meal_substitution'),'substitution handling drifted');
CREATE TEMP TABLE cf_before_diet AS SELECT (SELECT count(*) FROM public.dietary_records) diet,(SELECT count(*) FROM public.operation_source_record_requests) req,(SELECT count(*) FROM public.operation_source_events) ev;
SELECT pg_temp.c_expect($q$SELECT pg_temp.subst('sub-bad-00001',(SELECT dold FROM cf),'lunch',(SELECT recent FROM cf))$q$,'A meal substitution is recorded on its service date');
SELECT pg_temp.c_expect($q$SELECT pg_temp.subst('sub-bad-00002',(SELECT d0 FROM cf),'dinner',(SELECT recent FROM cf),jsonb_build_object('meal_service_id',(SELECT ms_lunch FROM cf)))$q$,'Meal service must be this site''s service for that date and period');
SELECT pg_temp.c_expect($q$SELECT pg_temp.subst('sub-bad-00003',(SELECT d0 FROM cf),'brunch',(SELECT recent FROM cf))$q$,'meal_period must be');
SELECT pg_temp.c_expect($q$SELECT pg_temp.subst('sub-bad-00004',(SELECT d0 FROM cf),'lunch',(SELECT recent FROM cf),'{"outcome":"failed","issue_summary":"x"}')$q$,'A meal substitution is recorded as performed');
SELECT pg_temp.c_expect($q$SELECT pg_temp.subst('sub-bad-00005',(SELECT d0 FROM cf),'lunch',(SELECT recent FROM cf),'{"menu_label":"x"}')$q$,'must be empty for a meal substitution');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('sub-bad-00006','meal_substitution',(SELECT recent FROM cf),'{"service_date":"2026-09-10"}')$q$,'are required for a meal substitution');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('menu-bad-0001','menu_approval',(SELECT recent FROM cf),'{"menu_label":"Fall cycle"}')$q$,'menu_label and approver_label are required');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('menu-bad-0002','menu_approval',(SELECT recent FROM cf),'{"menu_label":"Fall cycle","approver_label":"RD on file","service_date":"2026-09-10"}')$q$,'meal fields must be empty for a menu approval');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('menu-bad-0003','menu_approval',(SELECT recent FROM cf),jsonb_build_object('menu_label','Fall cycle','approver_label','RD on file','approval_document_id',(SELECT doc_b FROM cf)))$q$,'Approval document is not a current document of this site');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('menu-bad-0004','menu_approval',(SELECT recent FROM cf),'{"menu_label":"Fall cycle","approver_label":"RD on file","outcome":"failed","issue_summary":"x"}')$q$,'A menu approval is recorded as performed');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('food-bad-0001','emergency_food_supply_check',(SELECT recent FROM cf),'{"outcome":"failed"}')$q$,'A failed outcome requires an issue summary');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('food-bad-0002','emergency_food_supply_check',(SELECT recent FROM cf),'{"planned_item":"x"}')$q$,'must be empty for an emergency food supply check');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('food-bad-0003','pantry_check',(SELECT recent FROM cf))$q$,'record_kind must be');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('food-bad-0004','emergency_food_supply_check',(SELECT recent FROM cf),'{"resident_id":"x"}')$q$,'not editable');
SELECT pg_temp.c_assert((SELECT diet=(SELECT count(*) FROM public.dietary_records) AND req=(SELECT count(*) FROM public.operation_source_record_requests) AND ev=(SELECT count(*) FROM public.operation_source_events) FROM cf_before_diet),'a refused dietary record wrote something');
-- Menu approval: labels verbatim, late with its reason, the approval document referenced and untouched.
INSERT INTO cf_results SELECT 'menu_ok',pg_temp.diet('menu-000001','menu_approval',past_due,jsonb_build_object('menu_label','Fall 2026 cycle menu','approver_label','Consulting dietitian, RD (per signed sheet)','approval_document_id',doc1,'entry_reason','Signed sheet received after the call')) FROM cf;
INSERT INTO cf_ids SELECT 'd_menu',(result->'record'->>'id')::uuid FROM cf_results WHERE label='menu_ok';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_menu_d0') AND result->'delivery'->'receipt'->>'entry_kind'='late'
 AND result->'record'->>'menu_label'='Fall 2026 cycle menu' AND result->'record'->>'approver_label'='Consulting dietitian, RD (per signed sheet)' AND (result->'record'->>'approval_document_id')::uuid=(SELECT doc1 FROM cf) FROM cf_results WHERE label='menu_ok'),'a menu approval did not satisfy with its labels verbatim');
-- Emergency food supply: a failed check by maintenance on behalf of the cook opens an issue; the void reverses, leaves the attention row and keeps the issue open.
RESET ROLE;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'food_fail',pg_temp.diet('food-000001','emergency_food_supply_check',recent,jsonb_build_object('performed_by',cook,'outcome','failed','issue_summary','Two cases past date','entry_reason','Cook counted; I logged','readings',jsonb_build_object('cases_counted',18))) FROM cf;
INSERT INTO cf_ids SELECT 'd_food',(result->'record'->>'id')::uuid FROM cf_results WHERE label='food_fail';
INSERT INTO cf_ids SELECT 'r_food',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='food_fail';
INSERT INTO cf_ids SELECT 'i_food',(result->'delivery'->'receipt'->>'issue_id')::uuid FROM cf_results WHERE label='food_fail';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'receipt'->>'outcome'='failed' AND result->'delivery'->'receipt'->>'completion_state'='failed' AND result->'delivery'->'receipt'->>'entry_kind'='on_behalf'
 AND result->'delivery'->'receipt'->>'performer_kind'='other_staff' AND (result->'delivery'->'receipt'->>'performer_user_id')::uuid=(SELECT cook FROM cf) AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_food_d0')
 AND result->'delivery'->'occurrence'->>'execution_state'='failed' FROM cf_results WHERE label='food_fail'),'a failed food check did not open an issue and leave the occurrence failed');
SELECT pg_temp.c_assert((SELECT status='open' AND issue_kind='failed_result' AND summary='Two cases past date' AND receipt_id=pg_temp.rid('r_food') FROM public.operation_issues WHERE id=pg_temp.rid('i_food')),'issue not bound to the source receipt');
INSERT INTO cf_results SELECT 'void_food',public.void_dietary_record_review(pg_temp.rid('d_food'),pg_temp.k('food-void-0001'),'{"reason":"Counted the wrong shelf"}');
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean=false AND result->'delivery'->'event'->>'state'='invalidated' AND (result->'delivery'->'event'->>'attention')::boolean AND result->'delivery'->'event'->>'event_kind'='voided'
 AND result->'delivery'->'receipt'->>'receipt_kind'='reversal' AND result->'delivery'->'occurrence'->>'execution_state'='none' AND result->'record'->>'voided_at' IS NOT NULL AND result->'record'->>'void_reason'='Counted the wrong shelf' FROM cf_results WHERE label='void_food'),'a dietary void did not reverse into retained history');
SELECT pg_temp.c_assert((SELECT status='open' AND receipt_id=pg_temp.rid('r_food') FROM public.operation_issues WHERE id=pg_temp.rid('i_food')),'a void closed or unbound the issue');
SELECT pg_temp.c_expect($q$SELECT public.void_dietary_record_review(pg_temp.rid('d_food'),pg_temp.k('food-void-0002'),'{"reason":"Again"}')$q$,'already voided',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_dietary_record_review(pg_temp.rid('d_food'),pg_temp.k('food-cor-00001'),1,'{"reason":"x","note":"y"}')$q$,'Dietary record is voided',NULL,'P0001');
RESET ROLE;

-- 4. Corrections: readings supersede as a 344 chain; a stale version conflicts naming the current one; a kind never changes; a no-op is refused; an asset move within the kind invalidates the first occurrence and satisfies the second as a fresh chain; a cross-person correction is an on-behalf restatement.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'cor_ext1',public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000001'),1,'{"reason":"Tag year misread","readings":{"tag_year":2025}}');
INSERT INTO cf_ids SELECT 'r_ext1_v2',(result->'delivery'->'receipt'->>'id')::uuid FROM cf_results WHERE label='cor_ext1';
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='corrected' AND result->'delivery'->'event'->>'source_record_version'='2' AND (result->'delivery'->'receipt'->>'corrects_receipt_id')::uuid=pg_temp.rid('r_ext1')
 AND result->'delivery'->'receipt'->'values'='{"tag_year":2025}'::jsonb AND result->'delivery'->'receipt'->>'performer_kind'='vendor' AND result->'delivery'->'receipt'->>'entry_kind'='on_behalf'
 AND (result->'record'->>'record_version')::int=2 AND result->'record'->>'correction_reason'='Tag year misread' FROM cf_results WHERE label='cor_ext1'),'a service correction did not supersede as a chain');
SELECT pg_temp.c_assert((SELECT superseded_by_receipt_id=pg_temp.rid('r_ext1_v2') FROM public.operation_execution_receipts WHERE id=pg_temp.rid('r_ext1')),'the corrected receipt was not superseded');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000002'),1,'{"reason":"Stale","note":"x"}')$q$,'Record changed since it was read','current_record_version=2','P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000003'),2,'{"reason":"Wrong kind","service_kind":"hood_cleaning"}')$q$,'Service kind cannot change; void the record and record it again');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000004'),2,'{"reason":"No-op","readings":{"tag_year":2025}}')$q$,'A correction must restate at least one field');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000005'),2,jsonb_build_object('reason','Later','performed_at',clock_timestamp()+interval '1 hour'))$q$,'Corrected performed time cannot be after the original recording');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000006'),2,'{"reason":"Field","surprise":1}')$q$,'not editable');
SELECT pg_temp.c_expect($q$SELECT public.correct_dietary_record_review(pg_temp.rid('d_menu'),pg_temp.k('menu-cor-00001'),1,'{"reason":"Wrong kind","record_kind":"meal_substitution"}')$q$,'Record kind cannot change; void the record and record it again');
-- Moving the inspection to the other extinguisher: ext2's occurrence is pending, so the record satisfies it as a fresh chain and ext1's occurrence returns to pending; one record never holds two effective receipts.
INSERT INTO cf_results SELECT 'cor_ext1_move',public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000007'),2,jsonb_build_object('reason','It was the hall unit','asset_id',(SELECT ext2 FROM cf)));
SELECT pg_temp.c_assert((SELECT (result->>'linked')::boolean AND result->'delivery'->'event'->>'state'='satisfied' AND (result->'delivery'->'event'->>'task_instance_id')::uuid=pg_temp.rid('occ_ext_insp2_d0') AND (result->'delivery'->'event'->>'subject_id')::uuid=(SELECT subj_ext2 FROM cf)
 AND (result->'delivery'->'receipt'->>'chain_id')::uuid=(result->'delivery'->'receipt'->>'id')::uuid AND (result->'record'->>'record_version')::int=3 FROM cf_results WHERE label='cor_ext1_move'),'moving the record did not satisfy the other extinguisher as a fresh chain');
SELECT pg_temp.c_assert((SELECT status IN('pending','missed') AND execution_state='none' AND effective_receipt_id IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ext_insp1_d0'))
 AND (SELECT status='completed' FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ext_insp2_d0')),'the first occurrence kept the moved record');
SELECT pg_temp.c_assert((SELECT count(*)=1 AND bool_and(task_instance_id=pg_temp.rid('occ_ext_insp2_d0')) FROM public.operation_execution_receipts WHERE source_record_id=pg_temp.rid('s_ext1')::text AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'one record holds two effective receipts');
-- A correction of a vendor record restated to a staff performer without naming one makes the corrector the performer (self); restating back to vendor needs the reason again.
INSERT INTO cf_results SELECT 'cor_ext1_staff',public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000008'),3,'{"reason":"I did this one myself","performer_kind":"staff","entry_reason":null}');
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='corrected' AND result->'delivery'->'receipt'->>'performer_kind'='self' AND result->'delivery'->'receipt'->>'entry_kind'='routine' AND result->'record'->>'performer_kind'='staff'
 AND (result->'record'->>'performed_by')::uuid=(SELECT admin_a FROM cf) AND result->'record'->>'vendor_id' IS NULL AND result->'record'->>'performer_label' IS NULL FROM cf_results WHERE label='cor_ext1_staff'),'restating to a staff performer did not make the corrector the performer');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ext1'),pg_temp.k('ext-cor-000009'),4,jsonb_build_object('reason','Vendor after all','performer_kind','vendor','vendor_id',(SELECT vendor_ok FROM cf)))$q$,'must be entered on behalf with a reason');
RESET ROLE;
-- A correction by someone other than the staff performer needs an entry reason and is recorded on behalf.
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_fire'),pg_temp.k('fire-cor-00001'),1,'{"reason":"Add note","note":"Pull station two sticky"}')$q$,'must be entered on behalf with a reason');
INSERT INTO cf_results SELECT 'cor_fire_other',public.correct_facility_service_review(pg_temp.rid('s_fire'),pg_temp.k('fire-cor-00001'),1,'{"reason":"Add note","note":"Pull station two sticky","entry_reason":"Restated for the administrator"}');
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='corrected' AND result->'delivery'->'receipt'->>'entry_kind'='on_behalf' AND result->'delivery'->'receipt'->>'performer_kind'='other_staff' AND (result->'delivery'->'receipt'->>'recorder_id')::uuid=(SELECT maint FROM cf) FROM cf_results WHERE label='cor_fire_other'),'a cross-person correction was not recorded on behalf');
-- 4a. Void of an asset-kind record whose asset is no longer current is refused by name and changes nothing; un-retiring restores the path.
RESET ROLE;
UPDATE public.facility_assets SET status='retired' WHERE id=(SELECT ac1 FROM cf);
CREATE TEMP TABLE cf_retired_before AS SELECT (SELECT to_jsonb(s) FROM public.facility_service_records s WHERE s.id=pg_temp.rid('s_ac')) rec,(SELECT to_jsonb(t) FROM public.operation_task_instances t WHERE t.id=pg_temp.rid('occ_ac_d0')) occ,
 (SELECT count(*) FROM public.operation_execution_receipts) receipts,(SELECT count(*) FROM public.operation_source_record_requests) requests;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT public.void_facility_service_review(pg_temp.rid('s_ac'),pg_temp.k('ac-void-000001'),'{"reason":"Wrong unit"}')$q$,'Asset is not current at this site; the service record stays as history');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ac'),pg_temp.k('ac-cor-0000001'),1,'{"reason":"Note","note":"x"}')$q$,'Asset is not current at this site');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT to_jsonb(s)=(SELECT rec FROM cf_retired_before) FROM public.facility_service_records s WHERE s.id=pg_temp.rid('s_ac')) AND (SELECT to_jsonb(t)=(SELECT occ FROM cf_retired_before) FROM public.operation_task_instances t WHERE t.id=pg_temp.rid('occ_ac_d0'))
 AND (SELECT receipts=(SELECT count(*) FROM public.operation_execution_receipts) AND requests=(SELECT count(*) FROM public.operation_source_record_requests) FROM cf_retired_before),'a refused void or correction on a retired asset changed something');
UPDATE public.facility_assets SET status='active' WHERE id=(SELECT ac1 FROM cf);
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
INSERT INTO cf_results SELECT 'void_ac',public.void_facility_service_review(pg_temp.rid('s_ac'),pg_temp.k('ac-void-000002'),'{"reason":"Wrong unit"}');
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='invalidated' AND result->'delivery'->'event'->>'source_key'='asset-service' AND result->'record'->>'voided_at' IS NOT NULL FROM cf_results WHERE label='void_ac') AND (SELECT effective_receipt_id IS NULL FROM public.operation_task_instances WHERE id=pg_temp.rid('occ_ac_d0')),'the AC filter void did not reverse');
INSERT INTO cf_results SELECT 'void_ac_replay',public.void_facility_service_review(pg_temp.rid('s_ac'),pg_temp.k('ac-void-000002'),'{"reason":"Wrong unit"}');
SELECT pg_temp.c_assert((SELECT (result->>'replayed')::boolean AND result->'delivery'->'event'->>'state'='invalidated' FROM cf_results WHERE label='void_ac_replay'),'void replay drifted');
SELECT pg_temp.c_expect($q$SELECT public.void_facility_service_review(pg_temp.rid('s_ac'),pg_temp.k('ac-void-000003'),'{"reason":"Again"}')$q$,'already voided',NULL,'P0001');
SELECT pg_temp.c_expect($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_ac'),pg_temp.k('ac-cor-0000002'),1,'{"reason":"x","note":"y"}')$q$,'Service record is voided',NULL,'P0001');
RESET ROLE;

-- 5. Authority: the other site's administrator cannot record, correct or void site A's records and reads none of them; site B's own record lands as unmatched; the site-A administrator sees none of site B.
SELECT pg_temp.c_login('admin_b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$SELECT public.record_facility_service_review(pg_temp.k('b-svc-000001'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'service_kind','fire_inspection','performed_at',(SELECT recent FROM cf),'outcome','pass'))$q$);
SELECT pg_temp.c_denied($q$SELECT public.correct_facility_service_review(pg_temp.rid('s_fire'),pg_temp.k('b-cor-000001'),2,'{"reason":"x","note":"y"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.void_facility_service_review(pg_temp.rid('s_fire'),pg_temp.k('b-void-00001'),'{"reason":"x"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.record_dietary_record_review(pg_temp.k('b-diet-00001'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'record_kind','emergency_food_supply_check','performed_at',(SELECT recent FROM cf)))$q$);
SELECT pg_temp.c_denied($q$SELECT public.void_dietary_record_review(pg_temp.rid('d_menu'),pg_temp.k('b-dvoid-0001'),'{"reason":"x"}')$q$);
SELECT pg_temp.c_denied($q$SELECT public.record_asset_observation_review(pg_temp.k('b-obs-000001'),jsonb_build_object('facility_id',(SELECT site_a FROM cf),'asset_id',(SELECT aed1 FROM cf),'observation_kind','aed_operation_check','observed_at',(SELECT recent FROM cf),'basis','staff_observed','outcome','pass'))$q$);
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.facility_service_records) AND (SELECT count(*)=0 FROM public.dietary_records) AND (SELECT count(*)=0 FROM public.operation_source_record_requests),'the other site reads site A records');
INSERT INTO cf_results SELECT 'obs_aed_b',public.record_asset_observation_review(pg_temp.k('b-obs-000002'),jsonb_build_object('facility_id',site_b,'asset_id',aed_b,'observation_kind','aed_operation_check','observed_at',recent,'basis','staff_observed','outcome','pass')) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='unmatched' AND result->'delivery'->'event'->>'reason'='subject_not_enrolled' AND (result->>'linked')::boolean=false FROM cf_results WHERE label='obs_aed_b'),'site B record did not land as unmatched');
INSERT INTO cf_results SELECT 'svc_b',public.record_facility_service_review(pg_temp.k('b-svc-000002'),jsonb_build_object('facility_id',site_b,'service_kind','fire_inspection','performed_at',recent,'outcome','pass')) FROM cf;
SELECT pg_temp.c_assert((SELECT result->'delivery'->'event'->>'state'='unmatched' AND (result->>'linked')::boolean=false FROM cf_results WHERE label='svc_b'),'site B service did not land as unmatched');
RESET ROLE;
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.facility_service_records WHERE facility_id=(SELECT site_b FROM cf)) AND (SELECT count(*)>=6 FROM public.facility_service_records) AND (SELECT count(*)>=4 FROM public.dietary_records),'site A cannot read its own records or reads site B');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.audit_log WHERE table_name='operation_source_record_requests'),'generic audit payloads of the request ledger leaked');
RESET ROLE;

-- 6. Guards: no direct DML on service or dietary records for session or service, with and without the forged setting; the owner-run definer with the real token cannot rewrite identity, kind, a voided row, delete or silently restate; adapters register by migration only.
SELECT pg_temp.c_login('admin_a');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_denied($q$INSERT INTO public.facility_service_records(organization_id,facility_id,service_kind,performed_at,performer_kind,performed_by,outcome,finalized_at,finalized_by,version_recorded_at,version_recorded_by) SELECT org,site_a,'fire_inspection',now(),'staff',admin_a,'pass',now(),admin_a,now(),admin_a FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.facility_service_records SET outcome='pass' WHERE id=pg_temp.rid('s_fire')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.facility_service_records WHERE id=pg_temp.rid('s_fire')$q$);
SELECT pg_temp.c_denied($q$TRUNCATE public.facility_service_records$q$);
SELECT pg_temp.c_denied($q$INSERT INTO public.dietary_records(organization_id,facility_id,record_kind,performed_at,performed_by,outcome,finalized_at,finalized_by,version_recorded_at,version_recorded_by) SELECT org,site_a,'emergency_food_supply_check',now(),admin_a,'performed',now(),admin_a,now(),admin_a FROM cf$q$);
SELECT pg_temp.c_denied($q$UPDATE public.dietary_records SET note='x' WHERE id=pg_temp.rid('d_menu')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.dietary_records WHERE id=pg_temp.rid('d_menu')$q$);
SELECT pg_temp.c_denied($q$TRUNCATE public.dietary_records$q$);
SELECT pg_temp.c_denied($q$SELECT haven.operation_source_read_facility_service('x')$q$);
SELECT pg_temp.c_denied($q$SELECT haven.operation_source_read_dietary_record('x')$q$);
SELECT set_config('haven.operation_source_record_command','approved',true);
SELECT pg_temp.c_denied($q$UPDATE public.facility_service_records SET outcome='pass' WHERE id=pg_temp.rid('s_fire')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.dietary_records SET note='x' WHERE id=pg_temp.rid('d_menu')$q$);
SELECT set_config('haven.operation_source_record_command','',true);
RESET ROLE;
SELECT pg_temp.c_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.c_denied($q$UPDATE public.facility_service_records SET outcome='pass' WHERE id=pg_temp.rid('s_fire')$q$);
SELECT pg_temp.c_denied($q$UPDATE public.dietary_records SET note='x' WHERE id=pg_temp.rid('d_menu')$q$);
SELECT pg_temp.c_denied($q$DELETE FROM public.facility_service_records$q$);
RESET ROLE;
SELECT pg_temp.c_clear();
DO $$ BEGIN PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true); END $$;
SELECT pg_temp.c_expect($q$UPDATE public.facility_service_records SET note='after void' WHERE id=pg_temp.rid('s_ac')$q$,'Voided service records are immutable');
SELECT pg_temp.c_expect($q$UPDATE public.facility_service_records SET facility_id=(SELECT site_b FROM cf) WHERE id=pg_temp.rid('s_fire')$q$,'identity is immutable');
SELECT pg_temp.c_expect($q$UPDATE public.facility_service_records SET service_kind='sprinkler_inspection' WHERE id=pg_temp.rid('s_fire')$q$,'identity is immutable');
SELECT pg_temp.c_expect($q$UPDATE public.facility_service_records SET deleted_at=now() WHERE id=pg_temp.rid('s_fire')$q$,'voided, not deleted');
SELECT pg_temp.c_expect($q$UPDATE public.facility_service_records SET note='silent restatement' WHERE id=pg_temp.rid('s_fire')$q$,'records who restated');
SELECT pg_temp.c_expect($q$DELETE FROM public.facility_service_records WHERE id=pg_temp.rid('s_fire')$q$,'retained history');
SELECT pg_temp.c_expect($q$UPDATE public.facility_service_records SET asset_id=(SELECT aed_b FROM cf),version_recorded_at=now() WHERE id=pg_temp.rid('s_ext1')$q$,'asset is not at this site');
SELECT pg_temp.c_expect($q$UPDATE public.dietary_records SET note='after void' WHERE id=pg_temp.rid('d_food')$q$,'Voided dietary records are immutable');
SELECT pg_temp.c_expect($q$UPDATE public.dietary_records SET record_kind='meal_substitution' WHERE id=pg_temp.rid('d_menu')$q$,'identity is immutable');
SELECT pg_temp.c_expect($q$UPDATE public.dietary_records SET deleted_at=now() WHERE id=pg_temp.rid('d_menu')$q$,'voided, not deleted');
SELECT pg_temp.c_expect($q$UPDATE public.dietary_records SET note='silent restatement' WHERE id=pg_temp.rid('d_menu')$q$,'records who restated');
SELECT pg_temp.c_expect($q$DELETE FROM public.dietary_records WHERE id=pg_temp.rid('d_menu')$q$,'retained history');
SELECT pg_temp.c_expect($q$INSERT INTO public.facility_service_records(organization_id,facility_id,service_kind,asset_id,performed_at,performer_kind,performed_by,outcome,finalized_at,finalized_by,version_recorded_at,version_recorded_by) SELECT org,site_a,'ac_filter_change',aed_b,now(),'staff',admin_a,'pass',now(),admin_a,now(),admin_a FROM cf$q$,'asset is not at this site');
SELECT pg_temp.c_expect($q$INSERT INTO public.facility_service_records(organization_id,facility_id,service_kind,performed_at,performer_kind,performed_by,outcome,finalized_at,finalized_by,version_recorded_at,version_recorded_by,voided_at,voided_by,void_reason) SELECT org,site_a,'fire_inspection',now(),'staff',admin_a,'pass',now(),admin_a,now(),admin_a,now(),admin_a,'x' FROM cf$q$,'final and not voided');
SELECT set_config('haven.operation_source_record_command','',true);
SELECT pg_temp.c_service();
SELECT pg_temp.c_expect($q$INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function) SELECT org,'dietary-record-2','facility','operation_source_read_dietary_record' FROM cf$q$,'registered by migration only');
SELECT pg_temp.c_clear();

-- 7. A forced audit failure inside a command leaves no record, request, delivery or receipt behind.
CREATE FUNCTION haven.col159_probe_audit_bomb() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name IN('facility_service_records','dietary_records') THEN RAISE EXCEPTION 'COL-159 forced audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER col159_probe_audit_bomb BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION haven.col159_probe_audit_bomb();
CREATE TEMP TABLE cf_bomb AS SELECT (SELECT count(*) FROM public.facility_service_records) svc,(SELECT count(*) FROM public.dietary_records) diet,(SELECT count(*) FROM public.operation_source_record_requests) req,(SELECT count(*) FROM public.operation_source_events) ev,(SELECT count(*) FROM public.operation_execution_receipts) rec;
SELECT pg_temp.c_login('maint');
SET LOCAL ROLE authenticated;
SELECT pg_temp.c_expect($q$SELECT pg_temp.svc('bomb-000001','hood_cleaning',(SELECT hood1 FROM cf),(SELECT recent FROM cf),'pass')$q$,'forced audit failure');
SELECT pg_temp.c_expect($q$SELECT pg_temp.diet('bomb-000002','emergency_food_supply_check',(SELECT recent FROM cf))$q$,'forced audit failure');
RESET ROLE;
SELECT pg_temp.c_assert((SELECT svc=(SELECT count(*) FROM public.facility_service_records) AND diet=(SELECT count(*) FROM public.dietary_records) AND req=(SELECT count(*) FROM public.operation_source_record_requests) AND ev=(SELECT count(*) FROM public.operation_source_events) AND rec=(SELECT count(*) FROM public.operation_execution_receipts) FROM cf_bomb),'a failed audit insert left a row behind');
DROP TRIGGER col159_probe_audit_bomb ON public.audit_log;
DROP FUNCTION haven.col159_probe_audit_bomb();

-- 8. Invariants: every record is final; request rows keep their delivery; source receipts keep the four columns together; one effective receipt per record; public RPCs are invokers; no record review activity allowlisted; no resident anywhere on the dietary table.
SELECT pg_temp.c_assert((SELECT bool_and(finalized_at IS NOT NULL AND record_version>=1) FROM public.facility_service_records) AND (SELECT bool_and(finalized_at IS NOT NULL AND record_version>=1) FROM public.dietary_records),'a record is not final');
SELECT pg_temp.c_assert((SELECT bool_and((reply->'delivery' IS NULL OR jsonb_typeof(reply->'delivery')='null')=(source_event_id IS NULL)) FROM public.operation_source_record_requests),'request rows lost their delivery');
SELECT pg_temp.c_assert((SELECT bool_and(num_nonnulls(source_event_id,source_key,source_record_id,source_record_version) IN(0,4)) FROM public.operation_execution_receipts),'receipt source columns not set together');
SELECT pg_temp.c_assert((SELECT count(*)=count(DISTINCT (organization_id,source_key,source_record_id)) FROM public.operation_execution_receipts WHERE source_event_id IS NOT NULL AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL),'a record has more than one effective receipt');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('record_facility_service_review','correct_facility_service_review','void_facility_service_review','record_dietary_record_review','correct_dietary_record_review','void_dietary_record_review') AND p.prosecdef),'public source record RPC is definer');
SELECT pg_temp.c_assert((SELECT count(*)=0 FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE a.activity_kind='record_review'),'a record review activity became allowlisted');
SELECT pg_temp.c_assert(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name IN('dietary_records','facility_service_records') AND column_name LIKE '%resident%'),'a resident column exists on a COL-159 table');
SELECT 'COL-159 dietary and facility services source behavior PASS' result;
ROLLBACK;
