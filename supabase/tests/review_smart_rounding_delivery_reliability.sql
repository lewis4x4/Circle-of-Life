-- Synthetic rollback-only probes against the fully replayed database.
BEGIN;
DO $test$
DECLARE
 v_org uuid; v_fac uuid; v_res uuid; v_user uuid; v_rule uuid;
 v_delivery uuid := gen_random_uuid(); v_order uuid := gen_random_uuid(); v_signal uuid := gen_random_uuid();
 v_notification uuid := gen_random_uuid(); v_push uuid := gen_random_uuid();
 v_unavailable uuid := gen_random_uuid();
 v_owner_session uuid := gen_random_uuid();
 v_actor uuid := gen_random_uuid(); v_session uuid := gen_random_uuid(); v_version integer;
 v_token uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_claim record; v_status text; v_n integer;
BEGIN
 SELECT r.organization_id,r.facility_id,r.id INTO v_org,v_fac,v_res FROM residents r WHERE r.deleted_at IS NULL LIMIT 1;
 SELECT id INTO v_user FROM user_profiles WHERE organization_id=v_org AND app_role IN ('owner','org_admin') LIMIT 1;
 SELECT id INTO v_rule FROM watchlist_signal_rules WHERE organization_id=v_org LIMIT 1;
 IF v_user IS NULL OR v_rule IS NULL THEN RAISE EXCEPTION 'Replay seed required'; END IF;
 INSERT INTO auth.sessions(id,user_id) VALUES(v_owner_session,v_user);
 SELECT auth_claim_version INTO v_version FROM user_profiles WHERE id=v_user;
 PERFORM set_config('delivery_test.owner_claims',jsonb_build_object('role','authenticated','sub',v_user,'session_id',v_owner_session,'auth_claim_version',v_version::text)::text,true);
 INSERT INTO observation_escalation_deliveries(id,organization_id,facility_id,rung_key,target_role,channel,status,is_test,message_body,send_after)
 VALUES(v_delivery,v_org,v_fac,'test','synthetic','sms','queued',true,'TEST retry',now()-interval '1 minute');
 SELECT * INTO v_claim FROM claim_observation_escalation_deliveries(v_org,v_fac,v_token,now(),500) WHERE id=v_delivery;
 IF v_claim.id IS NULL THEN RAISE EXCEPTION 'SMS not claimed'; END IF;
 PERFORM record_observation_escalation_delivery_outcome(v_delivery,v_token,'failed',NULL,NULL,'twilio sms 429',NULL,true,90);
 SELECT status INTO v_status FROM observation_escalation_deliveries WHERE id=v_delivery AND send_after >= now()+interval '89 seconds' AND send_attempts=1;
 IF v_status IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION '429 did not requeue with backoff'; END IF;
 IF EXISTS(SELECT 1 FROM claim_observation_escalation_deliveries(v_org,v_fac,v_other,now(),500) WHERE id=v_delivery) THEN RAISE EXCEPTION 'Retry ignored backoff'; END IF;
 PERFORM 1 FROM claim_observation_escalation_deliveries(v_org,v_fac,v_token,now()+interval '2 minutes',500);
 PERFORM record_observation_escalation_delivery_outcome(v_delivery,v_token,'failed',NULL,NULL,'network',NULL,true,1);
 PERFORM 1 FROM claim_observation_escalation_deliveries(v_org,v_fac,v_token,now()+interval '3 minutes',500);
 PERFORM record_observation_escalation_delivery_outcome(v_delivery,v_token,'failed',NULL,NULL,'network',NULL,true,1);
 IF (SELECT status FROM observation_escalation_deliveries WHERE id=v_delivery) <> 'failed' THEN RAISE EXCEPTION 'Attempts unbounded'; END IF;

 INSERT INTO observation_escalation_deliveries(id,organization_id,facility_id,rung_key,target_role,target_user_id,channel,status,is_test,message_body)
 VALUES(v_unavailable,v_org,v_fac,'test','synthetic',v_user,'in_app','queued',true,'TEST inbox availability');
 PERFORM 1 FROM claim_observation_escalation_deliveries(v_org,v_fac,v_token,now(),500);
 IF (SELECT status FROM observation_escalation_deliveries WHERE id=v_unavailable) <> 'skipped'
 THEN RAISE EXCEPTION 'No escalation artifact but in-app receipt claimable'; END IF;
 UPDATE observation_escalation_deliveries SET status='sending',claimed_at=now()-interval '1 hour',claim_token=v_other,send_attempts=1 WHERE id=v_unavailable;
 PERFORM 1 FROM claim_observation_escalation_deliveries(v_org,v_fac,v_token,now(),500);
 IF NOT EXISTS(SELECT 1 FROM observation_escalation_deliveries WHERE id=v_unavailable AND status='skipped' AND claim_token IS NULL)
 THEN RAISE EXCEPTION 'Revoked stale in-app claim stranded'; END IF;
 INSERT INTO resident_monitoring_orders(id,organization_id,facility_id,resident_id,interval_minutes,starts_at,ends_at,ordered_by_type,ordered_by_name,order_received_as,reason_category,reason_note,entered_by,status)
 VALUES(v_order,v_org,v_fac,v_res,60,now()-interval '1 hour',now()+interval '1 hour','facility_admin','Synthetic','verbal','other','Synthetic delivery probe',v_user,'completed');
 INSERT INTO resident_monitoring_order_notifications(id,organization_id,facility_id,monitoring_order_id,target_role,channel,status)
 VALUES(v_notification,v_org,v_fac,v_order,'synthetic','in_app','queued');
 UPDATE resident_monitoring_order_notifications SET target_user_id=v_user WHERE id=v_notification;
 INSERT INTO watchlist_signal_instances(id,organization_id,facility_id,resident_id,signal_rule_id,signal_key,severity_class,severity_weight,source_kind)
 VALUES(v_signal,v_org,v_fac,v_res,v_rule,'synthetic_delivery_probe','critical',80,'clinical');
 INSERT INTO watchlist_signal_notifications(id,organization_id,facility_id,signal_instance_id,target_role,channel,status)
 VALUES(v_push,v_org,v_fac,v_signal,'synthetic','push','queued');
 IF EXISTS(SELECT 1 FROM claim_smart_rounding_notifications(gen_random_uuid(),NULL,v_token,now(),50)) THEN RAISE EXCEPTION 'Cross-organization claim'; END IF;
 SELECT * INTO v_claim FROM claim_smart_rounding_notifications(v_org,v_fac,v_token,now(),50) WHERE id=v_push;
 IF v_claim.id IS NULL OR v_claim.source <> 'watchlist' THEN RAISE EXCEPTION 'Acute push never claimed'; END IF;
 IF (SELECT status FROM resident_monitoring_order_notifications WHERE id=v_notification) <> 'sent'
 OR NOT EXISTS(SELECT 1 FROM exec_alerts WHERE id=v_order AND facility_id=v_fac AND deep_link_path='/admin/rounding') THEN RAISE EXCEPTION 'in-app marked sent without visible alert'; END IF;
 IF EXISTS(SELECT 1 FROM claim_smart_rounding_notifications(v_org,v_fac,v_other,now(),50) WHERE id=v_push) THEN RAISE EXCEPTION 'Concurrent notification claim'; END IF;
 BEGIN
  PERFORM record_smart_rounding_notification_outcome('watchlist',v_push,v_other,'sent');
  RAISE EXCEPTION 'Wrong claim accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM record_smart_rounding_notification_outcome('watchlist',v_push,v_token,'failed',NULL,NULL,'push failure',NULL,true,60);
 IF (SELECT status FROM watchlist_signal_notifications WHERE id=v_push) <> 'queued' THEN RAISE EXCEPTION 'Acute retry lost'; END IF;
 PERFORM 1 FROM claim_smart_rounding_notifications(v_org,v_fac,v_token,now()+interval '2 minutes',50);
 PERFORM record_smart_rounding_notification_outcome('watchlist',v_push,v_token,'sent',NULL,NULL,NULL,now());
 SELECT count(*) INTO v_n FROM exec_alerts WHERE id=v_order;
 IF v_n<>1 THEN RAISE EXCEPTION 'Duplicate in-app alerts'; END IF;
 INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) VALUES(v_actor,'rounding-delivery@haven.test','authenticated','authenticated',now(),now());
 INSERT INTO auth.sessions(id,user_id) VALUES(v_session,v_actor);
 INSERT INTO user_profiles(id,organization_id,email,full_name,app_role,is_active)
 VALUES(v_actor,v_org,'rounding-delivery@haven.test','Synthetic nurse','nurse',true);
 INSERT INTO user_facility_access(user_id,facility_id,organization_id,is_primary) VALUES(v_actor,v_fac,v_org,true);
 UPDATE resident_monitoring_order_notifications SET target_user_id=v_actor,status='queued',sent_at=NULL WHERE id=v_notification;
 PERFORM 1 FROM claim_smart_rounding_notifications(v_org,v_fac,v_token,now(),50);
 IF (SELECT status FROM resident_monitoring_order_notifications WHERE id=v_notification) <> 'skipped'
 OR (SELECT skip_reason FROM resident_monitoring_order_notifications WHERE id=v_notification) <> 'in_app_surface_unavailable'
 THEN RAISE EXCEPTION 'Nurse recipient falsely reported sent without visible inbox'; END IF;
 SELECT auth_claim_version INTO v_version FROM user_profiles WHERE id=v_actor;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',v_actor,'session_id',v_session,'auth_claim_version',v_version::text)::text,true);
 PERFORM set_config('delivery_test.alert',v_order::text,true);
 PERFORM set_config('delivery_test.unaddressed',v_signal::text,true);
 INSERT INTO exec_alerts(id,organization_id,facility_id,source_module,severity,title) VALUES(v_signal,v_org,v_fac,'compliance','warning','Unaddressed synthetic alert');
 RAISE NOTICE 'PASS: bounded retry, backoff, scoped claims, token ownership, Acute transport and real in-app artifact';
END;
$test$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF haven.app_role() <> 'nurse' THEN RAISE EXCEPTION 'Expected authenticated nurse'; END IF;
 IF NOT EXISTS(SELECT 1 FROM resident_monitoring_order_notifications WHERE monitoring_order_id=current_setting('delivery_test.alert')::uuid AND status='skipped' AND skip_reason='in_app_surface_unavailable') THEN RAISE EXCEPTION 'Nurse cannot read truthful unavailable receipt'; END IF;
 IF EXISTS(SELECT 1 FROM exec_alerts WHERE id=current_setting('delivery_test.unaddressed')::uuid) THEN RAISE EXCEPTION 'Unaddressed alert exposed to nurse'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',current_setting('delivery_test.owner_claims'),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF haven.app_role() NOT IN ('owner','org_admin') THEN RAISE EXCEPTION 'Expected authenticated executive'; END IF;
 IF NOT EXISTS(SELECT 1 FROM exec_alerts WHERE id=current_setting('delivery_test.alert')::uuid AND category='smart_rounding') THEN RAISE EXCEPTION 'Executive in-app receipt lacks readable alert'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
