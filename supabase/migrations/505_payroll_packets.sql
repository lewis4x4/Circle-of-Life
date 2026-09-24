-- COL-357: facility payroll packets shared by phone and RUN entry.
-- Legacy exports remain intact. Only server-authenticated service RPCs write;
-- approval freezes the exact original document and its timecard source revision.
BEGIN;
CREATE TABLE public.payroll_packet_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL UNIQUE REFERENCES public.facilities(id),
 config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config)='object' AND octet_length(config::text)<=20000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 confirmed_at timestamptz, confirmed_by uuid REFERENCES public.user_profiles(id),
 updated_by uuid NOT NULL REFERENCES public.user_profiles(id), updated_by_name text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((confirmed_at IS NULL)=(confirmed_by IS NULL))
);
CREATE TABLE haven.payroll_packet_source_revisions (
 organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE TABLE public.payroll_packets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), root_id uuid NOT NULL REFERENCES public.payroll_packets(id),
 amends_packet_id uuid REFERENCES public.payroll_packets(id),
 version integer NOT NULL CHECK(version>0), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 period_start date NOT NULL, period_end date NOT NULL, check_date date NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','reported','reconciled')),
 inputs jsonb NOT NULL, snapshot jsonb NOT NULL, source_revision text NOT NULL, policy_revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES public.user_profiles(id), created_by_name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz, approved_by uuid REFERENCES public.user_profiles(id), approved_by_name text, document_hash text,
 approved_pdf_base64 text, approved_html text, approved_csv text,
 reported_at timestamptz, reported_by uuid REFERENCES public.user_profiles(id), reported_by_name text, report_method text CHECK(report_method IN ('phone','run')), report_reference text,
 reconciled_at timestamptz, reconciled_by uuid REFERENCES public.user_profiles(id), reconciled_by_name text, reconciliation_note text, amendment_reason text,
 UNIQUE(root_id,version), CHECK(period_end>=period_start AND period_end-period_start<31),
 CHECK((amends_packet_id IS NULL AND id=root_id AND version=1 AND amendment_reason IS NULL) OR (amends_packet_id IS NOT NULL AND version>1 AND length(trim(amendment_reason)) BETWEEN 1 AND 2000)),
 CHECK((status='draft' AND approved_at IS NULL AND approved_by IS NULL AND approved_pdf_base64 IS NULL AND approved_html IS NULL AND approved_csv IS NULL AND document_hash IS NULL) OR
       (status<>'draft' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND approved_pdf_base64 IS NOT NULL AND approved_html IS NOT NULL AND approved_csv IS NOT NULL AND document_hash IS NOT NULL)),
 CHECK((status IN ('draft','approved') AND reported_at IS NULL AND reported_by IS NULL AND reported_by_name IS NULL AND report_method IS NULL AND report_reference IS NULL) OR
       (status IN ('reported','reconciled') AND reported_at IS NOT NULL AND reported_by IS NOT NULL AND reported_by_name IS NOT NULL AND report_method IS NOT NULL AND length(trim(report_reference))>0)),
 CHECK((status<>'reconciled' AND reconciled_at IS NULL AND reconciled_by IS NULL AND reconciled_by_name IS NULL AND reconciliation_note IS NULL) OR
       (status='reconciled' AND reconciled_at IS NOT NULL AND reconciled_by IS NOT NULL AND reconciled_by_name IS NOT NULL AND length(trim(reconciliation_note))>0))
);
CREATE UNIQUE INDEX idx_payroll_packets_root_period ON public.payroll_packets(facility_id,period_start,period_end) WHERE amends_packet_id IS NULL;
CREATE UNIQUE INDEX idx_payroll_packets_one_draft ON public.payroll_packets(root_id) WHERE status='draft';
CREATE INDEX idx_payroll_packets_facility_period ON public.payroll_packets(organization_id,facility_id,period_start DESC);
CREATE TABLE public.payroll_packet_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), packet_id uuid NOT NULL REFERENCES public.payroll_packets(id),
 organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 action text NOT NULL CHECK(action IN ('create','edit','amend','approve','report','reconcile','difference')),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id), actor_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_payroll_packet_events_packet ON public.payroll_packet_events(packet_id,created_at);
ALTER TABLE public.payroll_packet_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_packet_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.payroll_packet_source_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payroll_packet_policies, public.payroll_packets, public.payroll_packet_events, haven.payroll_packet_source_revisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.payroll_packet_policies, public.payroll_packets, public.payroll_packet_events TO authenticated,service_role;
CREATE POLICY "Managers read accessible payroll policies" ON public.payroll_packet_policies FOR SELECT TO authenticated USING(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin'));
CREATE POLICY "Managers read accessible payroll packets" ON public.payroll_packets FOR SELECT TO authenticated USING(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin'));
CREATE POLICY "Managers read accessible payroll events" ON public.payroll_packet_events FOR SELECT TO authenticated USING(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin'));

-- Fresh actor authority, including auth-user revocation and current facility grants.
CREATE FUNCTION haven.payroll_packet_actor(p_actor_id uuid,p_facility_id uuid,p_configure boolean DEFAULT false)
RETURNS public.user_profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.user_profiles;
BEGIN
 SELECT p.* INTO a FROM public.user_profiles p JOIN auth.users u ON u.id=p.id JOIN public.facilities f ON f.id=p_facility_id AND f.organization_id=p.organization_id
 WHERE p.id=p_actor_id AND p.is_active AND p.deleted_at IS NULL AND f.deleted_at IS NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
 AND (p.app_role IN('owner','org_admin') OR (NOT p_configure AND p.app_role='facility_admin' AND EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=p.id AND g.facility_id=f.id AND g.organization_id=p.organization_id AND g.revoked_at IS NULL)));
 IF a.id IS NULL THEN RAISE EXCEPTION 'payroll_access_denied' USING ERRCODE='42501'; END IF;
 RETURN a;
END $$;
CREATE FUNCTION haven.payroll_packet_revision_lock(p_organization_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r text;
BEGIN
 INSERT INTO haven.payroll_packet_source_revisions(organization_id) VALUES(p_organization_id) ON CONFLICT DO NOTHING;
 SELECT revision::text INTO r FROM haven.payroll_packet_source_revisions WHERE organization_id=p_organization_id FOR UPDATE;
 RETURN r;
END $$;
CREATE FUNCTION haven.payroll_packet_source_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org uuid;
BEGIN
 IF TG_TABLE_NAME='timeclock_credentials' AND TG_OP='UPDATE' THEN
  IF (NEW.organization_id,NEW.staff_id,NEW.employee_number) IS NOT DISTINCT FROM (OLD.organization_id,OLD.staff_id,OLD.employee_number) THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='staff' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['updated_at','updated_by','phone','email','notes','photo_url']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','updated_by','phone','email','notes','photo_url']) THEN RETURN NEW; END IF;
 -- Lock both old and new organizations in a stable order if staff is transferred.
 FOR org IN SELECT DISTINCT x FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.organization_id] WHEN TG_OP='DELETE' THEN ARRAY[OLD.organization_id] ELSE ARRAY[OLD.organization_id,NEW.organization_id] END) x ORDER BY x LOOP
  PERFORM haven.payroll_packet_revision_lock(org);
  UPDATE haven.payroll_packet_source_revisions SET revision=revision+1 WHERE organization_id=org;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['time_punches','time_punch_corrections','timeclock_sync_rejections','floor_unlocks','timeclock_credentials','staff','facilities','payroll_packet_policies'] LOOP
 EXECUTE format('CREATE TRIGGER tr_payroll_source_revision BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION haven.payroll_packet_source_changed()',t);
 END LOOP;
END $$;
CREATE FUNCTION public.payroll_packet_revision(p_actor_id uuid,p_facility_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.user_profiles; r text;
BEGIN
 a:=haven.payroll_packet_actor(p_actor_id,p_facility_id);
 SELECT revision::text INTO r FROM haven.payroll_packet_source_revisions WHERE organization_id=a.organization_id;
 RETURN coalesce(r,'0');
END $$;

CREATE FUNCTION haven.payroll_packet_policy_valid(c jsonb,f uuid,o uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE d date;
BEGIN
 IF jsonb_typeof(c)<>'object' OR NOT c ?& ARRAY['employerName','payFrequency','anchorDate','workweekDay','workweekTime','timeZone','overtimeThresholdMinutes','overtimeFacilityIds','calculationMode','mealPolicy','roundingMinutes','salaryTreatment','approvalRole','defaultMethod','policyNote'] THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE k NOT IN('employerName','payFrequency','anchorDate','workweekDay','workweekTime','timeZone','overtimeThresholdMinutes','overtimeFacilityIds','calculationMode','mealPolicy','roundingMinutes','salaryTreatment','approvalRole','defaultMethod','policyNote')) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['employerName','payFrequency','anchorDate','workweekTime','timeZone','calculationMode','mealPolicy','salaryTreatment','approvalRole','defaultMethod','policyNote']) k WHERE jsonb_typeof(c->k) IS DISTINCT FROM 'string') THEN RETURN false; END IF;
 IF NOT (length(trim(c->>'employerName')) BETWEEN 1 AND 200 AND length(c->>'policyNote') BETWEEN 1 AND 2000 AND c->>'payFrequency' IN('weekly','biweekly') AND c->>'calculationMode' IN('automatic','reviewed') AND c->>'mealPolicy' IN('punched_unpaid','paid') AND c->>'salaryTreatment' IN('hours','amount','unchanged') AND c->>'approvalRole' IN('central','facility') AND c->>'defaultMethod' IN('phone','run') AND c->>'workweekTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND c->>'anchorDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND jsonb_typeof(c->'workweekDay')='number' AND (c->>'workweekDay')~'^[0-6]$' AND jsonb_typeof(c->'roundingMinutes')='number' AND (c->>'roundingMinutes') IN('0','5','6','15') AND jsonb_typeof(c->'overtimeThresholdMinutes')='number' AND (c->>'overtimeThresholdMinutes')~'^[0-9]+$' AND (c->>'overtimeThresholdMinutes')::integer BETWEEN 1 AND 10080) IS TRUE THEN RETURN false; END IF;
 d:=(c->>'anchorDate')::date;
 IF to_char(d,'YYYY-MM-DD')<>c->>'anchorDate' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=c->>'timeZone') OR jsonb_typeof(c->'overtimeFacilityIds')<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(c->'overtimeFacilityIds') NOT BETWEEN 1 AND 100 OR NOT (c->'overtimeFacilityIds' @> jsonb_build_array(f::text)) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'overtimeFacilityIds') v WHERE NOT EXISTS(SELECT 1 FROM public.facilities ff WHERE ff.id::text=v AND ff.organization_id=o AND ff.deleted_at IS NULL)) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR numeric_value_out_of_range THEN RETURN false;
END $$;
CREATE FUNCTION public.payroll_packet_policy_save(p_actor_id uuid,p_facility_id uuid,p_config jsonb,p_confirm boolean,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.user_profiles; p public.payroll_packet_policies;
BEGIN
 a:=haven.payroll_packet_actor(p_actor_id,p_facility_id,true);
 PERFORM haven.payroll_packet_revision_lock(a.organization_id);
 IF p_config IS NULL OR jsonb_typeof(p_config)<>'object' OR octet_length(p_config::text)>20000 OR p_confirm IS NULL THEN RAISE EXCEPTION 'payroll_policy_invalid'; END IF;
 IF p_config ? 'overtimeFacilityIds' THEN
  IF jsonb_typeof(p_config->'overtimeFacilityIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'payroll_policy_invalid'; END IF;
  IF jsonb_array_length(p_config->'overtimeFacilityIds')>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_config->'overtimeFacilityIds') v WHERE NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id::text=v AND f.organization_id=a.organization_id AND f.deleted_at IS NULL)) THEN RAISE EXCEPTION 'payroll_policy_invalid'; END IF;
 END IF;
 IF p_confirm AND NOT haven.payroll_packet_policy_valid(p_config,p_facility_id,a.organization_id) THEN RAISE EXCEPTION 'payroll_policy_incomplete'; END IF;
 SELECT * INTO p FROM public.payroll_packet_policies WHERE facility_id=p_facility_id FOR UPDATE;
 IF coalesce(p.revision,0) IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'payroll_revision_conflict' USING ERRCODE='40001'; END IF;
 INSERT INTO public.payroll_packet_policies(organization_id,facility_id,config,confirmed_at,confirmed_by,updated_by,updated_by_name) VALUES(a.organization_id,p_facility_id,p_config,CASE WHEN p_confirm THEN now() END,CASE WHEN p_confirm THEN a.id END,a.id,a.full_name)
 ON CONFLICT(facility_id) DO UPDATE SET config=excluded.config,revision=payroll_packet_policies.revision+1,confirmed_at=excluded.confirmed_at,confirmed_by=excluded.confirmed_by,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name,updated_at=now() RETURNING * INTO p;
 RETURN to_jsonb(p);
END $$;

-- Bounded snapshots contain no raw credentials. Server computes all derived values;
-- SQL independently checks shape, facility, period, source and roster membership.
CREATE FUNCTION haven.payroll_packet_payload_valid(i jsonb,s jsonb,f uuid,ps date,pe date,cd date,sr text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE row_data jsonb; key_name text;
BEGIN
 IF i IS NULL OR s IS NULL OR jsonb_typeof(i)<>'array' OR jsonb_typeof(s)<>'object' OR octet_length(i::text)>1000000 OR octet_length(s::text)>4000000 THEN RETURN false; END IF;
 IF NOT (s ?& ARRAY['schemaVersion','facilityId','facilityName','employerName','periodStart','periodEnd','checkDate','generatedAt','sourceRevision','policy','policyConfirmedAt','rows','totals','blockers','warnings']) OR s->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR s->>'facilityId' IS DISTINCT FROM f::text OR s->>'periodStart' IS DISTINCT FROM ps::text OR s->>'periodEnd' IS DISTINCT FROM pe::text OR s->>'checkDate' IS DISTINCT FROM cd::text OR s->>'sourceRevision' IS DISTINCT FROM sr OR jsonb_typeof(s->'rows')<>'array' OR jsonb_typeof(s->'blockers')<>'array' OR jsonb_typeof(s->'warnings')<>'array' OR jsonb_typeof(s->'totals')<>'object' THEN RETURN false; END IF;
 IF jsonb_array_length(i)>1000 OR jsonb_array_length(s->'rows')>1000 OR jsonb_array_length(s->'blockers')>5000 OR jsonb_array_length(s->'warnings')>5000 THEN RETURN false; END IF;
 IF (i::text || s::text) ~* '"(pin_hash|pinHash|badge_lookup_hmac|badgeLookupHmac|password|access_token|refresh_token)"[[:space:]]*:' THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'rows') r GROUP BY r->>'staffId' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(i) r GROUP BY r->>'staffId' HAVING count(*)>1) THEN RETURN false; END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(i) UNION ALL SELECT value FROM jsonb_array_elements(s->'rows') LOOP
  IF jsonb_typeof(row_data)<>'object' OR NOT (row_data ?& ARRAY['staffId','payrollId','payBasis','department','regularMinutes','overtimeMinutes','holidayMinutes','personalMinutes','trainingMinutes','onCallCents','bonusCents','salaryCents','note','reason','reviewed']) OR NOT EXISTS(SELECT 1 FROM public.staff st WHERE st.id::text=row_data->>'staffId' AND (st.facility_id=f OR EXISTS(SELECT 1 FROM public.time_punches tp WHERE tp.staff_id=st.id AND tp.facility_id=f) OR EXISTS(SELECT 1 FROM public.time_punch_corrections tc WHERE tc.staff_id=st.id AND tc.facility_id=f) OR EXISTS(SELECT 1 FROM public.timeclock_sync_rejections tr WHERE tr.staff_id=st.id AND tr.facility_id=f) OR EXISTS(SELECT 1 FROM public.floor_unlocks fu WHERE fu.staff_id=st.id AND fu.facility_id=f) OR EXISTS(SELECT 1 FROM public.payroll_packets pp WHERE pp.facility_id=f AND pp.snapshot->'rows' @> jsonb_build_array(jsonb_build_object('staffId',st.id::text))))) OR jsonb_typeof(row_data->'reviewed')<>'boolean' OR length(row_data->>'note')>2000 OR length(row_data->>'reason')>2000 OR length(row_data->>'payrollId')>100 OR row_data->>'department' NOT IN('administration','operations') OR (row_data->>'payBasis' IS NOT NULL AND row_data->>'payBasis' NOT IN('hourly','salary')) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['staffId','payrollId','department','note','reason']) k WHERE jsonb_typeof(row_data->k) IS DISTINCT FROM 'string') OR (row_data->'payBasis'<>'null'::jsonb AND jsonb_typeof(row_data->'payBasis') IS DISTINCT FROM 'string') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['holidayMinutes','personalMinutes','trainingMinutes','onCallCents','bonusCents']) k WHERE jsonb_typeof(row_data->k) IS DISTINCT FROM 'number') THEN RETURN false; END IF;
  FOREACH key_name IN ARRAY ARRAY['regularMinutes','overtimeMinutes','holidayMinutes','personalMinutes','trainingMinutes','onCallCents','bonusCents','salaryCents'] LOOP
   IF row_data->key_name<>'null'::jsonb AND (jsonb_typeof(row_data->key_name)<>'number' OR NOT (row_data->>key_name ~ '^[0-9]+$') OR (row_data->>key_name)::numeric>2147483647) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 FOR row_data IN SELECT value FROM jsonb_array_elements(s->'rows') LOOP
  IF NOT row_data ?& ARRAY['name','role','workedMinutes','mealMinutes','paidWorkMinutes','paidMinutes','issues','sourcePunchIds','sourceCorrectionIds'] OR jsonb_typeof(row_data->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(row_data->'role') IS DISTINCT FROM 'string' OR jsonb_typeof(row_data->'issues') IS DISTINCT FROM 'array' OR jsonb_typeof(row_data->'sourcePunchIds') IS DISTINCT FROM 'array' OR jsonb_typeof(row_data->'sourceCorrectionIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOREACH key_name IN ARRAY ARRAY['workedMinutes','mealMinutes','paidWorkMinutes','paidMinutes'] LOOP
   IF row_data->key_name<>'null'::jsonb AND (jsonb_typeof(row_data->key_name)<>'number' OR NOT (row_data->>key_name ~ '^[0-9]+$') OR (row_data->>key_name)::numeric>2147483647) THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION public.payroll_packet_write(p_actor_id uuid,p_facility_id uuid,p_packet_id uuid,p_expected_revision integer,p_source_revision text,p_policy_revision integer,p_period_start date,p_period_end date,p_check_date date,p_inputs jsonb,p_snapshot jsonb,p_amends_packet_id uuid DEFAULT NULL,p_amendment_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.user_profiles; p public.payroll_packets; parent public.payroll_packets; policy public.payroll_packet_policies; new_id uuid:=gen_random_uuid(); v integer;
BEGIN
 a:=haven.payroll_packet_actor(p_actor_id,p_facility_id);
 IF haven.payroll_packet_revision_lock(a.organization_id) IS DISTINCT FROM p_source_revision THEN RAISE EXCEPTION 'payroll_source_stale' USING ERRCODE='40001'; END IF;
 SELECT * INTO policy FROM public.payroll_packet_policies WHERE facility_id=p_facility_id;
 IF coalesce(policy.revision,0) IS DISTINCT FROM p_policy_revision THEN RAISE EXCEPTION 'payroll_policy_stale' USING ERRCODE='40001'; END IF;
 IF p_period_start IS NULL OR p_period_end IS NULL OR p_check_date IS NULL OR p_period_end<p_period_start OR p_period_end-p_period_start>=31 OR p_check_date<p_period_end OR p_check_date>p_period_end+366 OR NOT haven.payroll_packet_payload_valid(p_inputs,p_snapshot,p_facility_id,p_period_start,p_period_end,p_check_date,p_source_revision) THEN RAISE EXCEPTION 'payroll_packet_invalid'; END IF;
 IF p_snapshot->'policy' IS DISTINCT FROM coalesce(policy.config,'null'::jsonb) OR ((policy.confirmed_at IS NULL) IS DISTINCT FROM (p_snapshot->>'policyConfirmedAt' IS NULL)) THEN RAISE EXCEPTION 'payroll_policy_snapshot_invalid'; END IF;
 IF policy.confirmed_at IS NOT NULL AND (p_snapshot->>'policyConfirmedAt')::timestamptz IS DISTINCT FROM policy.confirmed_at THEN RAISE EXCEPTION 'payroll_policy_snapshot_invalid'; END IF;
 IF p_packet_id IS NOT NULL THEN
  SELECT * INTO p FROM public.payroll_packets WHERE id=p_packet_id AND facility_id=p_facility_id AND organization_id=a.organization_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'payroll_packet_not_found' USING ERRCODE='42501'; END IF;
  IF p.status<>'draft' THEN RAISE EXCEPTION 'payroll_packet_immutable'; END IF;
  IF p.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'payroll_revision_conflict' USING ERRCODE='40001'; END IF;
  IF (p.period_start,p.period_end,p.amends_packet_id) IS DISTINCT FROM (p_period_start,p_period_end,p_amends_packet_id) THEN RAISE EXCEPTION 'payroll_packet_identity_immutable'; END IF;
  UPDATE public.payroll_packets SET check_date=p_check_date,inputs=p_inputs,snapshot=p_snapshot,source_revision=p_source_revision,policy_revision=p_policy_revision,revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
 ELSE
  IF p_expected_revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'payroll_revision_conflict' USING ERRCODE='40001'; END IF;
  IF p_amends_packet_id IS NOT NULL THEN
   SELECT * INTO parent FROM public.payroll_packets WHERE id=p_amends_packet_id AND facility_id=p_facility_id AND organization_id=a.organization_id;
   IF parent.id IS NULL OR parent.status='draft' OR (parent.period_start,parent.period_end) IS DISTINCT FROM (p_period_start,p_period_end) OR length(trim(coalesce(p_amendment_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'payroll_amendment_invalid'; END IF;
   PERFORM 1 FROM public.payroll_packets WHERE id=parent.root_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.payroll_packets WHERE root_id=parent.root_id AND (version>parent.version OR status='draft')) THEN RAISE EXCEPTION 'payroll_amendment_superseded'; END IF;
   v:=parent.version+1;
  ELSE v:=1; END IF;
  INSERT INTO public.payroll_packets(id,root_id,amends_packet_id,version,organization_id,facility_id,period_start,period_end,check_date,inputs,snapshot,source_revision,policy_revision,created_by,created_by_name,amendment_reason)
   VALUES(new_id,coalesce(parent.root_id,new_id),p_amends_packet_id,v,a.organization_id,p_facility_id,p_period_start,p_period_end,p_check_date,p_inputs,p_snapshot,p_source_revision,p_policy_revision,a.id,a.full_name,CASE WHEN p_amends_packet_id IS NOT NULL THEN trim(p_amendment_reason) END) RETURNING * INTO p;
 END IF;
 INSERT INTO public.payroll_packet_events(packet_id,organization_id,facility_id,action,actor_id,actor_name,detail) VALUES(p.id,p.organization_id,p.facility_id,CASE WHEN p_packet_id IS NOT NULL THEN 'edit' WHEN p_amends_packet_id IS NOT NULL THEN 'amend' ELSE 'create' END,a.id,a.full_name,jsonb_build_object('revision',p.revision,'sourceRevision',p.source_revision,'amendmentReason',p.amendment_reason));
 RETURN to_jsonb(p)-ARRAY['approved_pdf_base64','approved_html','approved_csv'];
END $$;

CREATE FUNCTION public.payroll_packet_action(p_actor_id uuid,p_packet_id uuid,p_expected_revision integer,p_action text,p_detail jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='',extensions AS $$
DECLARE a public.user_profiles; p public.payroll_packets; policy public.payroll_packet_policies; source_version text; pdf bytea; approved_time timestamptz; event_detail jsonb;
BEGIN
 SELECT * INTO p FROM public.payroll_packets WHERE id=p_packet_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'payroll_packet_not_found' USING ERRCODE='42501'; END IF;
 a:=haven.payroll_packet_actor(p_actor_id,p.facility_id);
 source_version:=haven.payroll_packet_revision_lock(a.organization_id);
 PERFORM 1 FROM public.payroll_packets WHERE id=p.root_id FOR UPDATE;
 SELECT * INTO p FROM public.payroll_packets WHERE id=p_packet_id FOR UPDATE;
 IF p.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'payroll_revision_conflict' USING ERRCODE='40001'; END IF;
 IF p_detail IS NULL OR jsonb_typeof(p_detail)<>'object' OR octet_length(p_detail::text)>20000000 THEN RAISE EXCEPTION 'payroll_action_invalid'; END IF;
 IF p_action='approve' THEN
  SELECT * INTO policy FROM public.payroll_packet_policies WHERE facility_id=p.facility_id;
  IF p.status<>'draft' THEN RAISE EXCEPTION 'payroll_packet_immutable'; END IF;
  IF source_version IS DISTINCT FROM p.source_revision OR policy.revision IS DISTINCT FROM p.policy_revision THEN RAISE EXCEPTION 'payroll_source_stale' USING ERRCODE='40001'; END IF;
  IF policy.confirmed_at IS NULL OR NOT haven.payroll_packet_policy_valid(policy.config,p.facility_id,a.organization_id) OR jsonb_array_length(p.snapshot->'blockers')<>0 OR jsonb_array_length(p.snapshot->'rows')=0 THEN RAISE EXCEPTION 'payroll_approval_blocked'; END IF;
  IF policy.config->>'approvalRole'='central' AND a.app_role NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'payroll_approval_denied' USING ERRCODE='42501'; END IF;
  approved_time:=(p_detail->>'approvedAt')::timestamptz;
  IF approved_time IS NULL OR abs(extract(epoch FROM clock_timestamp()-approved_time))>120 OR p_detail->>'approvedByName' IS DISTINCT FROM a.full_name OR length(coalesce(p_detail->>'html','')) NOT BETWEEN 100 AND 5000000 OR length(coalesce(p_detail->>'csv','')) NOT BETWEEN 1 AND 5000000 OR length(coalesce(p_detail->>'pdfBase64','')) NOT BETWEEN 20 AND 14000000 OR NOT (coalesce(p_detail->>'documentHash','')~'^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'payroll_document_invalid'; END IF;
  pdf:=decode(p_detail->>'pdfBase64','base64');
  IF substring(pdf FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') OR encode(digest(pdf,'sha256'),'hex') IS DISTINCT FROM p_detail->>'documentHash' THEN RAISE EXCEPTION 'payroll_document_invalid'; END IF;
  UPDATE public.payroll_packets SET status='approved',approved_at=approved_time,approved_by=a.id,approved_by_name=a.full_name,approved_pdf_base64=p_detail->>'pdfBase64',approved_html=p_detail->>'html',approved_csv=p_detail->>'csv',document_hash=p_detail->>'documentHash',revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  event_detail:=jsonb_build_object('documentHash',p.document_hash,'approvedAt',p.approved_at,'approvedByName',p.approved_by_name);
 ELSIF p_action='report' THEN
  IF p.status<>'approved' OR EXISTS(SELECT 1 FROM public.payroll_packets WHERE root_id=p.root_id AND version>p.version) THEN RAISE EXCEPTION 'payroll_report_blocked'; END IF;
  IF NOT (p_detail->>'method' IN('phone','run') AND length(trim(p_detail->>'reference')) BETWEEN 1 AND 2000) IS TRUE THEN RAISE EXCEPTION 'payroll_report_invalid'; END IF;
  UPDATE public.payroll_packets SET status='reported',reported_at=now(),reported_by=a.id,reported_by_name=a.full_name,report_method=p_detail->>'method',report_reference=trim(p_detail->>'reference'),revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  event_detail:=jsonb_build_object('method',p.report_method,'reference',p.report_reference);
 ELSIF p_action IN('reconcile','difference') THEN
  IF p.status<>'reported' OR NOT (length(trim(p_detail->>'note')) BETWEEN 1 AND 2000) IS TRUE THEN RAISE EXCEPTION 'payroll_reconciliation_invalid'; END IF;
  IF p_action='reconcile' THEN
   IF p_detail->'matches' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'payroll_reconciliation_mismatch'; END IF;
   UPDATE public.payroll_packets SET status='reconciled',reconciled_at=now(),reconciled_by=a.id,reconciled_by_name=a.full_name,reconciliation_note=trim(p_detail->>'note'),revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  ELSE UPDATE public.payroll_packets SET revision=revision+1,updated_at=now() WHERE id=p.id RETURNING * INTO p;
  END IF;
  event_detail:=jsonb_build_object('note',trim(p_detail->>'note'),'matches',p_action='reconcile');
 ELSE RAISE EXCEPTION 'payroll_action_invalid'; END IF;
 INSERT INTO public.payroll_packet_events(packet_id,organization_id,facility_id,action,actor_id,actor_name,detail) VALUES(p.id,p.organization_id,p.facility_id,p_action,a.id,a.full_name,event_detail);
 RETURN to_jsonb(p)-ARRAY['approved_pdf_base64','approved_html','approved_csv'];
END $$;

-- Service-only paginated source reader: explicit nonsecret projections only.
CREATE FUNCTION public.payroll_packet_source_page(p_actor_id uuid,p_facility_id uuid,p_kind text,p_offset integer,p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.user_profiles; group_ids uuid[]; staff_ids uuid[]; result jsonb; total bigint;
BEGIN
 a:=haven.payroll_packet_actor(p_actor_id,p_facility_id);
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'payroll_page_invalid'; END IF;
 SELECT array_agg(f.id ORDER BY f.id) INTO group_ids FROM public.facilities f
 WHERE f.organization_id=a.organization_id AND f.deleted_at IS NULL AND (f.id=p_facility_id OR f.id::text IN(
  SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(config->'overtimeFacilityIds')='array' THEN config->'overtimeFacilityIds' ELSE '[]'::jsonb END) FROM public.payroll_packet_policies WHERE facility_id=p_facility_id));
 SELECT array_agg(s.id ORDER BY s.id) INTO staff_ids FROM public.staff s WHERE s.organization_id=a.organization_id AND
 (s.facility_id=ANY(group_ids) OR EXISTS(SELECT 1 FROM public.time_punches t WHERE t.staff_id=s.id AND t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids)) OR EXISTS(SELECT 1 FROM public.time_punch_corrections t WHERE t.staff_id=s.id AND t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids)) OR EXISTS(SELECT 1 FROM public.timeclock_sync_rejections t WHERE t.staff_id=s.id AND t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids)) OR EXISTS(SELECT 1 FROM public.floor_unlocks t WHERE t.staff_id=s.id AND t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids)) OR EXISTS(SELECT 1 FROM public.payroll_packets pp WHERE pp.organization_id=a.organization_id AND pp.facility_id=ANY(group_ids) AND pp.snapshot->'rows' @> jsonb_build_array(jsonb_build_object('staffId',s.id::text))));
 IF p_kind='people' THEN
  SELECT count(*) INTO total FROM public.staff s WHERE s.id=ANY(staff_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM (
   SELECT s.id,concat_ws(' ',s.first_name,s.last_name) AS name,s.facility_id AS "facilityId",s.staff_role AS role,s.employment_status AS "employmentStatus",s.user_id AS "userId",c.employee_number AS "employeeNumber",s.hire_date AS "hireDate",s.termination_date AS "terminationDate"
   FROM public.staff s LEFT JOIN public.timeclock_credentials c ON c.staff_id=s.id AND c.organization_id=s.organization_id WHERE s.id=ANY(staff_ids) ORDER BY s.id OFFSET p_offset LIMIT p_limit) q;
 ELSIF p_kind='punches' THEN
  SELECT count(*) INTO total FROM public.time_punches t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND t.staff_id=ANY(staff_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM(SELECT t.id,t.staff_id,t.facility_id,t.punch_type,t.punched_at,t.device_time,t.captured_offline,t.flags FROM public.time_punches t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND t.staff_id=ANY(staff_ids) ORDER BY t.id OFFSET p_offset LIMIT p_limit) q;
 ELSIF p_kind='corrections' THEN
  SELECT count(*) INTO total FROM public.time_punch_corrections t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND t.staff_id=ANY(staff_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM(SELECT t.id,t.staff_id,t.facility_id,t.correction_type,t.target_punch_id,t.target_correction_id,t.punch_type,t.corrected_punched_at,t.exception_key,t.reason,t.note,t.corrected_by,t.corrected_at FROM public.time_punch_corrections t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND t.staff_id=ANY(staff_ids) ORDER BY t.id OFFSET p_offset LIMIT p_limit) q;
 ELSIF p_kind='rejections' THEN
  SELECT count(*) INTO total FROM public.timeclock_sync_rejections t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND (t.staff_id IS NULL OR t.staff_id=ANY(staff_ids));
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM(SELECT t.id,t.staff_id,t.facility_id,t.punch_type,t.device_time,t.reason,t.created_at FROM public.timeclock_sync_rejections t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND (t.staff_id IS NULL OR t.staff_id=ANY(staff_ids)) ORDER BY t.id OFFSET p_offset LIMIT p_limit) q;
 ELSIF p_kind='floorUnlocks' THEN
  SELECT count(*) INTO total FROM public.floor_unlocks t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND t.staff_id=ANY(staff_ids);
  SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO result FROM(SELECT t.id,t.staff_id,t.facility_id,t.started_at,t.on_clock FROM public.floor_unlocks t WHERE t.organization_id=a.organization_id AND t.facility_id=ANY(group_ids) AND t.staff_id=ANY(staff_ids) ORDER BY t.id OFFSET p_offset LIMIT p_limit) q;
 ELSE RAISE EXCEPTION 'payroll_source_kind_invalid'; END IF;
 RETURN jsonb_build_object('data',result,'count',total);
END $$;
REVOKE ALL ON FUNCTION public.payroll_packet_source_page(uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.payroll_packet_source_page(uuid,uuid,text,integer,integer) TO service_role;

-- Even owner-path mistakes cannot rewrite approved source or document history.
CREATE FUNCTION haven.payroll_packet_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'payroll_history_immutable' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.root_id,NEW.amends_packet_id,NEW.version,NEW.organization_id,NEW.facility_id,NEW.period_start,NEW.period_end,NEW.created_at,NEW.created_by,NEW.created_by_name,NEW.amendment_reason) IS DISTINCT FROM (OLD.id,OLD.root_id,OLD.amends_packet_id,OLD.version,OLD.organization_id,OLD.facility_id,OLD.period_start,OLD.period_end,OLD.created_at,OLD.created_by,OLD.created_by_name,OLD.amendment_reason) THEN RAISE EXCEPTION 'payroll_identity_immutable' USING ERRCODE='42501'; END IF;
 IF OLD.status<>'draft' AND (NEW.check_date,NEW.inputs,NEW.snapshot,NEW.source_revision,NEW.policy_revision,NEW.approved_at,NEW.approved_by,NEW.approved_by_name,NEW.document_hash,NEW.approved_pdf_base64,NEW.approved_html,NEW.approved_csv) IS DISTINCT FROM (OLD.check_date,OLD.inputs,OLD.snapshot,OLD.source_revision,OLD.policy_revision,OLD.approved_at,OLD.approved_by,OLD.approved_by_name,OLD.document_hash,OLD.approved_pdf_base64,OLD.approved_html,OLD.approved_csv) THEN RAISE EXCEPTION 'payroll_document_immutable' USING ERRCODE='42501'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status IN('draft','approved')) OR (OLD.status='approved' AND NEW.status='reported') OR (OLD.status='reported' AND NEW.status IN('reported','reconciled'))) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'payroll_transition_invalid' USING ERRCODE='42501'; END IF;
 IF OLD.status IN('reported','reconciled') AND (NEW.reported_at,NEW.reported_by,NEW.reported_by_name,NEW.report_method,NEW.report_reference) IS DISTINCT FROM (OLD.reported_at,OLD.reported_by,OLD.reported_by_name,OLD.report_method,OLD.report_reference) THEN RAISE EXCEPTION 'payroll_report_immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tr_payroll_packet_guard BEFORE UPDATE OR DELETE ON public.payroll_packets FOR EACH ROW EXECUTE FUNCTION haven.payroll_packet_guard();
CREATE TRIGGER tr_payroll_packet_no_truncate BEFORE TRUNCATE ON public.payroll_packets FOR EACH STATEMENT EXECUTE FUNCTION haven.payroll_packet_guard();
CREATE TRIGGER tr_payroll_events_immutable BEFORE UPDATE OR DELETE ON public.payroll_packet_events FOR EACH ROW EXECUTE FUNCTION haven.timeclock_guard_append_only();
CREATE TRIGGER tr_payroll_events_no_truncate BEFORE TRUNCATE ON public.payroll_packet_events FOR EACH STATEMENT EXECUTE FUNCTION haven.timeclock_guard_append_only();
-- Service RPCs do not have auth.uid(); use the freshly resolved editor and
-- retain full OLD/NEW policies, including the actor names at each revision.
CREATE FUNCTION haven.payroll_packet_policy_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payroll_policy_history_immutable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.audit_log(table_name,record_id,action,old_data,new_data,user_id,organization_id,facility_id)
 VALUES('payroll_packet_policies',NEW.id,TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW),NEW.updated_by,NEW.organization_id,NEW.facility_id);
 RETURN NEW;
END $$;
CREATE TRIGGER tr_payroll_packet_policies_audit AFTER INSERT OR UPDATE OR DELETE ON public.payroll_packet_policies FOR EACH ROW EXECUTE FUNCTION haven.payroll_packet_policy_audit();
-- Audit events carry hashes, not multi-megabyte document bodies. The adjacent
-- append-only event records the server-resolved actor for every packet write;
-- generic row audit must not misattribute an edit to the original creator.
CREATE TRIGGER tr_payroll_packet_events_audit AFTER INSERT ON public.payroll_packet_events FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE FUNCTION haven.payroll_packet_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM haven.timeclock_audit('payroll_packets',NEW.id,TG_OP,'payroll_packet_'||NEW.status,NULL,NEW.organization_id,NEW.facility_id,jsonb_build_object('revision',NEW.revision,'version',NEW.version,'sourceRevision',NEW.source_revision,'documentHash',NEW.document_hash));
 RETURN NEW;
END $$;
CREATE TRIGGER tr_payroll_packets_audit AFTER INSERT OR UPDATE ON public.payroll_packets FOR EACH ROW EXECUTE FUNCTION haven.payroll_packet_audit();
REVOKE ALL ON FUNCTION haven.payroll_packet_actor(uuid,uuid,boolean),haven.payroll_packet_revision_lock(uuid),haven.payroll_packet_source_changed(),haven.payroll_packet_policy_valid(jsonb,uuid,uuid),haven.payroll_packet_payload_valid(jsonb,jsonb,uuid,date,date,date,text),haven.payroll_packet_guard(),haven.payroll_packet_audit(),haven.payroll_packet_policy_audit(),public.payroll_packet_revision(uuid,uuid),public.payroll_packet_policy_save(uuid,uuid,jsonb,boolean,integer),public.payroll_packet_write(uuid,uuid,uuid,integer,text,integer,date,date,date,jsonb,jsonb,uuid,text),public.payroll_packet_action(uuid,uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.payroll_packet_revision(uuid,uuid),public.payroll_packet_policy_save(uuid,uuid,jsonb,boolean,integer),public.payroll_packet_write(uuid,uuid,uuid,integer,text,integer,date,date,date,jsonb,jsonb,uuid,text),public.payroll_packet_action(uuid,uuid,integer,text,jsonb) TO service_role;
COMMIT;
