-- COL-294 signing delivery database contract. Synthetic fixtures only; rollback.
BEGIN;

DO $$
DECLARE sig regprocedure;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.prepare_boldsign_contract_send(uuid,uuid,uuid,uuid,uuid,text,boolean,text)'::regprocedure,
    'public.commit_boldsign_contract_send(uuid,uuid,text,integer,text,jsonb,timestamptz)'::regprocedure,
    'public.fail_boldsign_contract_send(uuid,uuid,text,integer,boolean,text,jsonb)'::regprocedure,
    'public.apply_boldsign_webhook_event(text,text,text,text,timestamptz,jsonb,text,text,text,text,boolean)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',sig,'EXECUTE')
       OR has_function_privilege('authenticated',sig,'EXECUTE')
       OR NOT has_function_privilege('service_role',sig,'EXECUTE') THEN
      RAISE EXCEPTION 'incorrect RPC grant: %',sig;
    END IF;
  END LOOP;
  IF has_table_privilege('anon','public.resident_contract_send_claims','SELECT')
     OR has_table_privilege('authenticated','public.resident_contract_send_claims','SELECT')
     OR has_table_privilege('service_role','public.resident_contract_send_claims','SELECT') THEN
    RAISE EXCEPTION 'send claims table is directly readable';
  END IF;
END $$;

CREATE TEMP TABLE bs AS SELECT
  gen_random_uuid() org,gen_random_uuid() entity,gen_random_uuid() facility,
  gen_random_uuid() actor,gen_random_uuid() actor2,gen_random_uuid() resident,
  gen_random_uuid() c1,gen_random_uuid() c2,gen_random_uuid() c3,
  gen_random_uuid() c4,gen_random_uuid() c5,
  gen_random_uuid() s1,gen_random_uuid() s2,gen_random_uuid() s3,
  gen_random_uuid() s4,gen_random_uuid() s5,gen_random_uuid() s6,
  gen_random_uuid() request1,gen_random_uuid() request2a,gen_random_uuid() request2b,
  gen_random_uuid() request3,gen_random_uuid() request4,gen_random_uuid() request5;

INSERT INTO public.organizations(id,name) SELECT org,'BoldSign probe org' FROM bs;
INSERT INTO public.entities(id,organization_id,name) SELECT entity,org,'BoldSign probe entity' FROM bs;
INSERT INTO public.facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
SELECT facility,entity,org,'BoldSign probe facility','1 Probe St','Probe','32000',1 FROM bs;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
SELECT actor,actor||'@boldsign.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{}'::jsonb FROM bs
UNION ALL
SELECT actor2,actor2||'@boldsign.invalid',jsonb_build_object('organization_id',org,'app_role','owner'),'{}'::jsonb FROM bs;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role)
SELECT actor,org,actor||'@boldsign.invalid','Original signing actor','owner'::public.app_role FROM bs
UNION ALL SELECT actor2,org,actor2||'@boldsign.invalid','Replacement signing actor','owner'::public.app_role FROM bs;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender,status)
SELECT resident,facility,org,'Synthetic','Signer','1940-01-01','other'::public.gender,'active'::public.resident_status FROM bs;
INSERT INTO public.resident_contracts(id,organization_id,facility_id,resident_id,contract_type,title,provider,status)
SELECT c1,org,facility,resident,'admission_agreement','Synthetic admission agreement','boldsign','draft' FROM bs
UNION ALL SELECT c2,org,facility,resident,'financial_agreement','Synthetic financial agreement','boldsign','draft' FROM bs
UNION ALL SELECT c3,org,facility,resident,'arbitration_agreement','Synthetic arbitration agreement','boldsign','draft' FROM bs
UNION ALL SELECT c4,org,facility,resident,'photo_release','Synthetic photo release','boldsign','draft' FROM bs
UNION ALL SELECT c5,org,facility,resident,'other','Synthetic other agreement','boldsign','draft' FROM bs;
INSERT INTO public.resident_contract_signers(
  id,organization_id,facility_id,contract_id,resident_id,signer_role,signer_name,signer_email,routing_order,status
)
SELECT s1,org,facility,c1,resident,'resident','Synthetic One','one@boldsign.invalid',1,'pending' FROM bs
UNION ALL SELECT s2,org,facility,c2,resident,'resident','Synthetic Two','two@boldsign.invalid',1,'pending' FROM bs
UNION ALL SELECT s3,org,facility,c3,resident,'resident','Synthetic Three','three@boldsign.invalid',1,'pending' FROM bs
UNION ALL SELECT s4,org,facility,c4,resident,'resident','Synthetic Four','four@boldsign.invalid',1,'pending' FROM bs
UNION ALL SELECT s5,org,facility,c5,resident,'resident','Synthetic Five A','duplicate@boldsign.invalid',1,'pending' FROM bs
UNION ALL SELECT s6,org,facility,c5,resident,'witness','Synthetic Five B','duplicate@boldsign.invalid',2,'pending' FROM bs;

GRANT SELECT ON bs TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.resident_contracts,public.resident_contract_signers TO authenticated;
ALTER TABLE public.resident_contracts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_contract_signers DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  UPDATE public.resident_contracts SET provider_environment='sandbox'
  WHERE id=(SELECT c1 FROM bs);
  RAISE EXCEPTION 'authenticated changed trusted contract projection fields';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='authenticated changed trusted contract projection fields'
     OR SQLERRM<>'boldsign_projection_fields_are_service_only' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  UPDATE public.resident_contract_signers SET provider_status_created_at=now()
  WHERE id=(SELECT s1 FROM bs);
  RAISE EXCEPTION 'authenticated changed trusted signer projection fields';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='authenticated changed trusted signer projection fields'
     OR SQLERRM<>'boldsign_projection_fields_are_service_only' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  UPDATE public.resident_contracts
  SET provider_document_id='forged-document',status='sent',sent_at=now()
  WHERE id=(SELECT c1 FROM bs);
  RAISE EXCEPTION 'authenticated changed legal signing lifecycle';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='authenticated changed legal signing lifecycle'
     OR SQLERRM<>'boldsign_projection_fields_are_service_only' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  UPDATE public.resident_contract_signers
  SET status='signed',signed_at=now(),provider_recipient_id='forged-recipient'
  WHERE id=(SELECT s1 FROM bs);
  RAISE EXCEPTION 'authenticated changed signer lifecycle';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='authenticated changed signer lifecycle'
     OR SQLERRM<>'boldsign_projection_fields_are_service_only' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  INSERT INTO public.resident_contracts(
    id,organization_id,facility_id,resident_id,contract_type,title,provider,
    provider_document_id,status,sent_at,provider_environment
  ) SELECT gen_random_uuid(),org,facility,resident,'other','Forged projection',
    'boldsign','forged-document','sent',now(),'live' FROM bs;
  RAISE EXCEPTION 'authenticated inserted trusted contract projection fields';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='authenticated inserted trusted contract projection fields'
     OR SQLERRM<>'boldsign_projection_fields_are_service_only' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  INSERT INTO public.resident_contract_signers(
    id,organization_id,facility_id,contract_id,resident_id,signer_role,
    signer_name,signer_email,status,provider_recipient_id,signed_at
  ) SELECT gen_random_uuid(),org,facility,c1,resident,'witness','Forged signer',
    'forged@boldsign.invalid','signed','forged-recipient',now() FROM bs;
  RAISE EXCEPTION 'authenticated inserted trusted signer projection fields';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='authenticated inserted trusted signer projection fields'
     OR SQLERRM<>'boldsign_projection_fields_are_service_only' THEN RAISE; END IF;
END $$;
RESET ROLE;
ALTER TABLE public.resident_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_contract_signers ENABLE ROW LEVEL SECURITY;

CREATE TEMP TABLE results(k text PRIMARY KEY,v jsonb NOT NULL);
GRANT ALL ON results TO service_role;

SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('prepare1',public.prepare_boldsign_contract_send(
  (SELECT c1 FROM bs),(SELECT request1 FROM bs),(SELECT actor FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-a',true,'test'
));
DO $$ DECLARE r jsonb:=(SELECT v FROM results WHERE k='prepare1'); BEGIN
  IF r->>'action'<>'send' OR r->>'state'<>'provider_outcome_unknown'
     OR r->>'recovery_label' !~ '^haven-[0-9a-f]{32}$'
     OR r->'provider_payload'->'labels'->>0<>r->>'recovery_label'
     OR jsonb_array_length(r->'link_signers')<>1
     OR r->'link_signers'->0->>'email'<>'one@boldsign.invalid' THEN
    RAISE EXCEPTION 'prepare snapshot wrong: %',r;
  END IF;
END $$;
-- Actor provenance is retained but does not bind an exact replay/resume.
INSERT INTO results VALUES ('prepare1-replay',public.prepare_boldsign_contract_send(
  (SELECT c1 FROM bs),(SELECT request1 FROM bs),(SELECT actor2 FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-a',true,'test'
));
DO $$ BEGIN
  IF (SELECT v->>'action' FROM results WHERE k='prepare1-replay')<>'reconcile' THEN
    RAISE EXCEPTION 'unknown exact replay did not reconcile'; END IF;
END $$;
INSERT INTO results VALUES ('fail1',public.fail_boldsign_contract_send(
  (SELECT c1 FROM bs),(SELECT request1 FROM bs),(SELECT v->>'request_sha256' FROM results WHERE k='prepare1'),
  1,false,'transport_unknown','{"synthetic":true}'
));
INSERT INTO results VALUES ('commit1',public.commit_boldsign_contract_send(
  (SELECT c1 FROM bs),(SELECT request1 FROM bs),(SELECT v->>'request_sha256' FROM results WHERE k='prepare1'),
  1,'doc-one','{"documentId":"doc-one"}',timestamptz '2026-09-20 12:00Z'
));
INSERT INTO results VALUES ('commit1-replay',public.commit_boldsign_contract_send(
  (SELECT c1 FROM bs),(SELECT request1 FROM bs),(SELECT v->>'request_sha256' FROM results WHERE k='prepare1'),
  1,'doc-one','{"documentId":"doc-one"}',timestamptz '2026-09-20 12:00Z'
));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT v->>'action' FROM results WHERE k='commit1')<>'committed'
     OR (SELECT v->>'action' FROM results WHERE k='commit1-replay')<>'replay'
     OR (SELECT status FROM public.resident_contracts WHERE id=(SELECT c1 FROM bs))<>'sent'
     OR (SELECT count(*) FROM public.resident_contract_send_claims WHERE contract_id=(SELECT c1 FROM bs))<>1 THEN
    RAISE EXCEPTION 'unknown recovery/commit replay failed'; END IF;
END $$;

-- Definitive rejection closes generation 1. A different request receives a
-- fresh immutable generation, payload hash, and random recovery label.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('prepare2a',public.prepare_boldsign_contract_send(
  (SELECT c2 FROM bs),(SELECT request2a FROM bs),(SELECT actor FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-b',false,'test'));
INSERT INTO results VALUES ('fail2a',public.fail_boldsign_contract_send(
  (SELECT c2 FROM bs),(SELECT request2a FROM bs),(SELECT v->>'request_sha256' FROM results WHERE k='prepare2a'),
  1,true,'provider_rejected','{"error":"synthetic"}'));
INSERT INTO results VALUES ('prepare2b',public.prepare_boldsign_contract_send(
  (SELECT c2 FROM bs),(SELECT request2b FROM bs),(SELECT actor2 FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-b',false,'test'));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT v->>'generation' FROM results WHERE k='prepare2b')<>'2'
     OR (SELECT v->>'request_sha256' FROM results WHERE k='prepare2a')=(SELECT v->>'request_sha256' FROM results WHERE k='prepare2b')
     OR (SELECT v->>'recovery_label' FROM results WHERE k='prepare2a')=(SELECT v->>'recovery_label' FROM results WHERE k='prepare2b')
     OR (SELECT count(*) FROM public.resident_contract_send_claims WHERE contract_id=(SELECT c2 FROM bs))<>2 THEN
    RAISE EXCEPTION 'definitive failure did not preserve/new generation'; END IF;
END $$;

-- A failure after ordinary projection begins must roll back contract, signer,
-- event, and attempt together.
CREATE FUNCTION pg_temp.reject_sent_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.event_type='Sent' AND NEW.provider_document_id='doc-two' THEN RAISE EXCEPTION 'synthetic event failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER bs_reject_sent BEFORE INSERT ON public.resident_contract_events
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_sent_event();
DO $$ BEGIN
  PERFORM public.commit_boldsign_contract_send(
    (SELECT c2 FROM bs),(SELECT request2b FROM bs),(SELECT v->>'request_sha256' FROM results WHERE k='prepare2b'),
    2,'doc-two','{}',timestamptz '2026-09-20 12:01Z');
  RAISE EXCEPTION 'fault injection commit succeeded';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='fault injection commit succeeded' THEN RAISE; END IF;
END $$;
DROP TRIGGER bs_reject_sent ON public.resident_contract_events;
DO $$ BEGIN
  IF (SELECT provider_document_id FROM public.resident_contracts WHERE id=(SELECT c2 FROM bs)) IS NOT NULL
     OR (SELECT state FROM public.resident_contract_send_claims WHERE request_id=(SELECT request2b FROM bs))<>'provider_outcome_unknown' THEN
    RAISE EXCEPTION 'partial commit did not roll back'; END IF;
END $$;

-- Snapshot drift after provider success stores reconciliation evidence without
-- projecting ordinary contract/signer state.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('prepare4',public.prepare_boldsign_contract_send(
  (SELECT c4 FROM bs),(SELECT request4 FROM bs),(SELECT actor FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-d',true,'test'));
RESET ROLE;
UPDATE public.resident_contract_signers SET signer_name='Changed after send'
WHERE id=(SELECT s4 FROM bs);
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('commit4',public.commit_boldsign_contract_send(
  (SELECT c4 FROM bs),(SELECT request4 FROM bs),(SELECT v->>'request_sha256' FROM results WHERE k='prepare4'),
  1,'doc-four','{}',timestamptz '2026-09-20 12:02Z'));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT v->>'action' FROM results WHERE k='commit4')<>'reconcile'
     OR (SELECT provider_document_id FROM public.resident_contracts WHERE id=(SELECT c4 FROM bs)) IS NOT NULL
     OR (SELECT state FROM public.resident_contract_send_claims WHERE request_id=(SELECT request4 FROM bs))<>'reconciliation_required' THEN
    RAISE EXCEPTION 'snapshot drift projected ordinary state'; END IF;
END $$;

-- Duplicate normalized signer email is unsafe for provider link lookup even
-- when recipient ids differ, so prepare refuses it unconditionally.
DO $$ BEGIN
  PERFORM public.prepare_boldsign_contract_send((SELECT c5 FROM bs),(SELECT request5 FROM bs),(SELECT actor FROM bs),
    (SELECT org FROM bs),(SELECT facility FROM bs),'template-e',true,'test');
  RAISE EXCEPTION 'ambiguous duplicate signer email accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='ambiguous duplicate signer email accepted' OR SQLERRM<>'ambiguous_duplicate_signer_email' THEN RAISE; END IF;
END $$;
UPDATE public.resident_contract_signers SET provider_recipient_id=CASE id
  WHEN (SELECT s5 FROM bs) THEN 'recipient-a' ELSE 'recipient-b' END
WHERE contract_id=(SELECT c5 FROM bs);
UPDATE public.resident_contract_signers SET signer_email='duplicate-two@boldsign.invalid'
WHERE id=(SELECT s6 FROM bs);
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('prepare5',public.prepare_boldsign_contract_send(
  (SELECT c5 FROM bs),(SELECT request5 FROM bs),(SELECT actor FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-e',true,'test'));
RESET ROLE;

-- An unknown first provider event with a recovery label is recorded against
-- the contract but cannot bind the provider document or commit the claim.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('unknown-first-five',public.apply_boldsign_webhook_event(
  'test','event-reminder-five','ReminderSent','doc-five',timestamptz '2026-09-20 12:02:30Z',
  '{"event":{"id":"event-reminder-five","eventType":"ReminderSent"}}',
  (SELECT v->>'recovery_label' FROM results WHERE k='prepare5'),NULL,NULL,NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT provider_document_id FROM public.resident_contracts WHERE id=(SELECT c5 FROM bs)) IS NOT NULL
     OR (SELECT status FROM public.resident_contracts WHERE id=(SELECT c5 FROM bs))<>'draft'
     OR (SELECT state FROM public.resident_contract_send_claims WHERE request_id=(SELECT request5 FROM bs))<>'provider_outcome_unknown' THEN
    RAISE EXCEPTION 'unknown first recovery event committed provider state'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  PERFORM public.apply_boldsign_webhook_event(
    'test','event-unknown-label','Sent','doc-unknown-label',timestamptz '2026-09-20 12:02:45Z',
    '{"event":{"id":"event-unknown-label","eventType":"Sent"}}',
    'haven-ffffffffffffffffffffffffffffffff',NULL,NULL,NULL,true);
  RAISE EXCEPTION 'unknown recovery label accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='unknown recovery label accepted' OR SQLERRM<>'recovery_label_unknown' THEN RAISE; END IF;
END $$;
RESET ROLE;

-- A document-level Completed recovery must not stamp every signer cursor.
-- An older provider-authored Signed event can still project the exact signer.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('completed-first-five',public.apply_boldsign_webhook_event(
  'test','event-completed-five','Completed','doc-five',timestamptz '2026-09-20 12:05Z',
  '{"event":{"id":"event-completed-five","eventType":"Completed"}}',
  (SELECT v->>'recovery_label' FROM results WHERE k='prepare5'),NULL,NULL,NULL,true));
INSERT INTO results VALUES ('older-signed-five',public.apply_boldsign_webhook_event(
  'test','event-signed-five','Signed','doc-five',timestamptz '2026-09-20 12:04Z',
  '{"event":{"id":"event-signed-five","eventType":"Signed"}}',
  NULL,'recipient-a','duplicate@boldsign.invalid',NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.resident_contracts WHERE id=(SELECT c5 FROM bs))<>'completed'
     OR (SELECT status FROM public.resident_contract_signers WHERE id=(SELECT s5 FROM bs))<>'signed'
     OR (SELECT status FROM public.resident_contract_signers WHERE id=(SELECT s6 FROM bs))<>'sent' THEN
    RAISE EXCEPTION 'completed-first recovery suppressed older exact signer event'; END IF;
END $$;

-- Recovery-label binding handles a webhook that beats the send response.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('prepare3',public.prepare_boldsign_contract_send(
  (SELECT c3 FROM bs),(SELECT request3 FROM bs),(SELECT actor FROM bs),
  (SELECT org FROM bs),(SELECT facility FROM bs),'template-c',true,'test'));
INSERT INTO results VALUES ('webhook-sent',public.apply_boldsign_webhook_event(
  'test','event-sent-3','Sent','doc-three',timestamptz '2026-09-20 12:03Z',
  '{"event":{"id":"event-sent-3","eventType":"Sent"}}',
  (SELECT v->>'recovery_label' FROM results WHERE k='prepare3'),NULL,'three@boldsign.invalid',NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT provider_document_id FROM public.resident_contracts WHERE id=(SELECT c3 FROM bs))<>'doc-three'
     OR (SELECT state FROM public.resident_contract_send_claims WHERE request_id=(SELECT request3 FROM bs))<>'committed' THEN
    RAISE EXCEPTION 'recovery label did not bind early webhook'; END IF;
END $$;

-- Canonical JSON duplicate is a no-op; same environment/event identity with
-- different canonical content is refused. A different environment is distinct.
-- A pre-migration BoldSign contract with no stored environment binds once from
-- the first verified event; later wrong-environment events remain history-only.
UPDATE public.resident_contracts SET provider_environment=NULL
WHERE id=(SELECT c1 FROM bs);
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('viewed',public.apply_boldsign_webhook_event(
  'test','event-viewed-1','Viewed','doc-one',timestamptz '2026-09-20 12:04Z',
  '{"event":{"id":"event-viewed-1","eventType":"Viewed"}}',NULL,'recipient-one','one@boldsign.invalid',NULL,true));
INSERT INTO results VALUES ('viewed-duplicate',public.apply_boldsign_webhook_event(
  'test','event-viewed-1','Viewed','doc-one',timestamptz '2026-09-20 12:04Z',
  '{"eventType":"Viewed","event":{"eventType":"Viewed","id":"event-viewed-1"}}'::jsonb - 'eventType',NULL,'recipient-one','one@boldsign.invalid',NULL,true));
DO $$ BEGIN
  PERFORM public.apply_boldsign_webhook_event('test','event-viewed-1','Viewed','doc-one',
    timestamptz '2026-09-20 12:04Z','{"event":{"id":"event-viewed-1","eventType":"Changed"}}',
    NULL,'recipient-one','one@boldsign.invalid',NULL,true);
  RAISE EXCEPTION 'conflicting duplicate accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='conflicting duplicate accepted' OR SQLERRM<>'provider_event_content_conflict' THEN RAISE; END IF;
END $$;
INSERT INTO results VALUES ('other-env',public.apply_boldsign_webhook_event(
  'sandbox','event-viewed-1','Completed','doc-one',timestamptz '2026-09-20 12:05Z',
  '{"event":{"id":"event-viewed-1","eventType":"Completed"}}',NULL,NULL,NULL,NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT v->>'action' FROM results WHERE k='viewed-duplicate')<>'duplicate'
     OR (SELECT v->>'matched_contract' FROM results WHERE k='other-env')<>'false'
     OR (SELECT status FROM public.resident_contracts WHERE id=(SELECT c1 FROM bs))<>'viewed'
     OR (SELECT provider_environment FROM public.resident_contracts WHERE id=(SELECT c1 FROM bs))<>'test'
     OR (SELECT count(*) FROM public.resident_contract_events WHERE provider_event_id='event-viewed-1')<>2 THEN
    RAISE EXCEPTION 'event environment/deduplication wrong'; END IF;
END $$;

-- Later terminal state wins; older/equal-lower events remain immutable history
-- without regressing the contract or signer projection.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('signed',public.apply_boldsign_webhook_event(
  'test','event-signed-1','Signed','doc-one',timestamptz '2026-09-20 12:05Z',
  '{"event":{"id":"event-signed-1","eventType":"Signed"}}',NULL,'recipient-one','one@boldsign.invalid',NULL,true));
INSERT INTO results VALUES ('completed',public.apply_boldsign_webhook_event(
  'test','event-completed-1','Completed','doc-one',timestamptz '2026-09-20 12:06Z',
  '{"event":{"id":"event-completed-1","eventType":"Completed"}}',NULL,NULL,NULL,NULL,true));
INSERT INTO results VALUES ('late-viewed',public.apply_boldsign_webhook_event(
  'test','event-late-viewed-1','Viewed','doc-one',timestamptz '2026-09-20 12:04:30Z',
  '{"event":{"id":"event-late-viewed-1","eventType":"Viewed"}}',NULL,'recipient-one','one@boldsign.invalid',NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.resident_contracts WHERE id=(SELECT c1 FROM bs))<>'completed'
     OR (SELECT status FROM public.resident_contract_signers WHERE id=(SELECT s1 FROM bs))<>'signed' THEN
    RAISE EXCEPTION 'out-of-order event regressed projection'; END IF;
END $$;

-- Same-time competing terminal events are history-only after the first terminal.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('declined-three',public.apply_boldsign_webhook_event(
  'test','event-declined-three','Declined','doc-three',timestamptz '2026-09-20 12:07Z',
  '{"event":{"id":"event-declined-three","eventType":"Declined"}}',NULL,NULL,NULL,NULL,true));
INSERT INTO results VALUES ('completed-three-same-time',public.apply_boldsign_webhook_event(
  'test','event-completed-three','Completed','doc-three',timestamptz '2026-09-20 12:07Z',
  '{"event":{"id":"event-completed-three","eventType":"Completed"}}',NULL,NULL,NULL,NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.resident_contracts WHERE id=(SELECT c3 FROM bs))<>'declined' THEN
    RAISE EXCEPTION 'same-time terminal conflict changed the first terminal state'; END IF;
END $$;

-- Unknown and failure events remain durable history but never regress a known
-- sent/terminal projection.
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('unknown-three',public.apply_boldsign_webhook_event(
  'test','event-reminder-three','ReminderSent','doc-three',timestamptz '2026-09-20 12:08Z',
  '{"event":{"id":"event-reminder-three","eventType":"ReminderSent"}}',NULL,NULL,NULL,NULL,true));
INSERT INTO results VALUES ('failed-one',public.apply_boldsign_webhook_event(
  'test','event-send-failed-one','SendFailed','doc-one',timestamptz '2026-09-20 12:09Z',
  '{"event":{"id":"event-send-failed-one","eventType":"SendFailed"}}',NULL,NULL,NULL,NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.resident_contracts WHERE id=(SELECT c3 FROM bs))<>'declined'
     OR (SELECT status FROM public.resident_contracts WHERE id=(SELECT c1 FROM bs))<>'completed'
     OR NOT EXISTS(SELECT 1 FROM public.resident_contract_events WHERE provider_event_id='event-reminder-three')
     OR NOT EXISTS(SELECT 1 FROM public.resident_contract_events WHERE provider_event_id='event-send-failed-one') THEN
    RAISE EXCEPTION 'unknown/failure event changed projection or vanished'; END IF;
END $$;

-- An ambiguous normalized-email fallback records the event without updating
-- either signer. Prepare already refuses sending this shape.
UPDATE public.resident_contract_signers SET signer_email='duplicate@boldsign.invalid'
WHERE id=(SELECT s6 FROM bs);
UPDATE public.resident_contracts
SET provider_document_id='doc-ambiguous',provider_environment='test',status='sent'
WHERE id=(SELECT c5 FROM bs);
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('ambiguous-signer',public.apply_boldsign_webhook_event(
  'test','event-ambiguous-signer','Signed','doc-ambiguous',timestamptz '2026-09-20 12:10Z',
  '{"event":{"id":"event-ambiguous-signer","eventType":"Signed"}}',NULL,NULL,
  'duplicate@boldsign.invalid',NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.resident_contract_signers WHERE id=(SELECT s5 FROM bs))<>'signed'
     OR (SELECT status FROM public.resident_contract_signers WHERE id=(SELECT s6 FROM bs))<>'sent' THEN
    RAISE EXCEPTION 'ambiguous signer email changed existing signer projections'; END IF;
END $$;

-- A legacy advanced state with no provider-time cursor cannot regress merely
-- because its first post-migration event is lower progress.
UPDATE public.resident_contracts
SET status='completed',completed_at=clock_timestamp(),provider_status_created_at=NULL,
  provider_document_id='doc-two',provider_environment='test'
WHERE id=(SELECT c2 FROM bs);
SET LOCAL ROLE service_role;
INSERT INTO results VALUES ('legacy-lower-progress',public.apply_boldsign_webhook_event(
  'test','event-legacy-viewed','Viewed','doc-two',timestamptz '2026-09-20 11:59Z',
  '{"event":{"id":"event-legacy-viewed","eventType":"Viewed"}}',NULL,NULL,NULL,NULL,true));
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM public.resident_contracts WHERE id=(SELECT c2 FROM bs))<>'completed' THEN
    RAISE EXCEPTION 'legacy advanced state regressed without a provider cursor'; END IF;
END $$;

-- Event history is append-only even to a role that bypasses RLS.
SET LOCAL ROLE service_role;
DO $$ BEGIN
  UPDATE public.resident_contract_events SET event_status='draft'
  WHERE provider_event_id='event-completed-1';
  RAISE EXCEPTION 'service role updated event history';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='service role updated event history'
     OR SQLERRM NOT IN ('resident_contract_events_are_immutable','permission denied for table resident_contract_events') THEN
    RAISE;
  END IF;
END $$;
RESET ROLE;

ROLLBACK;
