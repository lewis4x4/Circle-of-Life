-- Additive operational reporting. Legacy executive debt metrics are not changed.
BEGIN;
CREATE TABLE public.stand_up_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id), facility_id uuid NOT NULL REFERENCES public.facilities(id),
 week_start date NOT NULL CHECK(extract(isodow FROM week_start)=1), version integer NOT NULL DEFAULT 0, revision_id uuid, values jsonb NOT NULL, status text NOT NULL CHECK(status IN('draft','ready')),
 source_as_of timestamptz, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(facility_id,week_start)
);
CREATE TABLE public.stand_up_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, report_id uuid NOT NULL REFERENCES public.stand_up_reports(id),
 version integer NOT NULL, values jsonb NOT NULL, status text NOT NULL, actor_id uuid NOT NULL, reason text, provenance jsonb NOT NULL DEFAULT '{}', batch_id uuid, source_as_of timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(report_id,version)
);
ALTER TABLE public.stand_up_reports ADD FOREIGN KEY(revision_id) REFERENCES public.stand_up_revisions(id);
CREATE TABLE public.stand_up_receipts(actor_id uuid NOT NULL, request_id uuid NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_id));
CREATE TABLE public.stand_up_previews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, report_id uuid NOT NULL REFERENCES public.stand_up_reports(id), baseline_id uuid NOT NULL REFERENCES public.stand_up_revisions(id), expected_version integer NOT NULL, incoming_values jsonb NOT NULL, merged jsonb NOT NULL, conflicts jsonb NOT NULL, clears jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.stand_up_recovery_decisions(preview_id uuid PRIMARY KEY REFERENCES public.stand_up_previews(id), actor_id uuid NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.stand_up_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, organization_id uuid NOT NULL, request_id uuid NOT NULL, payload jsonb NOT NULL, result jsonb, reversal jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,request_id));
CREATE FUNCTION haven.stand_up_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Stand Up evidence is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER stand_up_revision_immutable BEFORE UPDATE OR DELETE ON public.stand_up_revisions FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
CREATE TRIGGER stand_up_receipt_immutable BEFORE UPDATE OR DELETE ON public.stand_up_receipts FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
CREATE TRIGGER stand_up_decision_immutable BEFORE UPDATE OR DELETE ON public.stand_up_recovery_decisions FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
CREATE TRIGGER stand_up_preview_immutable BEFORE UPDATE OR DELETE ON public.stand_up_previews FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
CREATE FUNCTION haven.stand_up_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT ARRAY['monthly_rent_roll_cents','current_total_census','sp_female_beds_open','sp_male_beds_open','sp_flexible_beds_open','private_beds_open','admissions_expected','hospital_and_rehab_total','expected_discharges','callouts_last_week','terminations_last_week','current_open_positions','overtime_reported','tours_expected','provider_activities_expected','outreach_engagements']::text[] $$;
CREATE FUNCTION haven.stand_up_validate(v jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; n numeric;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Values must be an object'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v))<>16 OR NOT v ?& haven.stand_up_keys() THEN RAISE EXCEPTION 'Exactly sixteen supported metrics required'; END IF;
 FOREACH k IN ARRAY haven.stand_up_keys() LOOP
  IF v->k='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(v->k)<>'number' THEN RAISE EXCEPTION 'Invalid numeric metric: %',k; END IF;
  n:=(v->>k)::numeric;
  IF n<0 OR n>2147483647 OR (k<>'overtime_reported' AND trunc(n)<>n) THEN RAISE EXCEPTION 'Invalid numeric metric: %',k; END IF;
 END LOOP;
END $$;
CREATE FUNCTION haven.stand_up_assert(p_facility uuid,p_admin boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; r text;
BEGIN
 SELECT actor_user_id,actor_organization_id,actor_app_role::text INTO a,o,r FROM haven.current_authorized_actor() WHERE actor_is_managed;
 IF a IS NULL OR r NOT IN('owner','org_admin','facility_admin') OR (p_admin AND r NOT IN('owner','org_admin')) OR NOT haven.has_facility_access(p_facility)
 OR NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND organization_id=o AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501'; END IF;
 RETURN o;
END $$;
CREATE FUNCTION haven.stand_up_week() RETURNS date LANGUAGE sql VOLATILE SET search_path='' AS $$ SELECT date_trunc('week',(clock_timestamp() AT TIME ZONE 'America/New_York')+interval '1 day')::date $$;
CREATE FUNCTION haven.stand_up_save(p jsonb,p_batch uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid:=(p->>'facility_id')::uuid; w date:=(p->>'week_start')::date; o uuid; a uuid; r public.stand_up_reports%ROWTYPE; v_id uuid; result jsonb; request uuid:=(p->>'request_id')::uuid; receipt public.stand_up_receipts%ROWTYPE; asof timestamptz; s text:=coalesce(p->>'status','draft');
BEGIN
 IF f IS NULL OR w IS NULL OR request IS NULL OR p->>'expected_version' IS NULL THEN RAISE EXCEPTION 'Facility, week, request and expected version required'; END IF;
 o:=haven.stand_up_assert(f); a:=haven.authorized_user_id();
 -- Serialize organization revisions so source sequence follows commit order.
 PERFORM pg_advisory_xact_lock(hashtextextended('stand_up_org:'||o::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(a::text||request::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(f::text||w::text,0));
 o:=haven.stand_up_assert(f); a:=haven.authorized_user_id();
 SELECT * INTO receipt FROM public.stand_up_receipts WHERE actor_id=a AND request_id=request;
 IF FOUND THEN IF receipt.payload IS DISTINCT FROM p THEN RAISE EXCEPTION 'Idempotency key payload differs'; END IF; RETURN receipt.result; END IF;
 IF extract(isodow FROM w)<>1 THEN RAISE EXCEPTION 'Week must be Monday'; END IF;
 IF w<>haven.stand_up_week() OR p_batch IS NOT NULL THEN
  PERFORM haven.stand_up_assert(f,true);
  IF nullif(btrim(p->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Historical change requires reason'; END IF;
 END IF;
 PERFORM haven.stand_up_validate(p->'values');
 asof:=CASE WHEN p ? 'as_of' THEN (p->>'as_of')::timestamptz WHEN w=haven.stand_up_week() AND p_batch IS NULL THEN clock_timestamp() ELSE NULL END;
 IF asof>clock_timestamp() THEN RAISE EXCEPTION 'Source observation time cannot be future'; END IF;
 IF s NOT IN('draft','ready') THEN RAISE EXCEPTION 'Invalid report status'; END IF;
 IF s='ready' AND ((clock_timestamp() AT TIME ZONE 'America/New_York')::date<w OR EXISTS(SELECT 1 FROM jsonb_each(p->'values') WHERE value='null'::jsonb)) THEN RAISE EXCEPTION 'Ready requires complete values and closed staffing week'; END IF;
 SELECT * INTO r FROM public.stand_up_reports WHERE facility_id=f AND week_start=w FOR UPDATE;
 PERFORM haven.stand_up_assert(f,w<>haven.stand_up_week() OR p_batch IS NOT NULL);
 IF coalesce(r.version,0)<>(p->>'expected_version')::integer THEN RAISE EXCEPTION 'Stale report version' USING ERRCODE='P0409'; END IF;
 IF r.id IS NULL THEN INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status) VALUES(o,f,w,p->'values',s) RETURNING * INTO r; END IF;
 INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,batch_id,source_as_of) VALUES(r.id,r.version+1,p->'values',s,a,p->>'reason',coalesce(p->'provenance','{}'),p_batch,asof) RETURNING id INTO v_id;
 UPDATE public.stand_up_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id RETURNING to_jsonb(stand_up_reports.*) INTO result;
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;
CREATE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; o uuid; f uuid; r public.stand_up_reports%ROWTYPE; b public.stand_up_revisions%ROWTYPE; q public.stand_up_previews%ROWTYPE; batch public.stand_up_batches%ROWTYPE; row jsonb; merged jsonb; conflicts jsonb:='[]'; clears jsonb:='[]'; results jsonb:='[]'; k text; v uuid; saved jsonb; payload jsonb; old_revision public.stand_up_revisions%ROWTYPE;
BEGIN
 a:=haven.authorized_user_id(); o:=haven.organization_id();
 IF a IS NULL OR haven.app_role()::text NOT IN('owner','org_admin','facility_admin') THEN RAISE EXCEPTION 'Stand Up access denied' USING ERRCODE='42501'; END IF;
 IF p_action='save' THEN RETURN haven.stand_up_save(p_payload); END IF;
 IF p_action IN('workspace','list') THEN
  RETURN jsonb_build_object('current_week',haven.stand_up_week(),'can_import',haven.app_role()::text IN('owner','org_admin'),
   'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM public.facilities WHERE organization_id=o AND deleted_at IS NULL AND haven.has_facility_access(id)),'[]'),
   'pending_recoveries',coalesce((SELECT jsonb_agg(jsonb_build_object('preview_id',p.id,'facility_id',rp.facility_id,'week_start',rp.week_start,'expected_version',p.expected_version,'baseline',bs.values,'current',c.values,'incoming',p.incoming_values,'merged',p.merged,'conflicts',p.conflicts,'clears',p.clears) ORDER BY p.created_at DESC)
    FROM public.stand_up_previews p JOIN public.stand_up_reports rp ON rp.id=p.report_id JOIN public.stand_up_revisions bs ON bs.id=p.baseline_id JOIN public.stand_up_revisions c ON c.report_id=p.report_id AND c.version=p.expected_version
    WHERE p.actor_id=a AND rp.organization_id=o AND haven.has_facility_access(rp.facility_id) AND NOT EXISTS(SELECT 1 FROM public.stand_up_recovery_decisions d WHERE d.preview_id=p.id)),'[]'),
   'reports',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY week_start DESC) FROM public.stand_up_reports t WHERE organization_id=o AND haven.has_facility_access(facility_id) AND (p_payload->>'facility_id' IS NULL OR facility_id=(p_payload->>'facility_id')::uuid)),'[]'));
 ELSIF p_action='export' THEN
  f:=(p_payload->>'facility_id')::uuid; PERFORM haven.stand_up_assert(f);
  SELECT * INTO r FROM public.stand_up_reports WHERE facility_id=f AND week_start=(p_payload->>'week_start')::date;
  IF NOT FOUND THEN SELECT jsonb_object_agg(key,'null'::jsonb) INTO merged FROM unnest(haven.stand_up_keys()) key; RETURN jsonb_build_object('schema_version','standup-2026-v1','baseline_id',NULL,'facility_id',f,'week_start',p_payload->>'week_start','values',merged,'version',0); END IF;
  RETURN jsonb_build_object('schema_version','standup-2026-v1','baseline_id',r.revision_id,'facility_id',r.facility_id,'week_start',r.week_start,'values',r.values,'version',r.version,'source_as_of',r.source_as_of);
 ELSIF p_action IN('preview_recovery','find_recovery') THEN
  SELECT * INTO b FROM public.stand_up_revisions WHERE id=(p_payload->>'baseline_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown baseline'; END IF;
  SELECT * INTO r FROM public.stand_up_reports WHERE id=b.report_id FOR UPDATE;
  IF (p_payload->>'facility_id')::uuid IS DISTINCT FROM r.facility_id OR (p_payload->>'week_start')::date IS DISTINCT FROM r.week_start THEN RAISE EXCEPTION 'Baseline does not match uploaded facility/week'; END IF;
  PERFORM haven.stand_up_assert(r.facility_id); PERFORM haven.stand_up_validate(p_payload->'values');
  IF p_action='find_recovery' THEN
   SELECT jsonb_build_object('resolved_result',d.result,'preview_id',p.id) INTO saved FROM public.stand_up_previews p JOIN public.stand_up_recovery_decisions d ON d.preview_id=p.id
    WHERE p.report_id=r.id AND p.baseline_id=b.id AND p.incoming_values=p_payload->'values' ORDER BY d.created_at DESC LIMIT 1;
   RETURN coalesce(saved,jsonb_build_object('resolved_result',NULL));
  END IF;
  -- Repeated worker polling reuses the exact unresolved preview while its version is current.
  SELECT * INTO q FROM public.stand_up_previews p WHERE p.actor_id=a AND p.report_id=r.id AND p.baseline_id=b.id AND p.incoming_values=p_payload->'values' AND p.expected_version=r.version
   AND NOT EXISTS(SELECT 1 FROM public.stand_up_recovery_decisions d WHERE d.preview_id=p.id) ORDER BY p.created_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('preview_id',q.id,'facility_id',r.facility_id,'week_start',r.week_start,'expected_version',q.expected_version,'merged',q.merged,'conflicts',q.conflicts,'clears',q.clears,'baseline',b.values,'current',r.values,'incoming',q.incoming_values); END IF;
  merged:=r.values;
  FOREACH k IN ARRAY haven.stand_up_keys() LOOP
   IF p_payload->'values'->k IS DISTINCT FROM b.values->k THEN
    IF r.values->k IS DISTINCT FROM b.values->k AND r.values->k IS DISTINCT FROM p_payload->'values'->k THEN conflicts:=conflicts||to_jsonb(k);
    ELSE merged:=jsonb_set(merged,ARRAY[k],p_payload->'values'->k); END IF;
    IF p_payload->'values'->k='null'::jsonb AND r.values->k<>'null'::jsonb THEN clears:=clears||to_jsonb(k); END IF;
   END IF;
  END LOOP;
  INSERT INTO public.stand_up_previews(actor_id,report_id,baseline_id,expected_version,incoming_values,merged,conflicts,clears) VALUES(a,r.id,b.id,r.version,p_payload->'values',merged,conflicts,clears) RETURNING id INTO v;
  RETURN jsonb_build_object('preview_id',v,'facility_id',r.facility_id,'week_start',r.week_start,'expected_version',r.version,'merged',merged,'conflicts',conflicts,'clears',clears,'baseline',b.values,'current',r.values,'incoming',p_payload->'values');
 ELSIF p_action='commit_recovery' THEN
  SELECT * INTO q FROM public.stand_up_previews WHERE id=(p_payload->>'preview_id')::uuid AND actor_id=a FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown preview'; END IF;
  SELECT * INTO r FROM public.stand_up_reports WHERE id=q.report_id;
  SELECT * INTO b FROM public.stand_up_revisions WHERE id=q.baseline_id;
  PERFORM haven.stand_up_assert(r.facility_id);
  merged:=q.merged;
  IF jsonb_typeof(coalesce(p_payload->'resolutions','{}'))<>'object' THEN RAISE EXCEPTION 'Invalid resolutions'; END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(p_payload->'resolutions','{}')) LOOP IF NOT (q.conflicts ? k OR q.clears ? k) THEN RAISE EXCEPTION 'Resolution is not a previewed conflict or clear'; END IF; END LOOP;
  FOR k IN SELECT jsonb_array_elements_text(q.conflicts) LOOP
   IF NOT coalesce(p_payload->'resolutions','{}') ? k THEN RAISE EXCEPTION 'Resolve all previewed conflicts'; END IF;
   IF p_payload->'resolutions'->k='null'::jsonb AND (p_payload->>'confirm_clears') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit clear confirmation required'; END IF;
   merged:=jsonb_set(merged,ARRAY[k],p_payload->'resolutions'->k);
  END LOOP;
  FOR k IN SELECT jsonb_array_elements_text(q.clears) LOOP
   IF coalesce(p_payload->'resolutions','{}') ? k THEN merged:=jsonb_set(merged,ARRAY[k],p_payload->'resolutions'->k); END IF;
  END LOOP;
  FOREACH k IN ARRAY haven.stand_up_keys() LOOP
   IF merged->k='null'::jsonb AND r.values->k<>'null'::jsonb AND (p_payload->>'confirm_clears') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit clear confirmation required'; END IF;
  END LOOP;
  SELECT result INTO saved FROM public.stand_up_recovery_decisions WHERE preview_id=q.id;
  IF FOUND THEN
   IF saved->'values' IS DISTINCT FROM merged THEN RAISE EXCEPTION 'Recovery decision already committed with different values'; END IF;
   RETURN saved;
  END IF;
  saved:=haven.stand_up_save(jsonb_build_object('facility_id',r.facility_id,'week_start',r.week_start,'expected_version',q.expected_version,'request_id',p_payload->>'request_id','values',merged,'status','draft','as_of',CASE WHEN p_payload ? 'as_of' THEN p_payload->>'as_of' ELSE b.source_as_of::text END,'reason',coalesce(p_payload->>'reason','Outage recovery from reviewed baseline'),'provenance',jsonb_build_object('baseline_id',q.baseline_id,'preview_id',q.id)));
  INSERT INTO public.stand_up_recovery_decisions(preview_id,actor_id,result) VALUES(q.id,haven.authorized_user_id(),saved);
  RETURN saved;
 ELSIF p_action='stage_import' THEN
  IF haven.app_role()::text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Historical imports require organization administrator' USING ERRCODE='42501'; END IF;
  IF nullif(btrim(p_payload->>'reason'),'') IS NULL OR p_payload->>'request_id' IS NULL OR jsonb_typeof(p_payload->'provenance') IS DISTINCT FROM 'object' OR p_payload->'provenance'='{}'::jsonb THEN RAISE EXCEPTION 'Import requires request, reason and source provenance'; END IF;
  IF coalesce(p_payload->'issues','[]')<>'[]'::jsonb THEN RAISE EXCEPTION 'Resolve all source issues before staging'; END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Import needs 1 to 500 rows'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'rows') x GROUP BY x->>'facility_id',x->>'week_start' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate facility/week in import'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
   PERFORM haven.stand_up_assert((row->>'facility_id')::uuid,true); PERFORM haven.stand_up_validate(row->'values');
   IF row->>'week_start' IS NULL OR extract(isodow FROM (row->>'week_start')::date)<>1 OR row->>'expected_version' IS NULL OR (row->>'expected_version')::integer<0 THEN RAISE EXCEPTION 'Import needs Monday and expected version'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(a::text||(p_payload->>'request_id'),0));
  IF haven.authorized_user_id() IS DISTINCT FROM a OR haven.app_role()::text NOT IN('owner','org_admin') THEN RAISE EXCEPTION 'Import access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO batch FROM public.stand_up_batches WHERE actor_id=a AND request_id=(p_payload->>'request_id')::uuid;
  IF FOUND THEN IF batch.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'Idempotency key payload differs'; END IF;
  ELSE INSERT INTO public.stand_up_batches(actor_id,organization_id,request_id,payload) VALUES(a,o,(p_payload->>'request_id')::uuid,p_payload) RETURNING * INTO batch; END IF;
  RETURN jsonb_build_object('batch_id',batch.id,'rows',batch.payload->'rows');
 ELSIF p_action IN('commit_import','reverse_import') THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('stand_up_org:'||o::text,0));
  SELECT * INTO batch FROM public.stand_up_batches WHERE id=(p_payload->>'batch_id')::uuid FOR UPDATE;
  IF NOT FOUND OR batch.organization_id IS DISTINCT FROM haven.organization_id() OR haven.app_role()::text NOT IN('owner','org_admin') OR haven.authorized_user_id() IS NULL THEN RAISE EXCEPTION 'Import access denied' USING ERRCODE='42501'; END IF;
  IF p_action='commit_import' THEN
   IF batch.result IS NOT NULL THEN RETURN batch.result; END IF;
   FOR row IN SELECT value FROM jsonb_array_elements(batch.payload->'rows') ORDER BY value->>'facility_id',value->>'week_start' LOOP
    payload:=row||jsonb_build_object('request_id',gen_random_uuid(),'status','draft','reason',batch.payload->>'reason','provenance',jsonb_build_object('source',batch.payload->'provenance','row',coalesce(row->'provenance','{}')));
    saved:=haven.stand_up_save(payload,batch.id); results:=results||jsonb_build_array(saved);
   END LOOP;
   saved:=jsonb_build_object('batch_id',batch.id,'reports',results); UPDATE public.stand_up_batches SET result=saved WHERE id=batch.id; RETURN saved;
  END IF;
  IF batch.reversal IS NOT NULL THEN RETURN batch.reversal; END IF;
  IF batch.result IS NULL OR nullif(btrim(p_payload->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'Reversal requires committed batch and reason'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(batch.result->'reports') ORDER BY value->>'facility_id',value->>'week_start' LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended((row->>'facility_id')||(row->>'week_start'),0));
   SELECT * INTO r FROM public.stand_up_reports WHERE id=(row->>'id')::uuid FOR UPDATE;
   PERFORM haven.stand_up_assert(r.facility_id,true);
   IF r.revision_id IS DISTINCT FROM (row->>'revision_id')::uuid THEN conflicts:=conflicts||jsonb_build_array(jsonb_build_object('report_id',r.id,'reason','Later edits preserved')); CONTINUE; END IF;
   SELECT * INTO old_revision FROM public.stand_up_revisions WHERE report_id=r.id AND version=r.version-1;
   IF NOT FOUND THEN SELECT jsonb_object_agg(key,'null'::jsonb) INTO merged FROM unnest(haven.stand_up_keys()) key; ELSE merged:=old_revision.values; END IF;
   saved:=haven.stand_up_save(jsonb_build_object('facility_id',r.facility_id,'week_start',r.week_start,'expected_version',r.version,'request_id',gen_random_uuid(),'values',merged,'status',coalesce(old_revision.status,'draft'),'as_of',old_revision.source_as_of,'reason',p_payload->>'reason','provenance',jsonb_build_object('reverses_batch_id',batch.id,'reverses_revision_id',r.revision_id)));
   results:=results||jsonb_build_array(saved);
  END LOOP;
  saved:=jsonb_build_object('batch_id',batch.id,'restored',results,'conflicts',conflicts,'reason',p_payload->>'reason','actor_id',haven.authorized_user_id()); UPDATE public.stand_up_batches SET reversal=saved WHERE id=batch.id; RETURN saved;
 END IF;
 RAISE EXCEPTION 'Unknown Stand Up action';
END $$;
CREATE FUNCTION public.stand_up_command(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.stand_up_command(p_action,p_payload) $$;
CREATE TABLE public.stand_up_export_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid NOT NULL,source_identity text NOT NULL,exported_at timestamptz NOT NULL DEFAULT clock_timestamp(),sequence bigint NOT NULL);
CREATE FUNCTION haven.stand_up_export_aggregate(p_organization_id uuid,p_week_start date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE seq bigint; result jsonb;
BEGIN
 -- One SQL snapshot pairs the watermark with exactly the visible reports.
 SELECT coalesce((SELECT max(v.sequence) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE r.organization_id=p_organization_id),0),
 jsonb_build_object('reports',coalesce((SELECT jsonb_agg(jsonb_build_object('facility_id',r.facility_id,'facility_name',f.name,'week_start',r.week_start,'version',r.version,'revision_id',r.revision_id,'values',r.values,'status',r.status,'updated_at',r.updated_at,'source_as_of',r.source_as_of) ORDER BY r.week_start,r.facility_id) FROM public.stand_up_reports r JOIN public.facilities f ON f.id=r.facility_id WHERE r.organization_id=p_organization_id AND f.deleted_at IS NULL AND (p_week_start IS NULL OR r.week_start=p_week_start)),'[]'),
 'facilities',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM public.facilities WHERE organization_id=p_organization_id AND deleted_at IS NULL),'[]')) INTO seq,result;
 result:=result||jsonb_build_object('sequence',seq);
 INSERT INTO public.stand_up_export_audit(organization_id,source_identity,sequence) VALUES(p_organization_id,'stand_up_aggregate_service',seq); RETURN result;
END $$;
CREATE FUNCTION public.stand_up_export_aggregate(p_organization_id uuid,p_week_start date DEFAULT NULL) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.stand_up_export_aggregate(p_organization_id,p_week_start) $$;
DO $$ DECLARE t text; fn record; BEGIN
 FOREACH t IN ARRAY ARRAY['stand_up_reports','stand_up_revisions','stand_up_receipts','stand_up_previews','stand_up_recovery_decisions','stand_up_batches','stand_up_export_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOR fn IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='haven'::regnamespace AND proname LIKE 'stand_up_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.signature); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.stand_up_command(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.stand_up_command(text,jsonb),haven.stand_up_command(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.stand_up_export_aggregate(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stand_up_export_aggregate(uuid,date),haven.stand_up_export_aggregate(uuid,date) TO service_role;
COMMIT;
