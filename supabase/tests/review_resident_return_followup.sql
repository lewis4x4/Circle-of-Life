-- Synthetic rollback-only proof of durable presence and retriable document follow-up.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
GRANT USAGE ON SCHEMA auth,haven TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.residents,public.form_1823_records TO authenticated;
CREATE TEMP TABLE rf_fixture AS SELECT gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() facility,gen_random_uuid() other_facility;
INSERT INTO public.organizations(id,name) SELECT org,'Return follow-up fixture' FROM rf_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'Return follow-up fixture' FROM rf_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
 SELECT facility,entity,org,'Return facility','Fixture','Fixture','00000',1 FROM rf_fixture
 UNION ALL SELECT other_facility,entity,org,'Other facility','Fixture','Fixture','00000',1 FROM rf_fixture;
CREATE TEMP TABLE rf_actors AS SELECT role,gen_random_uuid() id,gen_random_uuid() session_id FROM unnest(ARRAY['owner','nurse','facility_admin','caregiver','other_nurse']) role;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT id,id||'@return.invalid','{}','{}' FROM rf_actors;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active)
 SELECT a.id,f.org,a.id||'@return.invalid','Return fixture actor',CASE WHEN a.role='other_nurse' THEN 'nurse' ELSE a.role END::public.app_role,true FROM rf_actors a CROSS JOIN rf_fixture f;
INSERT INTO auth.sessions(id,user_id) SELECT session_id,id FROM rf_actors;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id)
 SELECT a.id,CASE WHEN a.role='other_nurse' THEN f.other_facility ELSE f.facility END,f.org FROM rf_actors a CROSS JOIN rf_fixture f;
CREATE TEMP TABLE rf_residents AS SELECT kind,gen_random_uuid() id FROM unnest(ARRAY['normal','failure','empty','newer','changed','revised_expired','rollback']) kind;
INSERT INTO public.residents(id,organization_id,facility_id,first_name,last_name,date_of_birth,gender,status)
 SELECT r.id,f.org,f.facility,'Return',r.kind,'1950-01-01','female','hospital_hold' FROM rf_residents r CROSS JOIN rf_fixture f;
CREATE TEMP TABLE rf_docs AS SELECT r.kind,gen_random_uuid() id,r.id resident_id FROM rf_residents r WHERE kind IN ('normal','failure','newer','changed','revised_expired')
 UNION ALL SELECT 'failure_extra',gen_random_uuid(),id FROM rf_residents WHERE kind='failure'
 UNION ALL SELECT 'original_expired',gen_random_uuid(),id FROM rf_residents WHERE kind='revised_expired';
INSERT INTO public.form_1823_records(id,organization_id,facility_id,resident_id,status)
 SELECT d.id,f.org,f.facility,d.resident_id,CASE WHEN d.kind='original_expired' THEN 'expired' ELSE 'received' END::public.form_1823_status FROM rf_docs d CROSS JOIN rf_fixture f;
GRANT SELECT ON rf_fixture,rf_actors,rf_residents,rf_docs TO authenticated;
CREATE FUNCTION pg_temp.rf_claim(p_role text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('sub',a.id,'session_id',a.session_id,'role','authenticated','auth_claim_version',p.auth_claim_version)::text,true)::void
 FROM rf_actors a JOIN public.user_profiles p ON p.id=a.id WHERE a.role=p_role
$$;
CREATE FUNCTION pg_temp.rf_id(p_kind text) RETURNS uuid LANGUAGE sql AS $$
 SELECT f.id FROM public.resident_return_followups f JOIN rf_residents r ON r.id=f.resident_id WHERE r.kind=p_kind ORDER BY f.created_at DESC LIMIT 1
$$;
CREATE FUNCTION pg_temp.rf_assert(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %',p_label; END IF;
 RAISE NOTICE 'PASS: %',p_label;
END $$;
CREATE FUNCTION pg_temp.rf_reject(p_sql text,p_code text,p_label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>p_code THEN RAISE EXCEPTION 'FAIL: % expected %, got %: %',p_label,p_code,SQLSTATE,SQLERRM; END IF;
  RAISE NOTICE 'PASS: %',p_label; RETURN;
 END;
 RAISE EXCEPTION 'FAIL: % did not reject',p_label;
END $$;
SELECT pg_temp.rf_claim('nurse');
SET LOCAL ROLE authenticated;
UPDATE public.residents SET status='active' WHERE id IN(SELECT id FROM rf_residents WHERE kind<>'rollback');
SELECT pg_temp.rf_assert((SELECT count(*)=6 FROM public.resident_return_followups WHERE organization_id=(SELECT org FROM rf_fixture)), 'Presence records each durable follow-up');
UPDATE public.residents SET status='active' WHERE id=(SELECT id FROM rf_residents WHERE kind='normal');
SELECT pg_temp.rf_assert((SELECT count(*)=1 FROM public.resident_return_followups WHERE resident_id=(SELECT id FROM rf_residents WHERE kind='normal')), 'Unchanged active status does not duplicate episode');
SELECT pg_temp.rf_assert((SELECT bool_and(status=CASE WHEN id=(SELECT id FROM rf_docs WHERE kind='original_expired') THEN 'expired' ELSE 'received' END::public.form_1823_status) FROM public.form_1823_records WHERE organization_id=(SELECT org FROM rf_fixture)), 'Presence event does not mutate forms');
SELECT pg_temp.rf_assert((SELECT bool_and(hold_case_manager_notified_at IS NULL) FROM public.residents WHERE organization_id=(SELECT org FROM rf_fixture)), 'No fabricated communication timestamp');
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('normal'))->>'outcome'='completed', 'Nurse retries captured renewal');
SELECT pg_temp.rf_assert((SELECT status='renewal_due' FROM public.form_1823_records WHERE id=(SELECT id FROM rf_docs WHERE kind='normal')), 'Exact captured form marked renewal due');
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('normal'))->>'attempt_count'='1', 'Completed retry preserves original completion');
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('empty'))->>'code'='no_eligible_forms', 'No eligible forms stays visible needs review');
SELECT pg_temp.rf_reject($q$UPDATE public.resident_return_followups SET status='completed'$q$,'42501','Direct authenticated status write denied');
RESET ROLE;
-- A document write error leaves the return and pending task durable, with no partial form changes.
CREATE FUNCTION pg_temp.rf_fail_document() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id=(SELECT id FROM rf_docs WHERE kind='failure_extra') THEN RAISE EXCEPTION 'Synthetic document error'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_rf_fail_document BEFORE UPDATE ON public.form_1823_records FOR EACH ROW EXECUTE FUNCTION pg_temp.rf_fail_document();
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('failure'))->>'outcome'='retryable_error', 'Document failure stays pending and retryable');
SELECT pg_temp.rf_assert((SELECT bool_and(status='received') FROM public.form_1823_records WHERE resident_id=(SELECT id FROM rf_residents WHERE kind='failure')), 'Document failure rolls back all target updates');
SELECT pg_temp.rf_assert((SELECT status='active' FROM public.residents WHERE id=(SELECT id FROM rf_residents WHERE kind='failure')), 'Document failure preserves committed presence');
RESET ROLE;
DROP TRIGGER zz_rf_fail_document ON public.form_1823_records;
SELECT pg_temp.rf_claim('owner');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('failure'))->>'outcome'='completed', 'Owner completes later retry');
RESET ROLE;
-- A previously ineligible report can become new evidence without a new ID or timestamp.
UPDATE public.form_1823_records SET status='received',physician_name='Revised expired report' WHERE id=(SELECT id FROM rf_docs WHERE kind='original_expired');
SELECT pg_temp.rf_claim('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert((SELECT d.updated_at=(o->>'updated_at')::timestamptz FROM public.form_1823_records d
 CROSS JOIN public.resident_return_followups f CROSS JOIN LATERAL jsonb_array_elements(f.observed_forms) o
 WHERE d.id=(SELECT id FROM rf_docs WHERE kind='original_expired') AND f.id=pg_temp.rf_id('revised_expired') AND o->>'id'=d.id::text), 'Revision fixture preserves timestamp to test full content comparison');
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('revised_expired'))->>'code'='observed_document_changed', 'Revised formerly expired report requires review');
SELECT pg_temp.rf_assert((SELECT bool_and(status='received') FROM public.form_1823_records WHERE resident_id=(SELECT id FROM rf_residents WHERE kind='revised_expired')), 'New evidence and original eligible form remain untouched');
RESET ROLE;
-- Preserve a changed captured report and require explicit review instead.
UPDATE public.form_1823_records SET physician_name='New physician revision' WHERE id=(SELECT id FROM rf_docs WHERE kind='changed');
SELECT pg_temp.rf_claim('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('changed'))->>'code'='target_changed', 'Changed target revision is not overwritten');
SELECT pg_temp.rf_reject($q$SELECT public.haven_resolve_return_document_followup(pg_temp.rf_id('empty'),(SELECT id FROM rf_docs WHERE kind='normal'),' ',clock_timestamp())$q$,'22023','Human review needs a nonempty note');
RESET ROLE;
UPDATE public.form_1823_records SET deleted_at=clock_timestamp() WHERE id=(SELECT id FROM rf_docs WHERE kind='changed');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('changed'))->>'code'='target_missing', 'Missing captured target stays pending');
SELECT pg_temp.rf_reject($q$SELECT public.haven_resolve_return_document_followup(pg_temp.rf_id('empty'),(SELECT id FROM rf_docs WHERE kind='normal'),U&'\00A0\FEFF',clock_timestamp())$q$,'22023','Unicode whitespace alone is not a human review note');
RESET ROLE;
CREATE TEMP TABLE rf_new_docs AS SELECT kind,gen_random_uuid() id,r.id resident_id FROM rf_residents r WHERE kind IN ('empty','newer');
INSERT INTO public.form_1823_records(id,organization_id,facility_id,resident_id,status,created_at,updated_at)
 SELECT d.id,f.org,f.facility,d.resident_id,'received',clock_timestamp(),clock_timestamp() FROM rf_new_docs d CROSS JOIN rf_fixture f;
GRANT SELECT ON rf_new_docs TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert(public.haven_retry_return_document_followup(pg_temp.rf_id('newer'))->>'code'='newer_document_present', 'Newer report requires review and remains untouched');
SELECT pg_temp.rf_assert((SELECT bool_and(status='received') FROM public.form_1823_records WHERE resident_id=(SELECT id FROM rf_residents WHERE kind='newer')), 'Neither old nor new report is overwritten');
SELECT pg_temp.rf_reject($q$SELECT public.haven_resolve_return_document_followup(pg_temp.rf_id('newer'),(SELECT id FROM rf_docs WHERE kind='newer'),'Old report',(SELECT updated_at FROM public.form_1823_records WHERE id=(SELECT id FROM rf_docs WHERE kind='newer')))$q$,'22023','Pre-return document cannot support human resolution');
RESET ROLE;
SELECT pg_temp.rf_claim('facility_admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert(public.haven_resolve_return_document_followup(pg_temp.rf_id('empty'),(SELECT id FROM rf_new_docs WHERE kind='empty'),'Reviewed current report follow-up; physician approval is separate',(SELECT updated_at FROM public.form_1823_records WHERE id=(SELECT id FROM rf_new_docs WHERE kind='empty')))->>'code'='human_review_recorded', 'Facility admin records explicit human evidence');
SELECT pg_temp.rf_assert((SELECT status='received' FROM public.form_1823_records WHERE id=(SELECT id FROM rf_new_docs WHERE kind='empty')), 'Human resolution does not alter document status');
SELECT pg_temp.rf_assert(public.haven_resolve_return_document_followup(pg_temp.rf_id('empty'),(SELECT id FROM rf_new_docs WHERE kind='empty'),'Reviewed current report follow-up; physician approval is separate',(SELECT updated_at FROM public.form_1823_records WHERE id=(SELECT id FROM rf_new_docs WHERE kind='empty')))->>'attempt_count'='2', 'Identical human review replay returns original evidence');
SELECT pg_temp.rf_reject($q$SELECT public.haven_resolve_return_document_followup(pg_temp.rf_id('empty'),(SELECT id FROM rf_new_docs WHERE kind='empty'),'Different note',(SELECT updated_at FROM public.form_1823_records WHERE id=(SELECT id FROM rf_new_docs WHERE kind='empty')))$q$,'PT409','Completed review cannot silently replace a different note');
SELECT pg_temp.rf_reject($q$SELECT public.haven_resolve_return_document_followup(pg_temp.rf_id('newer'),(SELECT id FROM rf_new_docs WHERE kind='newer'),'Viewed stale form',now()-interval '1 day')$q$,'22023','Manual evidence rejects stale viewed document version');

RESET ROLE;
SELECT pg_temp.rf_claim('caregiver');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_reject($q$SELECT public.haven_retry_return_document_followup(pg_temp.rf_id('changed'))$q$,'42501','Caregiver cannot perform clinical return review');
RESET ROLE;
CREATE TEMP TABLE rf_ids AS SELECT pg_temp.rf_id('normal') normal_id,pg_temp.rf_id('changed') changed_id;
GRANT SELECT ON rf_ids TO authenticated;
SELECT pg_temp.rf_claim('other_nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_assert((SELECT count(*)=0 FROM public.resident_return_followups WHERE organization_id=(SELECT org FROM rf_fixture)), 'Other facility cannot read follow-up');
SELECT pg_temp.rf_reject($q$SELECT public.haven_retry_return_document_followup((SELECT changed_id FROM rf_ids))$q$,'42501','Other facility cannot retry by known ID');
RESET ROLE;
UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=(SELECT id FROM rf_actors WHERE role='nurse');
SELECT pg_temp.rf_claim('nurse');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rf_reject($q$SELECT public.haven_retry_return_document_followup((SELECT normal_id FROM rf_ids))$q$,'42501','Revoked actor cannot replay even completed follow-up');
RESET ROLE;
SELECT pg_temp.rf_reject($q$UPDATE public.resident_return_followups SET target_forms='[]' WHERE id=(SELECT changed_id FROM rf_ids)$q$,'42501','Captured targets immutable even to owner');
SELECT pg_temp.rf_reject($q$DELETE FROM public.resident_return_followups WHERE id=(SELECT changed_id FROM rf_ids)$q$,'42501','Follow-up evidence cannot be deleted');
-- Failure to persist companion evidence rolls presence/history back together.
CREATE FUNCTION pg_temp.rf_fail_followup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic follow-up insert error'; END $$;
CREATE TRIGGER zz_rf_fail_followup BEFORE INSERT ON public.resident_return_followups FOR EACH ROW EXECUTE FUNCTION pg_temp.rf_fail_followup();
SELECT pg_temp.rf_reject($q$UPDATE public.residents SET status='active' WHERE id=(SELECT id FROM rf_residents WHERE kind='rollback')$q$,'P0001','Companion failure aborts presence update');
SELECT pg_temp.rf_assert((SELECT status='hospital_hold' FROM public.residents WHERE id=(SELECT id FROM rf_residents WHERE kind='rollback')), 'Failed companion preserves prior presence');
SELECT pg_temp.rf_assert((SELECT count(*)=1 FROM public.resident_status_history WHERE resident_id=(SELECT id FROM rf_residents WHERE kind='rollback') AND effective_to IS NULL AND status='hospital_hold'), 'Failed companion preserves prior history');
SELECT pg_temp.rf_assert(NOT has_function_privilege('anon','public.haven_retry_return_document_followup(uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.haven_retry_return_document_followup(uuid)','EXECUTE'), 'Retry is current-user authenticated only');
ROLLBACK;
