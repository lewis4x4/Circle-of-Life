-- Created with supabase migration new; repository claim 520. COL-771 (Medicaid Amendment A, build 6).
-- Purpose-specific inboxes (AgentMail). Each inbox collects only the mail for its purpose and facility;
-- this migration adds the shared inbound-mail layer and the first purpose, 'medicaid_agency'.
-- 1. inbound_mail_inboxes: provider inbox -> organization, facility, purpose (owner-managed).
-- 2. inbound_mail_messages / inbound_mail_attachments: verified webhook deliveries, recorded by the service
--    webhook only (no staff write path). Attachment bytes live in the private 'inbound-mail' bucket.
-- 3. benefits_mail_items: for medicaid_agency mail, a proposal (matched case, agency, letter date, response
--    deadline) that a person confirms or dismisses. Nothing is recorded on a case until confirmed.
BEGIN;

CREATE TABLE public.inbound_mail_inboxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid REFERENCES public.facilities(id), purpose text NOT NULL CHECK(purpose IN ('medicaid_agency')),
 provider text NOT NULL DEFAULT 'agentmail' CHECK(provider IN ('agentmail')), provider_inbox_id text NOT NULL UNIQUE CHECK(length(provider_inbox_id) BETWEEN 1 AND 300),
 email text NOT NULL CHECK(length(email) BETWEEN 3 AND 320), active boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES public.user_profiles(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_inbound_mail_inboxes_purpose_facility ON public.inbound_mail_inboxes(organization_id,purpose,facility_id) WHERE active;
CREATE TABLE public.inbound_mail_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid REFERENCES public.facilities(id), inbox_id uuid NOT NULL REFERENCES public.inbound_mail_inboxes(id),
 provider_message_id text NOT NULL, provider_event_id text, from_address text CHECK(length(from_address)<=320),
 to_addresses text[] NOT NULL DEFAULT '{}', subject text CHECK(length(subject)<=1000), body_text text CHECK(length(body_text)<=200000),
 received_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(inbox_id,provider_message_id)
);
CREATE INDEX idx_inbound_mail_messages_facility ON public.inbound_mail_messages(organization_id,facility_id,received_at DESC);
CREATE TABLE public.inbound_mail_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL REFERENCES public.inbound_mail_messages(id),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255), content_type text NOT NULL CHECK(length(content_type)<=200),
 size_bytes bigint NOT NULL CHECK(size_bytes>=0), sha256 text CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text UNIQUE, status text NOT NULL CHECK(status IN ('stored','skipped_type','skipped_size','failed')),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inbound_mail_attachments_message ON public.inbound_mail_attachments(message_id);
CREATE TABLE public.benefits_mail_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid REFERENCES public.facilities(id), message_id uuid NOT NULL UNIQUE REFERENCES public.inbound_mail_messages(id),
 status text NOT NULL DEFAULT 'unmatched' CHECK(status IN ('unmatched','proposed','confirmed','dismissed')),
 proposed_case_id uuid REFERENCES public.benefits_cases(id), match_basis text CHECK(match_basis IN ('case_address','resident_name')),
 proposed_agency text CHECK(proposed_agency IN ('elder_options','cares','dcf','plan','other')),
 proposed_letter_date date, proposed_due_on date,
 case_id uuid REFERENCES public.benefits_cases(id), event_id uuid REFERENCES public.benefits_events(id),
 resolved_by uuid REFERENCES public.user_profiles(id), resolved_at timestamptz, dismiss_reason text CHECK(length(dismiss_reason)<=2000),
 request_id uuid UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('confirmed','dismissed') OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
 CHECK(status<>'confirmed' OR (case_id IS NOT NULL AND event_id IS NOT NULL)),
 CHECK(status<>'dismissed' OR length(btrim(coalesce(dismiss_reason,'')))>0)
);
CREATE INDEX idx_benefits_mail_items_facility_status ON public.benefits_mail_items(organization_id,facility_id,status);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['inbound_mail_inboxes','inbound_mail_messages','inbound_mail_attachments','benefits_mail_items'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE TRIGGER tr_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log()',t,t);
 END LOOP;
END $$;
-- Received mail is the record: no updates or deletes to messages or attachments.
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.inbound_mail_messages FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.inbound_mail_attachments FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('inbound-mail','inbound-mail',false,15728640,ARRAY['application/pdf','image/jpeg','image/png']) ON CONFLICT (id) DO NOTHING;
CREATE POLICY inbound_mail_no_direct_objects ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'inbound-mail') WITH CHECK(bucket_id<>'inbound-mail');

-- Deterministic extraction from the letter text. A proposal only; a person confirms.
CREATE OR REPLACE FUNCTION haven.inbound_mail_parse_date(p_text text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m text[]; mon integer; BEGIN
 IF p_text IS NULL THEN RETURN NULL; END IF;
 m:=regexp_match(p_text,'(\d{1,2})/(\d{1,2})/(\d{4})');
 IF m IS NOT NULL THEN BEGIN RETURN make_date(m[3]::int,m[1]::int,m[2]::int); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
 m:=regexp_match(p_text,'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})','i');
 IF m IS NOT NULL THEN
  mon:=array_position(ARRAY['january','february','march','april','may','june','july','august','september','october','november','december'],lower(m[1]));
  BEGIN RETURN make_date(m[3]::int,mon,m[2]::int); EXCEPTION WHEN OTHERS THEN NULL; END;
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION haven.inbound_mail_extract(p_subject text,p_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE body text:=coalesce(p_subject,'')||E'\n'||left(coalesce(p_text,''),50000); due_clause text; letter_clause text; agency text; BEGIN
 agency:=CASE
  WHEN body ~* '(department of children and families|\mDCF\M|ACCESS Florida)' THEN 'dcf'
  WHEN body ~* '\mCARES\M|comprehensive assessment and review' THEN 'cares'
  WHEN body ~* 'elder options|aging and disability resource' THEN 'elder_options'
  WHEN body ~* '(united ?healthcare|\mUHC\M|sunshine health|humana|wellcare|simply healthcare|molina)' THEN 'plan'
  ELSE NULL END;
 due_clause:=substring(body FROM '(?i)(?:respond|return|submit|provide|due|deadline|no later than|must be received)[^.\n]{0,80}?(?:\d{1,2}/\d{1,2}/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})');
 letter_clause:=substring(body FROM '(?i)(?:date(?: of (?:notice|letter))?|notice date|mailed)\s*:?\s*(?:\d{1,2}/\d{1,2}/\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})');
 RETURN jsonb_build_object('agency',agency,'due_on',haven.inbound_mail_parse_date(due_clause),'letter_date',coalesce(haven.inbound_mail_parse_date(letter_clause),haven.inbound_mail_parse_date(body)));
END $$;

-- Service webhook entry point: records a verified delivery once and builds the proposal. Never callable by staff.
CREATE OR REPLACE FUNCTION haven.inbound_mail_record_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ib public.inbound_mail_inboxes; m public.inbound_mail_messages; att jsonb; ex jsonb; case_row public.benefits_cases; cand integer; plus_ref text; BEGIN
 SELECT * INTO ib FROM public.inbound_mail_inboxes WHERE provider_inbox_id=p_payload->>'provider_inbox_id' AND active;
 IF ib.id IS NULL THEN RETURN jsonb_build_object('recorded',false,'reason','unknown_inbox'); END IF;
 SELECT * INTO m FROM public.inbound_mail_messages WHERE inbox_id=ib.id AND provider_message_id=p_payload->>'provider_message_id';
 IF FOUND THEN RETURN jsonb_build_object('recorded',false,'reason','duplicate','message_id',m.id); END IF;
 INSERT INTO public.inbound_mail_messages(organization_id,facility_id,inbox_id,provider_message_id,provider_event_id,from_address,to_addresses,subject,body_text,received_at)
 VALUES(ib.organization_id,ib.facility_id,ib.id,p_payload->>'provider_message_id',p_payload->>'provider_event_id',left(p_payload->>'from',320),
  coalesce((SELECT array_agg(left(x,320)) FROM jsonb_array_elements_text(coalesce(p_payload->'to','[]')) x),'{}'),left(p_payload->>'subject',1000),left(p_payload->>'text',200000),
  coalesce((p_payload->>'received_at')::timestamptz,now())) RETURNING * INTO m;
 FOR att IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'attachments','[]')) LOOP
  INSERT INTO public.inbound_mail_attachments(message_id,filename,content_type,size_bytes,sha256,storage_path,status)
  VALUES(m.id,left(coalesce(nullif(att->>'filename',''),'attachment'),255),left(coalesce(att->>'content_type','application/octet-stream'),200),coalesce((att->>'size_bytes')::bigint,0),
   att->>'sha256',att->>'storage_path',coalesce(att->>'status','failed'));
 END LOOP;
 IF ib.purpose='medicaid_agency' THEN
  ex:=haven.inbound_mail_extract(m.subject,m.body_text);
  -- Per-case address: <inbox>+<first 8 of case id>@domain.
  plus_ref:=(SELECT lower(substring(x FROM '\+([0-9a-f]{8})@')) FROM unnest(m.to_addresses) x WHERE x ~ '\+[0-9a-fA-F]{8}@' LIMIT 1);
  IF plus_ref IS NOT NULL THEN
   SELECT * INTO case_row FROM public.benefits_cases c WHERE c.organization_id=ib.organization_id AND (ib.facility_id IS NULL OR c.facility_id=ib.facility_id) AND c.status<>'closed' AND left(c.id::text,8)=plus_ref;
  END IF;
  IF case_row.id IS NULL THEN
   SELECT count(*) INTO cand FROM public.benefits_cases c JOIN public.residents r ON r.id=c.resident_id
   WHERE c.organization_id=ib.organization_id AND (ib.facility_id IS NULL OR c.facility_id=ib.facility_id) AND c.status<>'closed'
    AND coalesce(m.subject,'')||' '||coalesce(m.body_text,'') ~* ('\m'||regexp_replace(r.first_name,'([^A-Za-z0-9 ])','\\\1','g')||'\s+'||regexp_replace(r.last_name,'([^A-Za-z0-9 ])','\\\1','g')||'\M');
   IF cand=1 THEN
    SELECT c.* INTO case_row FROM public.benefits_cases c JOIN public.residents r ON r.id=c.resident_id
    WHERE c.organization_id=ib.organization_id AND (ib.facility_id IS NULL OR c.facility_id=ib.facility_id) AND c.status<>'closed'
     AND coalesce(m.subject,'')||' '||coalesce(m.body_text,'') ~* ('\m'||regexp_replace(r.first_name,'([^A-Za-z0-9 ])','\\\1','g')||'\s+'||regexp_replace(r.last_name,'([^A-Za-z0-9 ])','\\\1','g')||'\M');
   END IF;
  END IF;
  INSERT INTO public.benefits_mail_items(organization_id,facility_id,message_id,status,proposed_case_id,match_basis,proposed_agency,proposed_letter_date,proposed_due_on)
  VALUES(ib.organization_id,coalesce(ib.facility_id,case_row.facility_id),m.id,CASE WHEN case_row.id IS NULL THEN 'unmatched' ELSE 'proposed' END,case_row.id,
   CASE WHEN case_row.id IS NULL THEN NULL WHEN plus_ref IS NOT NULL THEN 'case_address' ELSE 'resident_name' END,ex->>'agency',(ex->>'letter_date')::date,(ex->>'due_on')::date);
 END IF;
 RETURN jsonb_build_object('recorded',true,'message_id',m.id,'matched',case_row.id IS NOT NULL);
END $$;

-- Staff: open mail items for a facility (unresolved first), with attachment metadata.
CREATE OR REPLACE FUNCTION haven.benefits_mail_list_internal(p_facility_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF p_facility_id IS NULL OR NOT haven.benefits_permission(p_facility_id,'read') THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_write',haven.benefits_permission(p_facility_id,'write'),
  'inboxes',coalesce((SELECT jsonb_agg(jsonb_build_object('email',i.email,'purpose',i.purpose)) FROM public.inbound_mail_inboxes i WHERE i.organization_id=(a->>'org')::uuid AND i.facility_id=p_facility_id AND i.active),'[]'),
  'items',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.received_at DESC) FROM (
   SELECT b.id,b.status,b.match_basis,b.proposed_case_id,pr.first_name||' '||pr.last_name proposed_resident_name,b.proposed_agency,b.proposed_letter_date,b.proposed_due_on,
    m.from_address,m.subject,left(m.body_text,600) preview,m.received_at,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'filename',t.filename,'content_type',t.content_type,'size_bytes',t.size_bytes,'status',t.status) ORDER BY t.recorded_at) FROM public.inbound_mail_attachments t WHERE t.message_id=m.id),'[]') attachments
   FROM public.benefits_mail_items b JOIN public.inbound_mail_messages m ON m.id=b.message_id
   LEFT JOIN public.benefits_cases pc ON pc.id=b.proposed_case_id LEFT JOIN public.residents pr ON pr.id=pc.resident_id
   WHERE b.organization_id=(a->>'org')::uuid AND b.facility_id=p_facility_id AND b.status IN ('unmatched','proposed')
   ORDER BY m.received_at DESC LIMIT 100) q),'[]'));
END $$;

-- Confirm: records the agency event on the chosen case (source: forwarded mail) and sets the response deadline.
CREATE OR REPLACE FUNCTION haven.benefits_mail_confirm_internal(p_item_id uuid,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); b public.benefits_mail_items; m public.inbound_mail_messages; c public.benefits_cases; ev_id uuid; today date:=(now() AT TIME ZONE 'America/New_York')::date; letter date; due date; BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Missing request identity' USING ERRCODE='22023'; END IF;
 PERFORM haven.benefits_keys(p_payload,ARRAY['case_id','agency','event_type','outcome','letter_date','due_on','notes']);
 SELECT * INTO b FROM public.benefits_mail_items WHERE request_id=p_request_id;
 IF FOUND THEN
  IF b.resolved_by<>(a->>'id')::uuid OR b.id<>p_item_id THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('item_id',b.id,'case_id',b.case_id,'event_id',b.event_id);
 END IF;
 SELECT * INTO b FROM public.benefits_mail_items WHERE id=p_item_id FOR UPDATE;
 IF b.id IS NULL OR b.organization_id IS DISTINCT FROM (a->>'org')::uuid OR b.facility_id IS NULL OR NOT haven.benefits_permission(b.facility_id,'write') THEN RAISE EXCEPTION 'Mail unavailable' USING ERRCODE='42501'; END IF;
 IF b.status NOT IN ('unmatched','proposed') THEN RAISE EXCEPTION 'This mail is already resolved' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.benefits_cases WHERE id=(p_payload->>'case_id')::uuid FOR UPDATE;
 IF c.id IS NULL OR c.facility_id<>b.facility_id OR c.status='closed' THEN RAISE EXCEPTION 'Choose an open case at this facility' USING ERRCODE='22023'; END IF;
 PERFORM haven.benefits_assert_case(c.id,'write');
 IF coalesce(p_payload->>'agency','') NOT IN ('elder_options','cares','dcf','plan','other') OR coalesce(p_payload->>'event_type','') NOT IN ('screening','waitlist','assessment','application','eligibility','enrollment','authorization','correspondence','denial','appeal','renewal','notice_review','note')
  OR length(coalesce(btrim(p_payload->>'outcome'),'')) NOT BETWEEN 1 AND 200 OR length(coalesce(p_payload->>'notes',''))>4000 THEN RAISE EXCEPTION 'Choose the agency, the kind of letter and a short outcome' USING ERRCODE='22023'; END IF;
 letter:=(p_payload->>'letter_date')::date; due:=(p_payload->>'due_on')::date;
 IF letter IS NULL OR letter>today THEN RAISE EXCEPTION 'Record the date printed on the letter' USING ERRCODE='22023'; END IF;
 SELECT * INTO m FROM public.inbound_mail_messages WHERE id=b.message_id;
 INSERT INTO public.benefits_events(case_id,payload,created_by) VALUES(c.id,jsonb_build_object('agency',p_payload->>'agency','event_type',p_payload->>'event_type','outcome',btrim(p_payload->>'outcome'),
  'occurred_on',letter,'due_date',due,'formal_decision',false,'mail_item_id',b.id,
  'source_reference','Forwarded mail received '||to_char(m.received_at AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI')||' ET from '||coalesce(m.from_address,'unknown sender'))
  ||CASE WHEN nullif(btrim(p_payload->>'notes'),'') IS NOT NULL THEN jsonb_build_object('notes',btrim(p_payload->>'notes')) ELSE '{}'::jsonb END,(a->>'id')::uuid) RETURNING id INTO ev_id;
 UPDATE public.benefits_cases SET due_date=CASE WHEN due IS NOT NULL AND (due_date IS NULL OR due<due_date) THEN due ELSE due_date END,
  next_action=CASE WHEN due IS NOT NULL THEN 'Respond to the '||upper(p_payload->>'agency')||' letter by '||to_char(due,'YYYY-MM-DD')||'.' ELSE next_action END,
  revision=revision+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
 INSERT INTO public.benefits_history(case_id,action,payload,revision,created_by) VALUES(c.id,'mail_confirm',jsonb_build_object('mail_item_id',b.id,'event_id',ev_id,'due_on',due),c.revision,(a->>'id')::uuid);
 UPDATE public.benefits_mail_items SET status='confirmed',case_id=c.id,event_id=ev_id,resolved_by=(a->>'id')::uuid,resolved_at=now(),request_id=p_request_id,updated_at=now() WHERE id=b.id;
 RETURN jsonb_build_object('item_id',b.id,'case_id',c.id,'event_id',ev_id);
END $$;

CREATE OR REPLACE FUNCTION haven.benefits_mail_dismiss_internal(p_item_id uuid,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); b public.benefits_mail_items; BEGIN
 IF p_request_id IS NULL OR length(coalesce(btrim(p_reason),'')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Dismissing needs a reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO b FROM public.benefits_mail_items WHERE request_id=p_request_id;
 IF FOUND THEN
  IF b.resolved_by<>(a->>'id')::uuid OR b.id<>p_item_id THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('item_id',b.id,'status',b.status);
 END IF;
 SELECT * INTO b FROM public.benefits_mail_items WHERE id=p_item_id FOR UPDATE;
 IF b.id IS NULL OR b.organization_id IS DISTINCT FROM (a->>'org')::uuid OR b.facility_id IS NULL OR NOT haven.benefits_permission(b.facility_id,'write') THEN RAISE EXCEPTION 'Mail unavailable' USING ERRCODE='42501'; END IF;
 IF b.status NOT IN ('unmatched','proposed') THEN RAISE EXCEPTION 'This mail is already resolved' USING ERRCODE='22023'; END IF;
 UPDATE public.benefits_mail_items SET status='dismissed',dismiss_reason=btrim(p_reason),resolved_by=(a->>'id')::uuid,resolved_at=now(),request_id=p_request_id,updated_at=now() WHERE id=b.id;
 RETURN jsonb_build_object('item_id',b.id,'status','dismissed');
END $$;

-- Staff attachment download target: checked against the item's facility; the route streams bytes with the service key.
CREATE OR REPLACE FUNCTION haven.benefits_mail_attachment_target_internal(p_attachment_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); t public.inbound_mail_attachments; b public.benefits_mail_items; BEGIN
 SELECT * INTO t FROM public.inbound_mail_attachments WHERE id=p_attachment_id;
 SELECT * INTO b FROM public.benefits_mail_items WHERE message_id=t.message_id;
 IF t.id IS NULL OR b.id IS NULL OR b.organization_id IS DISTINCT FROM (a->>'org')::uuid OR b.facility_id IS NULL OR NOT haven.benefits_permission(b.facility_id,'read') OR t.status<>'stored' THEN RAISE EXCEPTION 'Attachment unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',t.id,'filename',t.filename,'content_type',t.content_type,'size_bytes',t.size_bytes,'sha256',t.sha256,'storage_path',t.storage_path,'organization_id',b.organization_id);
END $$;

-- Owner: register the provider inbox that serves a facility's purpose (the setup script calls this after creating it).
CREATE OR REPLACE FUNCTION haven.inbound_mail_inbox_register_internal(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); ib public.inbound_mail_inboxes; BEGIN
 IF NOT (a->>'admin')::boolean THEN RAISE EXCEPTION 'An owner or organization administrator registers inboxes' USING ERRCODE='42501'; END IF;
 PERFORM haven.benefits_keys(p_payload,ARRAY['facility_id','purpose','provider_inbox_id','email']);
 IF coalesce(p_payload->>'purpose','') NOT IN ('medicaid_agency') OR length(coalesce(p_payload->>'provider_inbox_id',''))=0 OR coalesce(p_payload->>'email','') !~ '^[^@\s]+@[^@\s]+$' THEN RAISE EXCEPTION 'Inbox needs a purpose, provider id and address' USING ERRCODE='22023'; END IF;
 IF p_payload->>'facility_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=(p_payload->>'facility_id')::uuid AND f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.inbound_mail_inboxes(organization_id,facility_id,purpose,provider_inbox_id,email,created_by)
 VALUES((a->>'org')::uuid,(p_payload->>'facility_id')::uuid,p_payload->>'purpose',p_payload->>'provider_inbox_id',lower(p_payload->>'email'),(a->>'id')::uuid)
 ON CONFLICT (provider_inbox_id) DO UPDATE SET email=excluded.email,updated_at=now() RETURNING * INTO ib;
 RETURN to_jsonb(ib);
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('inbound_mail_parse_date','inbound_mail_extract','inbound_mail_record_internal','benefits_mail_list_internal','benefits_mail_confirm_internal','benefits_mail_dismiss_internal','benefits_mail_attachment_target_internal','inbound_mail_inbox_register_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
-- The webhook (service key) is the only writer of received mail.
CREATE FUNCTION public.inbound_mail_record(p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.inbound_mail_record_internal(p_payload); $$;
REVOKE ALL ON FUNCTION public.inbound_mail_record(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inbound_mail_record(jsonb),haven.inbound_mail_record_internal(jsonb) TO service_role;
CREATE FUNCTION public.benefits_mail_list(p_facility_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_mail_list_internal(p_facility_id); $$;
CREATE FUNCTION public.benefits_mail_confirm(p_item_id uuid,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_mail_confirm_internal(p_item_id,p_payload,p_request_id); $$;
CREATE FUNCTION public.benefits_mail_dismiss(p_item_id uuid,p_reason text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_mail_dismiss_internal(p_item_id,p_reason,p_request_id); $$;
CREATE FUNCTION public.benefits_mail_attachment_target(p_attachment_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_mail_attachment_target_internal(p_attachment_id); $$;
CREATE FUNCTION public.inbound_mail_inbox_register(p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.inbound_mail_inbox_register_internal(p_payload); $$;
REVOKE ALL ON FUNCTION public.benefits_mail_list(uuid),public.benefits_mail_confirm(uuid,jsonb,uuid),public.benefits_mail_dismiss(uuid,text,uuid),public.benefits_mail_attachment_target(uuid),public.inbound_mail_inbox_register(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_mail_list(uuid),haven.benefits_mail_list_internal(uuid),
 public.benefits_mail_confirm(uuid,jsonb,uuid),haven.benefits_mail_confirm_internal(uuid,jsonb,uuid),
 public.benefits_mail_dismiss(uuid,text,uuid),haven.benefits_mail_dismiss_internal(uuid,text,uuid),
 public.benefits_mail_attachment_target(uuid),haven.benefits_mail_attachment_target_internal(uuid),
 public.inbound_mail_inbox_register(jsonb),haven.inbound_mail_inbox_register_internal(jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
