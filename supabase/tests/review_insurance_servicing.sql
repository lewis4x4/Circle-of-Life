-- Disposable current-session servicing evidence. No hosted or clinical fixture changes persist.
-- Multi-session authority regression also executed: A holds the organization
-- advisory lock (hashtextextended(org::text,337)); B queues save with owner_id NULL;
-- C disables B actor and commits before A releases. B must fail Authentication
-- required after waiting and create zero rows. This isolates actor from assignee.
-- Assignee qualification regression also executed: A holds a new assignee profile
-- UPDATE is_active=false; B save waits on its FOR SHARE scope lock; A commits.
-- B must reject Invalid work owner with zero rows, qualifying only after the lock.
BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(auth.jwt()->>'sub','')::uuid$$;
CREATE TEMP TABLE servicing_fixture AS SELECT f.organization_id org,f.entity_id entity,f.id facility,gen_random_uuid() actor,gen_random_uuid() facility_actor,gen_random_uuid() actor_session,gen_random_uuid() facility_session,gen_random_uuid() other_org,gen_random_uuid() other_entity,gen_random_uuid() other_facility,gen_random_uuid() policy,gen_random_uuid() doc,gen_random_uuid() certificate,gen_random_uuid() endorsement,gen_random_uuid() foreign_doc,gen_random_uuid() vendor,gen_random_uuid() other_vendor,gen_random_uuid() contract,gen_random_uuid() incident FROM public.facilities f WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{"full_name":"Servicing owner"}'::jsonb FROM servicing_fixture UNION ALL SELECT facility_actor,facility_actor||'@review.invalid',jsonb_build_object('organization_id',org,'app_role','facility_admin'),'{"full_name":"Servicing facility"}'::jsonb FROM servicing_fixture;
INSERT INTO public.user_profiles(id,email,full_name,app_role,organization_id,is_active) SELECT actor,actor||'@review.invalid','Servicing owner','owner'::public.app_role,org,true FROM servicing_fixture UNION ALL SELECT facility_actor,facility_actor||'@review.invalid','Servicing facility','facility_admin'::public.app_role,org,true FROM servicing_fixture ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO auth.sessions(id,user_id) SELECT actor_session,actor FROM servicing_fixture UNION ALL SELECT facility_session,facility_actor FROM servicing_fixture;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id) SELECT facility_actor,facility,org FROM servicing_fixture;
INSERT INTO public.organizations(id,name) SELECT other_org,'Servicing other organization' FROM servicing_fixture;
INSERT INTO public.entities(id,organization_id,name) SELECT other_entity,org,'Servicing unrelated entity' FROM servicing_fixture;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds) SELECT other_facility,entity,org,'Servicing other facility','Test','Test','00000',1 FROM servicing_fixture;
INSERT INTO public.insurance_policies(id,organization_id,entity_id,policy_type,carrier_name,policy_number,effective_date,expiration_date,verification_status,version) SELECT policy,org,entity,'general_liability','Fixture Carrier','SERVICING-'||policy,'2026-01-01','2026-12-31','verified',1 FROM servicing_fixture;
INSERT INTO public.insurance_policy_parties(organization_id,policy_id,entity_id,role,effective_from) SELECT org,policy,entity,'primary_named_insured','2026-01-01' FROM servicing_fixture;
INSERT INTO public.insurance_policy_facilities(organization_id,policy_id,facility_id,role,effective_from) SELECT org,policy,facility,'covered_location','2026-01-01' FROM servicing_fixture;
INSERT INTO public.insurance_documents(id,organization_id,filename,sha256,mime_type,byte_size,family,storage_path,status,scan_status,created_by)
 SELECT doc,org,'servicing.pdf',repeat('c',64),'application/pdf',100,'policy',org::text||'/'||doc,'ready','clean',actor FROM servicing_fixture
 UNION ALL SELECT certificate,org,'certificate.pdf',repeat('d',64),'application/pdf',100,'certificate',org::text||'/'||certificate,'ready','clean',actor FROM servicing_fixture
 UNION ALL SELECT endorsement,org,'endorsement.pdf',repeat('e',64),'application/pdf',100,'endorsement',org::text||'/'||endorsement,'ready','clean',actor FROM servicing_fixture
 UNION ALL SELECT foreign_doc,other_org,'foreign.pdf',repeat('f',64),'application/pdf',100,'policy',other_org::text||'/'||foreign_doc,'ready','clean',actor FROM servicing_fixture;
INSERT INTO public.vendors(id,organization_id,name) SELECT vendor,org,'Servicing vendor' FROM servicing_fixture UNION ALL SELECT other_vendor,org,'Servicing different vendor' FROM servicing_fixture;
INSERT INTO public.contracts(id,organization_id,vendor_id,title,effective_date) SELECT contract,org,vendor,'Servicing vendor contract','2026-01-01' FROM servicing_fixture;
INSERT INTO public.incidents(id,organization_id,facility_id,incident_number,category,severity,occurred_at,shift,location_description,description,immediate_actions,reported_by) SELECT incident,org,facility,'SERVICE-INCIDENT-'||incident,'fall_without_injury','level_1','2026-02-01','day','Synthetic fixture','Clinical narrative stays separate','Synthetic response',actor FROM servicing_fixture;
CREATE TEMP TABLE servicing_receipts(name text PRIMARY KEY,value jsonb);
GRANT SELECT ON servicing_fixture TO authenticated;
GRANT ALL ON servicing_receipts TO authenticated;
CREATE FUNCTION pg_temp.servicing_actor(p_facility boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE f record;uid uuid;sid uuid;BEGIN SELECT * INTO f FROM servicing_fixture;uid:=CASE WHEN p_facility THEN f.facility_actor ELSE f.actor END;sid:=CASE WHEN p_facility THEN f.facility_session ELSE f.actor_session END;PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',uid,'session_id',sid,'auth_claim_version',(SELECT auth_claim_version FROM public.user_profiles WHERE id=uid))::text,true);END$$;
CREATE FUNCTION pg_temp.servicing_expect(q text,msg text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE q;EXCEPTION WHEN OTHERS THEN IF position(msg IN SQLERRM)>0 THEN RETURN;END IF;RAISE;END;RAISE EXCEPTION 'Expected rejection: %',msg;END$$;
CREATE FUNCTION pg_temp.servicing_save(kind text,p jsonb,p_doc uuid DEFAULT NULL,pol uuid DEFAULT NULL,fac uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('id',gen_random_uuid(),'kind',kind,'title','Reviewed '||kind,'entity_id',entity,'facility_id',fac,'policy_id',pol,'document_id',p_doc,'owner_id',actor,'due_date',NULL,'payload',p) FROM servicing_fixture$$;
CREATE FUNCTION pg_temp.servicing_transition(r jsonb,target text,extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$SELECT public.insurance_servicing('transition',jsonb_build_object('id',r->>'id','version',(r->>'version')::integer,'status',target)||extra)->'record'$$;
CREATE FUNCTION pg_temp.loss_payload(valuation text,paid integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('carrier_name','Fixture Carrier','valuation_date',valuation,'period_start','2026-01-01','period_end','2026-03-31','coverage_line','General liability','complete_periods',true,'no_losses_confirmed',false,'no_loss_evidence_page',NULL,'claims',jsonb_build_array(jsonb_build_object('claim_reference','CLAIM-1','loss_date','2026-02-01','paid_cents',paid,'reserve_cents',NULL,'recovery_cents',0,'expense_cents',10,'incurred_cents',NULL,'incurred_includes_expenses',NULL,'page',1)))$$;
SELECT pg_temp.servicing_actor();
SET LOCAL ROLE authenticated;
DO $$DECLARE r jsonb;BEGIN
 IF has_function_privilege('anon','public.insurance_servicing(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anon servicing exposed';END IF;
 r:=public.insurance_servicing('list','{}');
 IF jsonb_array_length(r->'incidents')<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'incidents') i WHERE (SELECT count(*) FROM jsonb_object_keys(i))<>4 OR i?'description' OR i?'resident_id' OR i?'staff_id') THEN RAISE EXCEPTION 'Incident choice projection missing or leaks clinical fields';END IF;
 IF r->'loss_totals'->'paid_cents'->'total_cents'<>'null'::jsonb OR r->'loss_totals'->'history_complete'<>'false'::jsonb THEN RAISE EXCEPTION 'Empty history presented as known zero';END IF;
END$$;
-- Package snapshot is generated from the actual verified term, never client JSON.
INSERT INTO servicing_receipts SELECT 'package_input',pg_temp.servicing_save('renewal_package',jsonb_build_object('period_start','2026-01-01','period_end','2026-12-31','document_ids',jsonb_build_array(doc),'location_changes','Reviewed locations','exposures','Reviewed exposure','open_questions','None','recipient','Broker Example','policy_snapshot',jsonb_build_object('version',999)),doc,policy) FROM servicing_fixture;
INSERT INTO servicing_receipts SELECT 'package',public.insurance_servicing('save',value)->'record' FROM servicing_receipts WHERE name='package_input';
DO $$DECLARE r jsonb;BEGIN SELECT value INTO r FROM servicing_receipts WHERE name='package';IF r->'payload'->'policy_snapshot'->>'version'<>'1' THEN RAISE EXCEPTION 'Forged snapshot accepted';END IF;IF (public.insurance_servicing('save',(SELECT value FROM servicing_receipts WHERE name='package_input'))->'record')<>r THEN RAISE EXCEPTION 'Initial save retry not stable';END IF;END$$;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT value||'{"title":"Collision"}'::jsonb FROM servicing_receipts WHERE name='package_input')),'Stale or finalized');
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT value||jsonb_build_object('id',gen_random_uuid(),'display_names',jsonb_build_object('entity','Forged legal label')) FROM servicing_receipts WHERE name='package_input')),'Display names are prepared by the server');
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT value||jsonb_build_object('id',gen_random_uuid(),'document_id',foreign_doc) FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='package_input')),'Ready source document unavailable');
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT value||jsonb_build_object('id',gen_random_uuid(),'entity_id',other_entity) FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='package_input')),'Policy does not belong');
RESET ROLE;
INSERT INTO public.insurance_policy_parties(organization_id,policy_id,entity_id,role,effective_from,effective_to) SELECT org,policy,other_entity,'additional_insured','2026-01-01','2026-03-31' FROM servicing_fixture;
SET LOCAL ROLE authenticated;
DO $$DECLARE choices jsonb;BEGIN
 SELECT value INTO choices FROM jsonb_array_elements(public.insurance_servicing('list','{}')->'policies') WHERE value->>'id'=(SELECT policy::text FROM servicing_fixture);
 IF NOT choices->'insured_entity_ids' @> jsonb_build_array((SELECT other_entity FROM servicing_fixture)) OR NOT choices->'covered_facility_ids' @> jsonb_build_array((SELECT facility FROM servicing_fixture)) THEN RAISE EXCEPTION 'Approved shared-policy choices omitted insured entity or facility';END IF;
 PERFORM public.insurance_servicing('save',(SELECT value||jsonb_build_object('id',gen_random_uuid(),'entity_id',other_entity,'facility_id',facility) FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='package_input'));
END$$;

UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='package';
RESET ROLE;
UPDATE public.insurance_policies SET version=2 WHERE id=(SELECT policy FROM servicing_fixture);
SET LOCAL ROLE authenticated;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='package')),'Policy snapshot stale');
UPDATE servicing_receipts SET value=public.insurance_servicing('save',(SELECT value FROM servicing_receipts WHERE name='package_input')||jsonb_build_object('version',2))->'record' WHERE name='package';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='package';
INSERT INTO servicing_receipts SELECT 'package_approved',value FROM servicing_receipts WHERE name='package';
DO $$DECLARE r jsonb;BEGIN SELECT value INTO r FROM servicing_receipts WHERE name='package';IF public.insurance_servicing('export',jsonb_build_object('id',r->>'id','version',r->'version'))->'record'<>r-'versions' THEN RAISE EXCEPTION 'Export changed approved snapshot';END IF;END$$;
-- Prepared directory labels remain exact when the current directory later changes.
RESET ROLE;
UPDATE public.entities SET name='Renamed entity after approval' WHERE id=(SELECT entity FROM servicing_fixture);
UPDATE public.facilities SET name='Renamed facility after approval' WHERE id=(SELECT facility FROM servicing_fixture);
UPDATE public.user_profiles SET full_name='Renamed owner after approval' WHERE id=(SELECT actor FROM servicing_fixture);
SET LOCAL ROLE authenticated;
DO $$DECLARE frozen jsonb;exported jsonb;BEGIN
 SELECT value INTO frozen FROM servicing_receipts WHERE name='package_approved';
 exported:=public.insurance_servicing('export',jsonb_build_object('id',frozen->>'id','version',frozen->'version'))->'record';
 IF exported->'display_names'<>frozen->'display_names' OR nullif(exported->'display_names'->>'entity','') IS NULL OR exported->'display_names'->>'entity'='Renamed entity after approval' OR exported->'display_names'->>'owner'='Renamed owner after approval' THEN RAISE EXCEPTION 'Export directory labels changed after approval';END IF;
 IF nullif(exported->'payload'->'policy_snapshot'->>'entity_name','') IS NULL OR nullif(exported->'payload'->'policy_snapshot'->'parties'->0->>'entity_name','') IS NULL OR nullif(exported->'payload'->'policy_snapshot'->'facilities'->0->>'facility_name','') IS NULL THEN RAISE EXCEPTION 'Approved package lacks readable prepared schedule labels';END IF;
 IF exported->'payload'->'policy_snapshot'->>'entity_name'='Renamed entity after approval' OR exported->'payload'->'policy_snapshot'->'facilities'->0->>'facility_name'='Renamed facility after approval' THEN RAISE EXCEPTION 'Export schedule names changed after approval';END IF;
END$$;
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'shared','{"recipient":"Broker Example","note":"Operator recorded secure handoff"}') WHERE name='package';
DO $$DECLARE r jsonb;BEGIN SELECT value INTO r FROM servicing_receipts WHERE name='package';IF (public.insurance_servicing('transition',jsonb_build_object('id',r->>'id','version',(r->>'version')::integer-1,'status','shared','recipient','Broker Example','note','Operator recorded secure handoff'))->'record')<>r THEN RAISE EXCEPTION 'Identical transition retry not idempotent';END IF;END$$;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',(value->>'version')::integer-1,'status','shared','recipient','Other','note','Different') FROM servicing_receipts WHERE name='package')),'Stale servicing version');
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'acknowledged','{"recipient":"Broker Example","acknowledgment":"Operator recorded broker receipt"}') WHERE name='package';
DO $$BEGIN IF (SELECT value->'payload' FROM servicing_receipts WHERE name='package')<>(SELECT value->'payload' FROM servicing_receipts WHERE name='package_approved') THEN RAISE EXCEPTION 'Sharing changed approved payload';END IF;END$$;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT value||jsonb_build_object('version',6) FROM servicing_receipts WHERE name='package_input')),'Stale or finalized');
-- Vendor evidence: a certificate flag never substitutes for a separate endorsement.
INSERT INTO servicing_receipts SELECT 'vendor_input',pg_temp.servicing_save('vendor_evidence',jsonb_build_object('vendor_id',vendor,'contract_id',contract,'requirements','Additional insured required','requires_endorsement',true,'endorsement_document_id',NULL,'endorsement_page',NULL,'assessment','Reviewed certificate, endorsement missing','exception_reason',NULL,'expiration_date','2026-12-31'),certificate) FROM servicing_fixture;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT jsonb_set(value,'{payload,vendor_id}',to_jsonb(other_vendor)) FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='vendor_input')),'Contract vendor mismatch');
INSERT INTO servicing_receipts SELECT 'vendor',public.insurance_servicing('save',value)->'record' FROM servicing_receipts WHERE name='vendor_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='vendor';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='vendor')),'Separate policy endorsement');
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','exception_approved') FROM servicing_receipts WHERE name='vendor')),'Explicit exception reason');
UPDATE servicing_receipts SET value=public.insurance_servicing('save',(SELECT value FROM servicing_receipts WHERE name='vendor_input')||jsonb_build_object('version',2,'payload',(SELECT value->'payload' FROM servicing_receipts WHERE name='vendor_input')||'{"exception_reason":"Owner accepts documented temporary exception"}'::jsonb))->'record' WHERE name='vendor';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'exception_approved') WHERE name='vendor';
INSERT INTO servicing_receipts SELECT 'vendor_supported',public.insurance_servicing('save',value||jsonb_build_object('id',gen_random_uuid(),'payload',(value->'payload')||jsonb_build_object('endorsement_document_id',endorsement,'endorsement_page',2)))->'record' FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='vendor_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='vendor_supported';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='vendor_supported';
-- Workforce is aggregate-only with explicit source, class mapping, and separate estimates.
INSERT INTO servicing_receipts SELECT 'exposure_input',pg_temp.servicing_save('workforce_exposure','{"period_start":"2026-01-01","period_end":"2026-12-31","broker_mapping_confirmed":false,"manual_source_reason":"Reviewed aggregate payroll schedule","notes":"No individual data","rows":[{"state":"FL","class_code":"8824","estimated_payroll_cents":500000,"actual_payroll_cents":null,"basis_note":"Estimated annual payroll"}]}'::jsonb);
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT jsonb_set(value,'{payload,rows,0,employee_name}','"Forbidden identity"') FROM servicing_receipts WHERE name='exposure_input')),'Aggregate exposure fields only');
INSERT INTO servicing_receipts SELECT 'exposure',public.insurance_servicing('save',value)->'record' FROM servicing_receipts WHERE name='exposure_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='exposure';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='exposure')),'Broker class mapping');
UPDATE servicing_receipts SET value=public.insurance_servicing('save',jsonb_set((SELECT value FROM servicing_receipts WHERE name='exposure_input')||'{"version":2}'::jsonb,'{payload,broker_mapping_confirmed}','true'))->'record' WHERE name='exposure';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='exposure';
-- Claim matter keeps later report/acknowledgment details outside the approved content.
INSERT INTO servicing_receipts SELECT 'claim_input',pg_temp.servicing_save('claim_matter',jsonb_build_object('incident_id',incident,'carrier_reference',NULL,'loss_date','2026-02-01','reported_date',NULL,'recipient',NULL,'acknowledgment',NULL,'next_action','Owner to follow up with insurer','description','Operational description only'),NULL,policy,facility) FROM servicing_fixture;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT value||jsonb_build_object('facility_id',other_facility) FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='claim_input')),'Incident facility mismatch');
INSERT INTO servicing_receipts SELECT 'claim',public.insurance_servicing('save',value)->'record' FROM servicing_receipts WHERE name='claim_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='claim';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='claim';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'shared','{"recipient":"Carrier intake","note":"Operator reported through existing channel"}') WHERE name='claim';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',4,'status','acknowledged','recipient','Carrier intake','acknowledgment','Reference received') FROM servicing_receipts WHERE name='claim')),'reported date required');
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'acknowledged','{"recipient":"Carrier intake","acknowledgment":"Reference received","reported_date":"2026-02-02"}') WHERE name='claim';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'closed','{"note":"Completed tracked follow-up"}') WHERE name='claim';
DO $$DECLARE r jsonb;BEGIN SELECT value INTO r FROM servicing_receipts WHERE name='claim';IF r->'payload'->'reported_date'<>'null'::jsonb OR r->'event_metadata'->>'reported_date'<>'2026-02-02' THEN RAISE EXCEPTION 'Claim event overwrote approved payload';END IF;END$$;
-- Carrier snapshots choose the latest valuation, never add duplicate claim rows.
INSERT INTO servicing_receipts SELECT 'loss1_input',pg_temp.servicing_save('loss_report',pg_temp.loss_payload('2026-04-01',100),doc,policy) FROM servicing_fixture;
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT jsonb_set(value,'{payload,claims,0,paid_cents}','2147483648') FROM servicing_receipts WHERE name='loss1_input')),'Invalid loss integer cents');
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''save'',%L)',(SELECT jsonb_set(value,'{payload,claims}',(value->'payload'->'claims')||(value->'payload'->'claims')) FROM servicing_receipts WHERE name='loss1_input')),'Duplicate claim reference');
INSERT INTO servicing_receipts SELECT 'loss1',public.insurance_servicing('save',value)->'record' FROM servicing_receipts WHERE name='loss1_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='loss1';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='loss1';
INSERT INTO servicing_receipts SELECT 'loss_duplicate',public.insurance_servicing('save',value||jsonb_build_object('id',gen_random_uuid()))->'record' FROM servicing_receipts WHERE name='loss1_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='loss_duplicate';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='loss_duplicate')),'valuation already approved');
INSERT INTO servicing_receipts SELECT 'claim_valuation_duplicate',public.insurance_servicing('save',value||jsonb_build_object('id',gen_random_uuid(),'document_id',endorsement))->'record' FROM servicing_receipts CROSS JOIN servicing_fixture WHERE name='loss1_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='claim_valuation_duplicate';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='claim_valuation_duplicate')),'Claim identity valuation already approved');
INSERT INTO servicing_receipts SELECT 'loss2_input',pg_temp.servicing_save('loss_report',pg_temp.loss_payload('2026-05-01',200),doc,policy) FROM servicing_fixture;
INSERT INTO servicing_receipts SELECT 'loss2',public.insurance_servicing('save',value)->'record' FROM servicing_receipts WHERE name='loss2_input';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='loss2';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='loss2';
DO $$DECLARE t jsonb;BEGIN t:=public.insurance_servicing('list','{}')->'loss_totals';IF t->>'claim_count'<>'1' OR t->'paid_cents'->>'total_cents'<>'200' OR t->'reserve_cents'->>'missing_count'<>'1' OR t->'reserve_cents'->'total_cents'<>'null'::jsonb THEN RAISE EXCEPTION 'Loss totals duplicate snapshots or erase unknown amounts';END IF;END$$;
INSERT INTO servicing_receipts SELECT 'correction',public.insurance_servicing('revise',jsonb_build_object('id',value->>'id','version',3,'new_id',gen_random_uuid()))->'record' FROM servicing_receipts WHERE name='loss2';
INSERT INTO servicing_receipts SELECT 'second_correction',public.insurance_servicing('revise',jsonb_build_object('id',value->>'id','version',3,'new_id',gen_random_uuid()))->'record' FROM servicing_receipts WHERE name='loss2';
UPDATE servicing_receipts SET value=public.insurance_servicing('save',(SELECT value FROM servicing_receipts WHERE name='loss2_input')||jsonb_build_object('id',value->>'id','version',1,'payload',pg_temp.loss_payload('2026-05-01',250)))->'record' WHERE name='correction';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='correction';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'approved') WHERE name='correction';
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='second_correction';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='second_correction')),'predecessor no longer authoritative');
DO $$DECLARE t jsonb;BEGIN t:=public.insurance_servicing('list','{}')->'loss_totals';IF t->>'claim_count'<>'1' OR t->'paid_cents'->>'total_cents'<>'250' THEN RAISE EXCEPTION 'Correction failed to replace authority';END IF;END$$;
INSERT INTO servicing_receipts SELECT 'empty_loss',public.insurance_servicing('save',pg_temp.servicing_save('loss_report',pg_temp.loss_payload('2026-06-01')||'{"claims":[],"no_losses_confirmed":true,"no_loss_evidence_page":null}'::jsonb,doc,policy))->'record' FROM servicing_fixture;
UPDATE servicing_receipts SET value=pg_temp.servicing_transition(value,'review_required') WHERE name='empty_loss';
SELECT pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''transition'',%L)',(SELECT jsonb_build_object('id',value->>'id','version',2,'status','approved') FROM servicing_receipts WHERE name='empty_loss')),'no-loss evidence page');
-- Direct reads stay denied even to browser managers; approved history cannot mutate.
DO $$BEGIN IF EXISTS(SELECT 1 FROM public.insurance_servicing_records) OR EXISTS(SELECT 1 FROM public.insurance_servicing_versions) THEN RAISE EXCEPTION 'Raw servicing rows exposed';END IF;END$$;
SELECT pg_temp.servicing_actor(true);
SELECT pg_temp.servicing_expect('SELECT public.insurance_servicing(''list'',''{}'')','Insurance manager required');
DO $$BEGIN IF EXISTS(SELECT 1 FROM public.audit_log WHERE table_name LIKE 'insurance_servicing_%') THEN RAISE EXCEPTION 'Servicing audit exposed to facility actor';END IF;END$$;
RESET ROLE;
SELECT pg_temp.servicing_expect('UPDATE public.insurance_servicing_records SET payload=''{}'' WHERE status=''approved''','Approved servicing content is immutable');
SELECT pg_temp.servicing_expect('UPDATE public.insurance_servicing_records SET display_names=''{}'' WHERE status=''approved''','Approved servicing content is immutable');
SELECT pg_temp.servicing_expect('UPDATE public.insurance_servicing_versions SET event=''{}''','Approved insurance history is immutable');
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.insurance_servicing_exports) THEN RAISE EXCEPTION 'Package export was not audited';END IF;
 IF (SELECT description FROM public.incidents WHERE id=(SELECT incident FROM servicing_fixture))<>'Clinical narrative stays separate' THEN RAISE EXCEPTION 'Servicing changed clinical incident source';END IF;
END$$;
-- Legacy narrative mutation always invalidates earlier review/publication receipts.
INSERT INTO public.renewal_data_packages(organization_id,entity_id,insurance_policy_id,period_start,period_end,payload,narrative_reviewed_by,narrative_reviewed_at,narrative_published_by,narrative_published_at) SELECT org,entity,policy,'2026-01-01','2026-12-31','{}',actor,now(),actor,now() FROM servicing_fixture;
UPDATE public.renewal_data_packages SET ai_narrative_draft='Changed narrative' WHERE insurance_policy_id=(SELECT policy FROM servicing_fixture);
DO $$BEGIN IF EXISTS(SELECT 1 FROM public.renewal_data_packages WHERE insurance_policy_id=(SELECT policy FROM servicing_fixture) AND (narrative_reviewed_by IS NOT NULL OR narrative_reviewed_at IS NOT NULL OR narrative_published_by IS NOT NULL OR narrative_published_at IS NOT NULL)) THEN RAISE EXCEPTION 'Legacy package changed under stale approval';END IF;END$$;
-- An inactive historical assignee does not prevent another current manager
-- from accessing exact approved history or preparing a recoverable revision.
UPDATE public.user_profiles SET app_role='org_admin' WHERE id=(SELECT facility_actor FROM servicing_fixture);
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT actor FROM servicing_fixture);
SELECT pg_temp.servicing_actor(true);
SET LOCAL ROLE authenticated;
DO $$DECLARE approved jsonb;current_record jsonb;revision jsonb;input jsonb;exported jsonb;BEGIN
 SELECT value INTO approved FROM servicing_receipts WHERE name='package_approved';
 SELECT value INTO current_record FROM servicing_receipts WHERE name='package';
 exported:=public.insurance_servicing('export',jsonb_build_object('id',approved->>'id','version',approved->'version'))->'record';
 IF exported->'display_names'<>approved->'display_names' OR exported->>'created_by'<>approved->>'created_by' THEN RAISE EXCEPTION 'Historical assignee recovery changed provenance';END IF;
 input:=jsonb_build_object('id',current_record->>'id','version',current_record->'version','owner_id',(SELECT facility_actor FROM servicing_fixture),'due_date','2026-11-01','note','Current manager assumes operational follow-up');
 current_record:=public.insurance_servicing('reassign',input)->'record';
 IF current_record->'display_names'<>approved->'display_names' OR current_record->'payload'<>approved->'payload' OR current_record->>'owner_id'<>(SELECT facility_actor::text FROM servicing_fixture) THEN RAISE EXCEPTION 'Reassignment changed approved content or failed operational owner';END IF;
 IF public.insurance_servicing('reassign',input)->'record'<>current_record THEN RAISE EXCEPTION 'Reassignment retry was not idempotent';END IF;
 PERFORM pg_temp.servicing_expect(format('SELECT public.insurance_servicing(''reassign'',%L)',input||'{"note":"Different intention"}'::jsonb),'Stale servicing version');

 revision:=public.insurance_servicing('revise',jsonb_build_object('id',current_record->>'id','version',current_record->'version','new_id',gen_random_uuid()))->'record';
 IF revision->>'owner_id'<>current_record->>'owner_id' OR revision->'display_names'<>approved->'display_names' THEN RAISE EXCEPTION 'Revision did not preserve prepared historical labels';END IF;
 input:=(SELECT value FROM servicing_receipts WHERE name='package_input')||jsonb_build_object('id',revision->>'id','version',1,'owner_id',revision->>'owner_id');
 revision:=public.insurance_servicing('save',input)->'record';
 input:=input||jsonb_build_object('version',revision->'version','owner_id',(SELECT facility_actor FROM servicing_fixture));
 revision:=public.insurance_servicing('save',input)->'record';
 IF revision->>'owner_id'<>(SELECT facility_actor::text FROM servicing_fixture) THEN RAISE EXCEPTION 'Current manager could not recover revision ownership';END IF;
END$$;
RESET ROLE;
SELECT pg_temp.servicing_actor();
SET LOCAL ROLE authenticated;
SELECT pg_temp.servicing_expect('SELECT public.insurance_servicing(''list'',''{}'')','Authentication required');
RESET ROLE;
ROLLBACK;
