-- Rollback-only behavior probes. No real resident values are copied into artifacts.
BEGIN;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE FUNCTION pg_temp.closeout_assert(ok boolean,msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '25A closeout: %',msg; END IF; END $$;
CREATE TEMP TABLE closeout_fixture AS SELECT f.organization_id org,f.id fac,r.id resident,
 gen_random_uuid() owner,gen_random_uuid() owner_session,gen_random_uuid() proposer,gen_random_uuid() proposer_session,
 gen_random_uuid() aide,gen_random_uuid() aide_session,gen_random_uuid() aide_staff,gen_random_uuid() task
 FROM public.facilities f JOIN public.residents r ON r.facility_id=f.id AND r.deleted_at IS NULL
 WHERE f.deleted_at IS NULL AND r.status='active' AND NOT EXISTS(SELECT 1 FROM public.resident_monitoring_orders mo WHERE mo.resident_id=r.id AND mo.status='active' AND mo.deleted_at IS NULL) AND EXISTS(SELECT 1 FROM public.facility_cadence_versions v WHERE v.facility_id=f.id AND v.status='active') LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT owner,owner||'@closeout.invalid','{}'::jsonb,'{}'::jsonb FROM closeout_fixture UNION ALL SELECT proposer,proposer||'@closeout.invalid','{}'::jsonb,'{}'::jsonb FROM closeout_fixture UNION ALL SELECT aide,aide||'@closeout.invalid','{}'::jsonb,'{}'::jsonb FROM closeout_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT owner,org,owner||'@closeout.invalid','Synthetic owner','owner'::public.app_role,true FROM closeout_fixture
 UNION ALL SELECT proposer,org,proposer||'@closeout.invalid','Synthetic proposer','facility_admin'::public.app_role,true FROM closeout_fixture
 UNION ALL SELECT aide,org,aide||'@closeout.invalid','Synthetic observer','med_tech'::public.app_role,true FROM closeout_fixture;
INSERT INTO auth.sessions(id,user_id) SELECT owner_session,owner FROM closeout_fixture UNION ALL SELECT proposer_session,proposer FROM closeout_fixture UNION ALL SELECT aide_session,aide FROM closeout_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT owner,fac,org FROM closeout_fixture UNION ALL SELECT proposer,fac,org FROM closeout_fixture UNION ALL SELECT aide,fac,org FROM closeout_fixture;
INSERT INTO public.staff(id,user_id,facility_id,organization_id,first_name,last_name,staff_role,employment_status,hire_date)
 SELECT aide_staff,aide,fac,org,'Synthetic','Observer','resident_aide'::public.staff_role,'active'::public.employment_status,current_date FROM closeout_fixture;
CREATE FUNCTION pg_temp.closeout_signin(which_actor text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp,pg_catalog AS $$
DECLARE f record; actor uuid; session uuid;
BEGIN SELECT * INTO f FROM closeout_fixture; actor:=CASE which_actor WHEN 'owner' THEN f.owner WHEN 'proposer' THEN f.proposer ELSE f.aide END;
 session:=CASE which_actor WHEN 'owner' THEN f.owner_session WHEN 'proposer' THEN f.proposer_session ELSE f.aide_session END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',session,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=actor))::text,true);
END $$;
GRANT SELECT ON closeout_fixture TO authenticated;
SELECT pg_temp.closeout_signin('owner');
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; c uuid; e uuid; w jsonb; r jsonb; bad jsonb; made jsonb; ov jsonb; cfg jsonb; orig jsonb; applied jsonb; t jsonb; t2 jsonb; saved_rule uuid; rule_key text; signal uuid:=gen_random_uuid(); n integer;
BEGIN
 SELECT * INTO f FROM closeout_fixture;
 c:=public.facility_cadence_in_force(f.fac,now()); e:=public.facility_escalation_in_force(f.fac,now());
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order) INTO w FROM public.facility_cadence_windows x WHERE x.cadence_version_id=c AND x.deleted_at IS NULL;
 r:=public.observation_escalation_role_holders(f.fac,e);
 BEGIN
 INSERT INTO public.facility_escalation_rung_shift_overrides(organization_id,facility_id,escalation_version_id,escalation_rung_id,shift_key,offset_minutes)
 SELECT f.org,f.fac,e,id,'synthetic_bypass',0 FROM public.facility_escalation_rungs WHERE escalation_version_id=e LIMIT 1;
 RAISE EXCEPTION 'Direct INSERT override bypassed immutable policy'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 INSERT INTO public.facility_escalation_rungs(organization_id,facility_id,escalation_version_id,rung_key,label,offset_minutes,channels,include_assigned_staff,sort_order)
 VALUES(f.org,f.fac,e,'synthetic_bypass','Synthetic bypass',0,ARRAY['in_app'],true,1);
 RAISE EXCEPTION 'Direct INSERT rung bypassed immutable policy'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.closeout_assert(r->0 ? 'shift_overrides','Overview drops shift overrides');
 cfg:=haven.observation_configuration(f.fac); orig:=cfg;
 BEGIN PERFORM public.activate_cadence_version('Attempt historical reschedule',c,NULL,'scheduled',now()+interval '1 day',(SELECT name FROM facilities WHERE id=f.fac)); RAISE EXCEPTION 'Historical cadence rescheduled'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- A cadence-only rename must validate the effective escalation's overrides.
 IF EXISTS(SELECT 1 FROM public.facility_escalation_rung_shift_overrides WHERE escalation_version_id=e AND deleted_at IS NULL) THEN
  SELECT shift_key INTO rule_key FROM public.facility_escalation_rung_shift_overrides WHERE escalation_version_id=e AND deleted_at IS NULL LIMIT 1;
  SELECT jsonb_agg(CASE WHEN value->>'shift_key'=rule_key THEN jsonb_set(value,'{shift_key}',to_jsonb(rule_key||'_new')) ELSE value END) INTO bad FROM jsonb_array_elements(cfg->'shifts');
  bad:=jsonb_set(cfg,'{shifts}',bad);
  made:=public.create_cadence_version(f.fac,'Synthetic orphan override',w,NULL,NULL,NULL,NULL,bad);
  PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(made->'validation'->'blocks') x WHERE x->>'code'='unknown_shift_override'),'Cadence-only rename orphaned effective escalation override');
 END IF;
 SELECT jsonb_agg(CASE WHEN value->>'due_at_local'='22:00:00' THEN jsonb_set(value,'{shift_key}',to_jsonb((cfg->'shifts'->0->>'shift_key'))) ELSE value END) INTO bad FROM jsonb_array_elements(w);
 made:=public.create_cadence_version(f.fac,'Synthetic wrong-shift counterexample',bad,NULL,NULL,NULL,NULL);
 PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(made->'validation'->'blocks') x WHERE x->>'code'='window_outside_shift'),'Wrong-shift window was accepted');
 SELECT jsonb_agg(CASE WHEN (value->>'is_terminal')::boolean THEN jsonb_set(value,'{shift_overrides}',jsonb_build_array(jsonb_build_object('shift_key',cfg->'shifts'->0->>'shift_key','offset_minutes',0,'channels',value->'channels'))) ELSE value END) INTO bad FROM jsonb_array_elements(r);
 made:=public.create_cadence_version(f.fac,'Synthetic early-terminal counterexample',NULL,bad,NULL,NULL,NULL);
 PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(made->'validation'->'blocks') x WHERE x->>'code'='rung_offsets_not_increasing'),'Shift override reordered ladder without refusal');
 SELECT jsonb_agg(CASE WHEN (value->>'is_terminal')::boolean THEN jsonb_set(value,'{protocol_text}','null') ELSE value END) INTO bad FROM jsonb_array_elements(r);
 made:=public.create_cadence_version(f.fac,'Synthetic missing protocol',NULL,bad,NULL,NULL,NULL);
 PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(made->'validation'->'blocks') x WHERE x->>'code'='terminal_protocol_required'),'Terminal instructions may disappear');
 -- Distinct sessions prove proposals are read from durable data, not browser state.
 PERFORM pg_temp.closeout_signin('proposer');
 cfg:=jsonb_set(cfg,'{monitoring_grace_divisor}',to_jsonb((cfg->>'monitoring_grace_divisor')::numeric+1));
 made:=public.create_cadence_version(f.fac,'Synthetic reviewed settings',w,r,NULL,NULL,NULL,cfg);
 PERFORM pg_temp.closeout_assert(made->>'status'='pending_approval','Proposer activated policy');
 BEGIN PERFORM public.activate_cadence_version('Unauthorized activation',(made->>'cadence_version_id')::uuid,(made->>'escalation_version_id')::uuid,'immediate',NULL,(SELECT name FROM facilities WHERE id=f.fac)); RAISE EXCEPTION 'Proposer activated'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.closeout_signin('owner');
 ov:=public.observation_config_overview(f.fac,(made->>'cadence_version_id')::uuid,(made->>'escalation_version_id')::uuid);
 PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(ov->'pending_proposals') x WHERE x->>'cadence_version_id'=made->>'cadence_version_id' AND x->>'escalation_version_id'=made->>'escalation_version_id'),'Owner cannot reopen paired proposal');
 PERFORM pg_temp.closeout_assert(ov->'proposed'->'configuration'->>'monitoring_grace_divisor'=cfg->>'monitoring_grace_divisor','Proposal snapshot lost divisor');
 applied:=public.activate_cadence_version('Synthetic owner approval',(made->>'cadence_version_id')::uuid,(made->>'escalation_version_id')::uuid,'immediate',NULL,(SELECT name FROM facilities WHERE id=f.fac));
 PERFORM pg_temp.closeout_assert((SELECT observation_grace_divisor FROM facility_observation_thresholds WHERE facility_id=f.fac)=(cfg->>'monitoring_grace_divisor')::numeric,'Activation did not apply divisor');
 PERFORM pg_temp.closeout_assert(haven.observation_configuration_for_version(f.fac,c)=orig,'Current configuration rewrote historical snapshot');
 -- Create a signal on the current facility rule, then replace configuration.
 SELECT id,signal_key INTO saved_rule,rule_key FROM public.watchlist_signal_rules WHERE facility_id=f.fac AND deleted_at IS NULL LIMIT 1;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 INSERT INTO public.watchlist_signal_instances(id,organization_id,facility_id,resident_id,signal_rule_id,signal_key,severity_class,severity_weight,source_kind)
 VALUES(signal,f.org,f.fac,f.resident,saved_rule,rule_key,'elevated',1,'clinical');
 PERFORM pg_temp.closeout_signin('owner');
 SET LOCAL ROLE authenticated;
 made:=public.create_cadence_version(f.fac,'Synthetic second version',w,NULL,NULL,NULL,NULL,cfg);
 PERFORM public.activate_cadence_version('Synthetic second approval',(made->>'cadence_version_id')::uuid,NULL,'immediate',NULL,(SELECT name FROM facilities WHERE id=f.fac));
 PERFORM set_config('closeout.retired_rule',saved_rule::text,true);
 -- Immutable template revisions and exact revision acknowledgement.
 t:=public.save_observation_template(f.fac,'escalation','Synthetic complete policy','Synthetic template',r,NULL);
 t2:=public.save_observation_template(f.fac,'escalation','Synthetic complete policy','Synthetic revision',r,(t->>'template_id')::uuid);
 PERFORM pg_temp.closeout_assert((t2->>'version_number')::integer=(t->>'version_number')::integer+1,'Template revision overwritten');
 PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM public.escalation_template_versions WHERE id=(t->>'version_id')::uuid AND status='superseded'),'Old template revision missing');
 BEGIN PERFORM public.apply_template_to_facilities(ARRAY[f.fac],'Stale template apply',NULL,(t->>'template_id')::uuid,'next_shift_boundary',NULL,NULL,NULL,(t->>'version_id')::uuid); RAISE EXCEPTION 'Stale preview applied'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 applied:=public.apply_template_to_facilities(ARRAY[f.fac],'Synthetic template apply',NULL,(t2->>'template_id')::uuid,'immediate',NULL,'Synthetic complete policy',NULL,(t2->>'version_id')::uuid);
 PERFORM pg_temp.closeout_assert((applied->>'ok')::boolean,format('Template apply failed: %s',applied));
 PERFORM pg_temp.closeout_assert((SELECT escalation_drift_count=0 FROM public.facility_config_template_drift(now(),f.fac)),'Applied full rung policy has nonzero drift');
 RESET ROLE;
 -- A real boundary edit preserves the historical shift resolver and stores
 -- the new bounds on the activated version, rather than rewriting old rows.
 cfg:=jsonb_set(cfg,'{shifts}',(SELECT jsonb_agg(value||jsonb_build_object('starts_at_local',(((value->>'starts_at_local')::time+interval '1 hour')::time)::text,'ends_at_local',(((value->>'ends_at_local')::time+interval '1 hour')::time)::text)) FROM jsonb_array_elements(cfg->'shifts')));
 SELECT jsonb_agg(CASE WHEN (value->>'grace_before_minutes')::integer=0 THEN jsonb_set(value,'{due_at_local}',to_jsonb((((value->>'due_at_local')::time+interval '1 hour')::time)::text)) ELSE value END) INTO bad FROM jsonb_array_elements(w);
 made:=public.create_cadence_version(f.fac,'Synthetic shift boundary move',bad,NULL,NULL,NULL,NULL,cfg);
 PERFORM pg_temp.closeout_assert((made->'validation'->>'ok')::boolean,format('Valid shifted boundaries rejected: %s',made->'validation'));
 PERFORM public.activate_cadence_version('Synthetic boundary approval',(made->>'cadence_version_id')::uuid,NULL,'immediate',NULL,(SELECT name FROM facilities WHERE id=f.fac));
 PERFORM pg_temp.closeout_assert(haven.observation_configuration_for_version(f.fac,c)=orig,'Shift boundary edit rewrote historical snapshot');
 PERFORM pg_temp.closeout_assert((SELECT starts_at_local::text FROM haven.observation_shifts_for_version(f.fac,(made->>'cadence_version_id')::uuid) ORDER BY sort_order LIMIT 1)=cfg->'shifts'->0->>'starts_at_local','Activated shift bounds differ from proposal');
 RAISE NOTICE 'PASS: shift and terminal counterexamples blocked; owner reopens paired proposal; immutable config and template revisions';
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.closeout_assert(EXISTS(SELECT 1 FROM public.watchlist_signal_rules WHERE id=current_setting('closeout.retired_rule')::uuid),'RLS hides historical Watchlist policy after activation');
END $$;
RESET ROLE;
SELECT pg_temp.closeout_signin('aide');
INSERT INTO public.resident_observation_tasks(id,organization_id,facility_id,resident_id,cadence_version_id,scheduled_for,due_at,grace_ends_at,status)
 SELECT task,org,fac,resident,public.facility_cadence_in_force(fac,now()),now()-interval '1 minute',now(),now()+interval '1 hour','upcoming'::public.resident_observation_task_status FROM closeout_fixture;
DO $$ DECLARE f record; a jsonb; b jsonb; chip jsonb; payload jsonb; first_result jsonb; again jsonb; version integer;
BEGIN
 SELECT * INTO f FROM closeout_fixture;
 SELECT auth_claim_version INTO version FROM public.user_profiles WHERE id=f.aide;
 SELECT jsonb_build_object(field_name,jsonb_build_array(value_code)) INTO chip FROM public.observation_vocab
 WHERE organization_id=f.org AND (facility_id IS NULL OR facility_id=f.fac) AND field_name IN('meal_intake','mood_state','med_response') AND active AND deleted_at IS NULL LIMIT 1;
 payload:=jsonb_build_object('request_id',gen_random_uuid(),'observed_at',now(),'quick_status','calm','resident_location','bedroom','resident_state','resting_in_bed','chip_selections',chip);
 -- 2026-09-22: the aide is a med-tech now and holds the nurse's supervisor authority, which
 -- may complete an unclaimed task; the unclaimed-refusal case no longer has a floor role to test.
 a:=public.claim_observation_task(f.task); b:=public.claim_observation_task(f.task);
 PERFORM pg_temp.closeout_assert(a=b,'Repeated rescue claim duplicates assignment');
 BEGIN PERFORM public.complete_rounding_task_review(f.task,f.aide,'med_tech',f.aide_session,version,f.org,f.fac,f.aide_staff,payload-'chip_selections'); RAISE EXCEPTION 'Legacy command bypassed capture'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 first_result:=public.complete_rounding_task_review(f.task,f.aide,'med_tech',f.aide_session,version,f.org,f.fac,f.aide_staff,payload);
 again:=public.complete_rounding_task_review(f.task,f.aide,'med_tech',f.aide_session,version,f.org,f.fac,f.aide_staff,payload);
 PERFORM pg_temp.closeout_assert(first_result->>'log_id'=again->>'log_id','Immutable receipt replay duplicated log');
 BEGIN PERFORM public.claim_observation_task(f.task); RAISE EXCEPTION 'Completed task claimed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 RAISE NOTICE 'PASS: explicit idempotent rescue, legacy chip bypass refusal, immutable completion replay';
END $$;

-- Isolate this rollback-only roster fixture from the published demo week.
-- Only fixture retirement bypasses the publication guard; every tested write below uses it.
ALTER TABLE public.schedules DISABLE TRIGGER workforce_guard_schedule_row;
UPDATE public.schedules SET deleted_at=now(),status='archived'
 WHERE facility_id=(SELECT fac FROM closeout_fixture) AND deleted_at IS NULL
 AND week_start_date BETWEEN date_trunc('week',now())::date-7 AND date_trunc('week',now())::date;
ALTER TABLE public.schedules ENABLE TRIGGER workforce_guard_schedule_row;
DO $$ DECLARE f record; sw record; sw_next record; planned_week record; facility_tz text; sch uuid; ord uuid:=gen_random_uuid(); assignment uuid:=gen_random_uuid(); n integer; first_count integer; interval_minutes integer;
BEGIN
 SELECT * INTO f FROM closeout_fixture;
 SELECT timezone INTO facility_tz FROM public.facilities WHERE id=f.fac;
 SELECT * INTO sw FROM public.facility_shift_window_at(f.fac,now());
 INSERT INTO public.schedules(organization_id,facility_id,week_start_date)
 VALUES(f.org,f.fac,date_trunc('week',sw.shift_service_date)::date) ON CONFLICT DO NOTHING;
 SELECT id INTO sch FROM public.schedules WHERE facility_id=f.fac AND week_start_date=date_trunc('week',sw.shift_service_date)::date AND deleted_at IS NULL;
 INSERT INTO public.shift_assignments(id,schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,assigned_resident_ids,custom_start_time,custom_end_time,schedule_rounding_coverage)
 VALUES(assignment,sch,f.aide_staff,f.fac,f.org,sw.shift_service_date,sw.roster_shift_type,ARRAY[f.resident],(sw.starts_at_utc AT TIME ZONE facility_tz)::time,(sw.ends_at_utc AT TIME ZONE facility_tz)::time,true);
 -- The generation horizon below is an hour wide, so for the hour before every
 -- shift change it lands in the next shift. Staffing only the current shift
 -- made this assertion pass by clock luck and fail twice a day; roster the
 -- shift the horizon actually reaches as well.
 SELECT * INTO sw_next FROM public.facility_shift_window_at(f.fac,now()+interval '1 hour');
 IF (sw_next.shift_service_date,sw_next.roster_shift_type) IS DISTINCT FROM (sw.shift_service_date,sw.roster_shift_type) THEN
  INSERT INTO public.schedules(organization_id,facility_id,week_start_date) VALUES(f.org,f.fac,date_trunc('week',sw_next.shift_service_date)::date) ON CONFLICT DO NOTHING;
  SELECT id INTO sch FROM public.schedules WHERE facility_id=f.fac AND week_start_date=date_trunc('week',sw_next.shift_service_date)::date AND deleted_at IS NULL;
  INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,assigned_resident_ids,custom_start_time,custom_end_time,schedule_rounding_coverage)
  VALUES(sch,f.aide_staff,f.fac,f.org,sw_next.shift_service_date,sw_next.roster_shift_type,ARRAY[f.resident],(sw_next.starts_at_utc AT TIME ZONE facility_tz)::time,(sw_next.ends_at_utc AT TIME ZONE facility_tz)::time,true);
 END IF;
 -- Draft plans are not clinical ownership. Publish recorded work through the
 -- actual owner command, rather than relying on the retired enum-only lookup.
 PERFORM pg_temp.closeout_assert(NOT EXISTS(SELECT 1 FROM public.resolve_observation_task_assignees_for_instant(f.fac,now(),ARRAY[f.resident]) a WHERE a.shift_assignment_id=assignment),'Draft roster must not own clinical checks');
 PERFORM pg_temp.closeout_signin('owner');
 FOR planned_week IN SELECT id,updated_at FROM public.schedules WHERE facility_id=f.fac AND deleted_at IS NULL AND status='draft' AND week_start_date IN(date_trunc('week',sw.shift_service_date)::date,date_trunc('week',sw_next.shift_service_date)::date) LOOP
  PERFORM public.schedule_publish(planned_week.id,planned_week.updated_at);
 END LOOP;
 PERFORM pg_temp.closeout_signin('aide');
 SELECT monitoring_order_interval_presets[1] INTO interval_minutes FROM public.facility_observation_thresholds WHERE facility_id=f.fac;
 INSERT INTO public.resident_monitoring_orders(id,organization_id,facility_id,resident_id,interval_minutes,starts_at,ends_at,review_due_at,ordered_by_type,ordered_by_name,order_received_as,reason_category,reason_note,entered_by,status)
 VALUES(ord,f.org,f.fac,f.resident,interval_minutes,now(),now()+interval '1 hour',now()+interval '1 day','facility_admin','Synthetic order authority','verbal','other','Synthetic ownership probe',f.aide,'active');
 PERFORM public.generate_monitoring_order_tasks(f.fac,now()+interval '1 hour');
 SELECT count(*) INTO first_count FROM public.resident_observation_tasks WHERE monitoring_order_id=ord;
 PERFORM pg_temp.closeout_assert(first_count>0,'Monitoring Order produced no tasks');
 PERFORM pg_temp.closeout_assert(NOT EXISTS(SELECT 1 FROM public.resident_observation_tasks t WHERE t.monitoring_order_id=ord AND (t.assigned_staff_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=t.id AND a.staff_id=t.assigned_staff_id AND a.released_at IS NULL))),'Order task has no usable roster assignment');
 n:=public.generate_monitoring_order_tasks(f.fac,now()+interval '1 hour');
 PERFORM pg_temp.closeout_assert(n=0 AND (SELECT count(*) FROM public.resident_observation_tasks WHERE monitoring_order_id=ord)=first_count,'Order generation is not idempotent');
 -- Revoking a grant between reading the queue and the explicit claim refuses.
 UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=f.aide AND facility_id=f.fac;
 BEGIN PERFORM public.claim_observation_task((SELECT id FROM public.resident_observation_tasks WHERE monitoring_order_id=ord LIMIT 1)); RAISE EXCEPTION 'Revoked observer claimed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS: order roster assignment and retry idempotency, revoked claim refusal';
END $$;
ROLLBACK;
