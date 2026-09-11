BEGIN;

-- COL-159 / HFO-22: connect dietary, facility services and general admin
-- evidence. The complete AL coverage pass for the twenty-one items assigned
-- to this issue on the COL-147 source-link mechanism (346) with the COL-154
-- adapters (347). Three tables carry four adapters: the 347 asset_observations
-- table widened by two AED kinds (operation check, equipment currency; one
-- record satisfies one component), a new facility_service_records table for
-- inspections, cleanings and maintenance actions performed on one occasion
-- against the site (facility-service) or a named asset (asset-service) by a
-- staff member or a site-linked vendor, and a new dietary_records table for
-- meal-level substitutions, dietitian menu approval and the emergency food
-- supply check. Every record is final by command only, versioned on
-- correction, voided with a reason, delivered through 346 in the same
-- transaction, and refused by name when its kind, subject, performer,
-- certificate or instant is wrong. A service record never writes an asset's
-- service dates or status, a building-profile inspection date, the licence
-- expiry, a vault document or a maintenance ticket (a stated next-due date is
-- a record column, not a rule). Review activities (AL-D11, AL-A07-01/02,
-- AL-A08-01/02) and the human-path items (AL-D01, D02, D03, D16, W03, M10,
-- Y06, Y07: recorded through 341 with their question named) are never
-- allowlisted. Nothing sends or publishes outbound content. No Homewood rule,
-- day, time, threshold, reading definition, equipment list or deadline is set
-- (Q09, Q11, Q14, Q28 open); no occurrence, schedule, binding, applicability,
-- reminder or UI is created or activated.

-- ---------------------------------------------------------------------------
-- Shared helpers: kind/asset-type checks, a statement builder that carries a
-- vendor performer, site-local dates, current vendor and document references.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_observation_kind_problem(p_kind text,p_asset_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
  WHEN p_kind='generator_test' AND p_asset_type<>'generator' THEN 'A generator test is recorded against a generator'
  WHEN p_kind='extinguisher_check' AND p_asset_type<>'fire_extinguisher' THEN 'An extinguisher check is recorded against a fire extinguisher'
  WHEN p_kind IN('aed_operation_check','aed_equipment_check') AND p_asset_type<>'aed' THEN 'An AED check is recorded against an AED'
  END
$$;
CREATE FUNCTION haven.operation_source_service_kind_problem(p_kind text,p_asset_type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
  WHEN p_kind='extinguisher_inspection' AND p_asset_type<>'fire_extinguisher' THEN 'An extinguisher inspection is recorded against a fire extinguisher'
  WHEN p_kind='hood_cleaning' AND p_asset_type NOT IN('hood_suppression','kitchen_equipment') THEN 'A hood cleaning is recorded against a hood suppression system or kitchen equipment'
  WHEN p_kind='ac_filter_change' AND p_asset_type<>'ac_unit' THEN 'An AC filter change is recorded against an AC unit'
  END
$$;
CREATE FUNCTION haven.operation_source_service_is_asset_kind(p_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT p_kind IN('extinguisher_inspection','hood_cleaning','ac_filter_change') $$;
CREATE FUNCTION haven.operation_source_service_label(p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_kind WHEN 'fire_safety_inspection' THEN 'A fire safety inspection' WHEN 'fire_inspection' THEN 'A fire inspection' WHEN 'sprinkler_inspection' THEN 'A sprinkler inspection'
  WHEN 'extinguisher_inspection' THEN 'An extinguisher inspection' WHEN 'hood_cleaning' THEN 'A hood cleaning' WHEN 'ac_filter_change' THEN 'An AC filter change' END
$$;
-- The 341 statement with any performer shape (self, other_staff or vendor). Late wins over on-behalf, as 344 requires.
CREATE FUNCTION haven.operation_source_statement_for(p_performed timestamptz,p_reference timestamptz,p_performer jsonb,p_entry_reason text,p_outcome text,p_readings jsonb,p_note text,p_issue text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'performed_at',p_performed,
  'performer',jsonb_strip_nulls(p_performer),
  'entry_kind',CASE WHEN p_performed<p_reference-interval '15 minutes' THEN 'late' WHEN p_performer->>'kind'<>'self' THEN 'on_behalf' ELSE 'routine' END,
  'entry_reason',p_entry_reason,
  'outcome',p_outcome,
  'values',coalesce(p_readings,'{}'::jsonb),
  'note',p_note,
  'issue',CASE WHEN p_issue IS NULL THEN NULL ELSE jsonb_build_object('kind',CASE WHEN p_outcome='failed' THEN 'failed_result' ELSE 'problem' END,'summary',p_issue) END))
$$;
CREATE FUNCTION haven.operation_source_local_date(p_at timestamptz,p_facility uuid) RETURNS date
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (p_at AT TIME ZONE coalesce((SELECT f.timezone FROM public.facilities f WHERE f.id=p_facility),'America/New_York'))::date
$$;
-- A vendor performer is an existing vendor of the organisation linked to the site, exactly as a hand recording requires (344); no vendor is created here.
CREATE FUNCTION haven.operation_source_vendor_linked(p_vendor uuid,p_org uuid,p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.vendors vv JOIN public.vendor_facilities vf ON vf.vendor_id=vv.id AND vf.facility_id=p_facility AND vf.deleted_at IS NULL
  WHERE vv.id=p_vendor AND vv.organization_id=p_org AND vv.deleted_at IS NULL)
$$;
-- A referenced certificate or approval document is a current (not deleted, not archived) vault document of the same site; the record never changes it.
CREATE FUNCTION haven.operation_source_document_current(p_document uuid,p_org uuid,p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.facility_documents d WHERE d.id=p_document AND d.organization_id=p_org AND d.facility_id=p_facility AND d.deleted_at IS NULL AND d.archived_at IS NULL)
$$;
CREATE FUNCTION haven.operation_source_date(p_payload jsonb,p_key text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF NOT (p_payload ? p_key) OR jsonb_typeof(p_payload->p_key)='null' THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_payload->p_key)<>'string' OR (p_payload->>p_key) !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '% must be a calendar date',p_key USING ERRCODE='22023'; END IF;
 RETURN (p_payload->>p_key)::date;
EXCEPTION WHEN invalid_parameter_value THEN RAISE; WHEN OTHERS THEN RAISE EXCEPTION '% must be a calendar date',p_key USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION haven.operation_source_observation_kind_problem(text,text),haven.operation_source_service_kind_problem(text,text),haven.operation_source_service_is_asset_kind(text),haven.operation_source_service_label(text),
 haven.operation_source_statement_for(timestamptz,timestamptz,jsonb,text,text,jsonb,text,text),haven.operation_source_local_date(timestamptz,uuid),haven.operation_source_vendor_linked(uuid,uuid,uuid),
 haven.operation_source_document_current(uuid,uuid,uuid),haven.operation_source_date(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;

-- Review F2: a corrected version that matches no occurrence while its earlier version still satisfies one would leave that occurrence completed on
-- evidence the record no longer states. 346 invalidates only when a candidate exists, so the 348 commands refuse such a correction outright (the
-- transaction rolls back: record, delivery and request untouched) and the person voids and re-records. A conflict keeps the COL-154 3k(xi) policy.
CREATE FUNCTION haven.operation_source_record_effective(p_org uuid,p_source_key text,p_record_id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.operation_execution_receipts r WHERE r.organization_id=p_org AND r.source_key=p_source_key AND r.source_record_id=p_record_id
  AND r.receipt_kind='performance' AND r.superseded_by_receipt_id IS NULL AND r.source_event_id IS NOT NULL)
$$;
CREATE FUNCTION haven.operation_source_correction_unmatched(p_had_receipt boolean,p_delivery jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_had_receipt AND p_delivery->'event'->>'state'='unmatched' THEN
  RAISE EXCEPTION 'Corrected record no longer matches the occurrence it satisfied; void the record and record it again' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION haven.operation_source_record_effective(uuid,text,text),haven.operation_source_correction_unmatched(boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- asset_observations (347) widened: two AED kinds. The reader and the record
-- and correct commands are replaced in place with the wider kind list; the
-- void command, guard, ledger and grants are unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE public.asset_observations DROP CONSTRAINT asset_observations_observation_kind_check;
ALTER TABLE public.asset_observations ADD CONSTRAINT asset_observations_observation_kind_check
 CHECK(observation_kind IN('generator_test','carbon_monoxide_check','extinguisher_check','aed_operation_check','aed_equipment_check'));

CREATE OR REPLACE FUNCTION haven.operation_source_read_asset_observation(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.asset_observations; rid uuid; act uuid; fin text;
BEGIN
 BEGIN rid:=p_id::uuid; EXCEPTION WHEN OTHERS THEN RETURN '{"exists":false}'::jsonb; END;
 SELECT * INTO r FROM public.asset_observations WHERE id=rid;
 IF NOT FOUND THEN RETURN '{"exists":false}'::jsonb; END IF;
 fin:=CASE WHEN r.voided_at IS NOT NULL OR r.deleted_at IS NOT NULL THEN 'voided' ELSE 'final' END;
 act:=haven.operation_source_activity_by_key(r.organization_id,CASE r.observation_kind WHEN 'generator_test' THEN 'hfo-al-w01-01' WHEN 'carbon_monoxide_check' THEN 'hfo-al-w01-02' WHEN 'extinguisher_check' THEN 'hfo-al-a07-03'
  WHEN 'aed_operation_check' THEN 'hfo-al-w04-01' WHEN 'aed_equipment_check' THEN 'hfo-al-w04-02' END);
 IF act IS NULL THEN RAISE EXCEPTION 'Observation kind % has no checklist activity in this organisation',r.observation_kind; END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('exists',true,'version',r.record_version::text,'finality',fin,'facility_id',r.facility_id,'activity_id',act,
  'subject',jsonb_build_object('kind','asset','id',r.asset_id),'recorded_by',r.version_recorded_by,'recorded_at',r.finalized_at,
  'statement',CASE WHEN fin='voided' THEN NULL ELSE haven.operation_source_statement(r.observed_at,r.finalized_at,r.version_recorded_by,r.observed_by,r.entry_reason,
   CASE r.outcome WHEN 'pass' THEN 'performed' ELSE 'failed' END,r.readings,r.note,r.issue_summary) END));
END $$;

CREATE OR REPLACE FUNCTION haven.record_asset_observation(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; facility uuid; asset_id uuid; asset public.facility_assets; kind text; basis text; observed_at timestamptz; observed_by uuid; outcome text; readings jsonb; issue text; note text; entry text;
 org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; r public.asset_observations; delivery jsonb; problem text;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Observation payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('facility_id','asset_id','observation_kind','observed_at','basis','observed_by','outcome','readings','issue_summary','note','entry_reason') THEN
   RAISE EXCEPTION 'Observation field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 facility:=haven.operation_source_uuid(p_payload,'facility_id'); IF facility IS NULL THEN RAISE EXCEPTION 'facility_id is required' USING ERRCODE='22023'; END IF;
 asset_id:=haven.operation_source_uuid(p_payload,'asset_id'); IF asset_id IS NULL THEN RAISE EXCEPTION 'asset_id is required' USING ERRCODE='22023'; END IF;
 kind:=p_payload->>'observation_kind';
 IF kind IS NULL OR kind NOT IN('generator_test','carbon_monoxide_check','extinguisher_check','aed_operation_check','aed_equipment_check') THEN
  RAISE EXCEPTION 'observation_kind must be generator_test, carbon_monoxide_check, extinguisher_check, aed_operation_check or aed_equipment_check' USING ERRCODE='22023'; END IF;
 basis:=coalesce(p_payload->>'basis','');
 IF basis='automatic_self_test' THEN RAISE EXCEPTION 'An automatic self-test is not a staff observation; record only what a staff member observed' USING ERRCODE='22023';
 ELSIF basis='photo_only' THEN RAISE EXCEPTION 'A photo alone is not a staff observation; record only what a staff member observed' USING ERRCODE='22023';
 ELSIF basis<>'staff_observed' THEN RAISE EXCEPTION 'basis must be staff_observed' USING ERRCODE='22023'; END IF;
 observed_at:=haven.operation_occurrence_timestamp(p_payload->'observed_at');
 IF observed_at IS NULL THEN RAISE EXCEPTION 'observed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 observed_by:=haven.operation_source_uuid(p_payload,'observed_by');
 outcome:=p_payload->>'outcome';
 IF outcome IS NULL OR outcome NOT IN('pass','fail') THEN RAISE EXCEPTION 'outcome must be pass or fail' USING ERRCODE='22023'; END IF;
 readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb);
 problem:=haven.operation_source_readings_problem(readings); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 issue:=haven.operation_source_text(p_payload,'issue_summary',2000); note:=haven.operation_source_text(p_payload,'note',4000); entry:=haven.operation_source_text(p_payload,'entry_reason',2000);
 actor:=haven.operation_source_record_actor(facility);
 org:=haven.organization_id();
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 hash:=encode(sha256(convert_to(jsonb_build_object('action','record','actor',actor,'payload',jsonb_build_object('facility_id',facility,'asset_id',asset_id,'observation_kind',kind,'basis',basis,'observed_at',p_payload->'observed_at',
  'observed_by',observed_by,'outcome',outcome,'readings',readings,'issue_summary',issue,'note',note,'entry_reason',entry))::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 now_at:=clock_timestamp();
 SELECT * INTO asset FROM public.facility_assets WHERE id=asset_id AND organization_id=org AND facility_id=facility AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR asset.status='retired' THEN RAISE EXCEPTION 'Asset is not current at this site' USING ERRCODE='22023'; END IF;
 problem:=haven.operation_source_observation_kind_problem(kind,asset.asset_type); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 observed_by:=coalesce(observed_by,actor);
 IF observed_by<>actor AND NOT haven.operation_source_staff_current(observed_by,org,facility,now_at) THEN RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 problem:=haven.operation_source_entry_problem(observed_at,now_at,false,observed_by<>actor,entry,outcome='fail',issue);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 INSERT INTO public.asset_observations(organization_id,facility_id,asset_id,observation_kind,basis,observed_at,observed_by,outcome,readings,issue_summary,note,entry_reason,
  finalized_at,finalized_by,version_recorded_at,version_recorded_by,created_by,updated_by)
 VALUES(org,facility,asset_id,kind,basis,observed_at,observed_by,outcome,readings,issue,note,entry,now_at,actor,now_at,actor,actor,actor) RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'asset-observation',r.id::text,r.record_version::text,'final',facility);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,facility,'asset-observation',r.id::text,'record',to_jsonb(r),delivery);
END $$;

CREATE OR REPLACE FUNCTION haven.correct_asset_observation(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.asset_observations; n public.asset_observations; asset public.facility_assets; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text; had_receipt boolean;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'An expected record version is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Correction payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('reason','asset_id','observed_at','observed_by','outcome','readings','issue_summary','note','entry_reason') THEN RAISE EXCEPTION 'Correction field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A correction reason is required' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'observed_at' AND haven.operation_occurrence_timestamp(p_payload->'observed_at') IS NULL THEN RAISE EXCEPTION 'observed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'outcome' AND (p_payload->>'outcome') NOT IN('pass','fail') THEN RAISE EXCEPTION 'outcome must be pass or fail' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'readings' THEN problem:=haven.operation_source_readings_problem(p_payload->'readings'); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF; END IF;
 SELECT * INTO r FROM public.asset_observations WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.asset_observations WHERE id=p_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','correct','actor',actor,'record',p_id,'expected_version',p_expected_version,'payload',p_payload)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Observation is voided' USING ERRCODE='P0001'; END IF;
 IF r.record_version<>p_expected_version THEN RAISE EXCEPTION 'Record changed since it was read' USING ERRCODE='P0001',DETAIL='current_record_version='||r.record_version; END IF;
 now_at:=clock_timestamp();
 n:=r;
 IF p_payload ? 'asset_id' THEN n.asset_id:=haven.operation_source_uuid(p_payload,'asset_id'); IF n.asset_id IS NULL THEN RAISE EXCEPTION 'asset_id is required' USING ERRCODE='22023'; END IF; END IF;
 IF p_payload ? 'observed_at' THEN n.observed_at:=haven.operation_occurrence_timestamp(p_payload->'observed_at'); END IF;
 IF p_payload ? 'observed_by' THEN n.observed_by:=coalesce(haven.operation_source_uuid(p_payload,'observed_by'),actor); END IF;
 IF n.observed_by IS DISTINCT FROM r.observed_by AND NOT (p_payload ? 'entry_reason') THEN n.entry_reason:=NULL; END IF;
 IF p_payload ? 'outcome' THEN n.outcome:=p_payload->>'outcome'; END IF;
 IF p_payload ? 'readings' THEN n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb); END IF;
 IF p_payload ? 'issue_summary' THEN n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); END IF;
 IF p_payload ? 'note' THEN n.note:=haven.operation_source_text(p_payload,'note',4000); END IF;
 IF p_payload ? 'entry_reason' THEN n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000); END IF;
 IF (n.asset_id,n.observed_at,n.observed_by,n.outcome,n.readings,n.issue_summary,n.note,n.entry_reason) IS NOT DISTINCT FROM (r.asset_id,r.observed_at,r.observed_by,r.outcome,r.readings,r.issue_summary,r.note,r.entry_reason) THEN
  RAISE EXCEPTION 'A correction must restate at least one field' USING ERRCODE='22023'; END IF;
 SELECT * INTO asset FROM public.facility_assets WHERE id=n.asset_id AND organization_id=org AND facility_id=r.facility_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR asset.status='retired' THEN RAISE EXCEPTION 'Asset is not current at this site' USING ERRCODE='22023'; END IF;
 problem:=haven.operation_source_observation_kind_problem(n.observation_kind,asset.asset_type); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 IF n.observed_by<>actor AND NOT haven.operation_source_staff_current(n.observed_by,org,r.facility_id,now_at) THEN RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 problem:=haven.operation_source_entry_problem(n.observed_at,r.finalized_at,true,n.observed_by<>actor,n.entry_reason,n.outcome='fail',n.issue_summary);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 had_receipt:=haven.operation_source_record_effective(org,'asset-observation',p_id::text);
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.asset_observations SET asset_id=n.asset_id,observed_at=n.observed_at,observed_by=n.observed_by,outcome=n.outcome,readings=n.readings,issue_summary=n.issue_summary,note=n.note,entry_reason=n.entry_reason,
  correction_reason=reason,version_recorded_at=now_at,version_recorded_by=actor,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'asset-observation',r.id::text,r.record_version::text,'final',r.facility_id);
 PERFORM haven.operation_source_correction_unmatched(had_receipt,delivery);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'asset-observation',r.id::text,'correct',to_jsonb(r),delivery);
END $$;

-- ---------------------------------------------------------------------------
-- facility_service_records: one inspection, cleaning or maintenance action on
-- one occasion against the site or one named asset, by staff or a site-linked
-- vendor, recorded final by command only. The stated next-due date and the
-- certificate reference are read-only record columns: nothing here writes an
-- asset, a profile date, a document or a ticket.
-- ---------------------------------------------------------------------------
CREATE TABLE public.facility_service_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 service_kind text NOT NULL CHECK(service_kind IN('fire_safety_inspection','fire_inspection','sprinkler_inspection','extinguisher_inspection','hood_cleaning','ac_filter_change')),
 asset_id uuid REFERENCES public.facility_assets(id),
 performed_at timestamptz NOT NULL,
 performer_kind text NOT NULL CHECK(performer_kind IN('staff','vendor')),
 performed_by uuid REFERENCES public.user_profiles(id),
 vendor_id uuid REFERENCES public.vendors(id),
 performer_label text CHECK(performer_label IS NULL OR length(btrim(performer_label)) BETWEEN 1 AND 200),
 outcome text NOT NULL CHECK(outcome IN('pass','fail')),
 readings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(readings)='object'),
 issue_summary text CHECK(issue_summary IS NULL OR length(btrim(issue_summary)) BETWEEN 1 AND 2000),
 next_due_on date,
 certificate_document_id uuid REFERENCES public.facility_documents(id),
 note text CHECK(note IS NULL OR length(btrim(note)) BETWEEN 1 AND 4000),
 entry_reason text CHECK(entry_reason IS NULL OR length(btrim(entry_reason)) BETWEEN 1 AND 2000),
 correction_reason text CHECK(correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 2000),
 record_version integer NOT NULL DEFAULT 1 CHECK(record_version>=1),
 finalized_at timestamptz NOT NULL,
 finalized_by uuid NOT NULL REFERENCES public.user_profiles(id),
 version_recorded_at timestamptz NOT NULL,
 version_recorded_by uuid NOT NULL REFERENCES public.user_profiles(id),
 voided_at timestamptz,
 voided_by uuid REFERENCES public.user_profiles(id),
 void_reason text CHECK(void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES public.user_profiles(id),
 updated_by uuid REFERENCES public.user_profiles(id),
 deleted_at timestamptz,
 CONSTRAINT facility_service_records_subject_shape CHECK((service_kind IN('fire_safety_inspection','fire_inspection','sprinkler_inspection') AND asset_id IS NULL) OR (service_kind IN('extinguisher_inspection','hood_cleaning','ac_filter_change') AND asset_id IS NOT NULL)),
 CONSTRAINT facility_service_records_performer_shape CHECK((performer_kind='staff' AND performed_by IS NOT NULL AND vendor_id IS NULL AND performer_label IS NULL) OR (performer_kind='vendor' AND vendor_id IS NOT NULL AND performed_by IS NULL)),
 CONSTRAINT facility_service_records_failed_issue CHECK(outcome<>'fail' OR issue_summary IS NOT NULL),
 CONSTRAINT facility_service_records_voided_shape CHECK(((voided_at IS NULL)=(voided_by IS NULL)) AND ((voided_at IS NULL)=(void_reason IS NULL)))
);
CREATE INDEX idx_facility_service_records_site_kind ON public.facility_service_records(organization_id,facility_id,service_kind,performed_at DESC);
CREATE INDEX idx_facility_service_records_asset ON public.facility_service_records(asset_id,performed_at DESC) WHERE asset_id IS NOT NULL AND voided_at IS NULL;

CREATE FUNCTION haven.guard_facility_service_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE content_changed boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Service records are retained history; void with a reason' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_source_record_approved() THEN RAISE EXCEPTION 'Use the service record commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=NEW.facility_id AND f.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Service record site is not in this organisation' USING ERRCODE='23514'; END IF;
  IF NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=NEW.asset_id AND a.organization_id=NEW.organization_id AND a.facility_id=NEW.facility_id) THEN
   RAISE EXCEPTION 'Service record asset is not at this site' USING ERRCODE='23514'; END IF;
  IF NEW.voided_at IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.correction_reason IS NOT NULL THEN RAISE EXCEPTION 'A new service record is final and not voided' USING ERRCODE='23514'; END IF;
  NEW.record_version:=1;
  RETURN NEW;
 END IF;
 IF (OLD.id,OLD.organization_id,OLD.facility_id,OLD.service_kind,OLD.created_at,OLD.created_by,OLD.finalized_at,OLD.finalized_by) IS DISTINCT FROM (NEW.id,NEW.organization_id,NEW.facility_id,NEW.service_kind,NEW.created_at,NEW.created_by,NEW.finalized_at,NEW.finalized_by) THEN
  RAISE EXCEPTION 'Service record identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'Service records are voided, not deleted' USING ERRCODE='23514'; END IF;
 content_changed:=(OLD.asset_id,OLD.performed_at,OLD.performer_kind,OLD.performed_by,OLD.vendor_id,OLD.performer_label,OLD.outcome,OLD.readings,OLD.issue_summary,OLD.next_due_on,OLD.certificate_document_id,OLD.note,OLD.entry_reason)
  IS DISTINCT FROM (NEW.asset_id,NEW.performed_at,NEW.performer_kind,NEW.performed_by,NEW.vendor_id,NEW.performer_label,NEW.outcome,NEW.readings,NEW.issue_summary,NEW.next_due_on,NEW.certificate_document_id,NEW.note,NEW.entry_reason);
 IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Voided service records are immutable' USING ERRCODE='23514'; END IF;
 IF content_changed AND (NEW.version_recorded_at,NEW.version_recorded_by) IS NOT DISTINCT FROM (OLD.version_recorded_at,OLD.version_recorded_by) THEN
  RAISE EXCEPTION 'A correction records who restated the service record' USING ERRCODE='23514'; END IF;
 IF content_changed AND NEW.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=NEW.asset_id AND a.organization_id=NEW.organization_id AND a.facility_id=NEW.facility_id) THEN
  RAISE EXCEPTION 'Service record asset is not at this site' USING ERRCODE='23514'; END IF;
 NEW.record_version:=CASE WHEN content_changed THEN OLD.record_version+1 ELSE OLD.record_version END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_facility_service_record() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER facility_service_record_guard BEFORE INSERT OR UPDATE OR DELETE ON public.facility_service_records FOR EACH ROW EXECUTE FUNCTION haven.guard_facility_service_record();
CREATE TRIGGER facility_service_records_no_truncate BEFORE TRUNCATE ON public.facility_service_records FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER facility_service_records_set_updated_at BEFORE UPDATE ON public.facility_service_records FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER facility_service_records_audit AFTER INSERT OR UPDATE OR DELETE ON public.facility_service_records FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.facility_service_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_service_records FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.facility_service_records TO authenticated,service_role;
CREATE POLICY facility_service_records_read ON public.facility_service_records FOR SELECT TO authenticated USING(organization_id=haven.organization_id() AND haven.operation_facility_access(facility_id));

-- ---------------------------------------------------------------------------
-- dietary_records: a meal-level substitution (service date + meal period,
-- no resident), a dietitian menu approval (labels verbatim, optional vault
-- reference) or the emergency food supply check, recorded final by command.
-- ---------------------------------------------------------------------------
CREATE TABLE public.dietary_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 record_kind text NOT NULL CHECK(record_kind IN('meal_substitution','menu_approval','emergency_food_supply_check')),
 performed_at timestamptz NOT NULL,
 performed_by uuid NOT NULL REFERENCES public.user_profiles(id),
 outcome text NOT NULL CHECK(outcome IN('performed','failed')),
 service_date date,
 meal_period text CHECK(meal_period IS NULL OR meal_period IN('breakfast','lunch','dinner','snack_am','snack_pm','snack_hs')),
 planned_item text CHECK(planned_item IS NULL OR length(btrim(planned_item)) BETWEEN 1 AND 200),
 substitute_item text CHECK(substitute_item IS NULL OR length(btrim(substitute_item)) BETWEEN 1 AND 200),
 substitution_reason text CHECK(substitution_reason IS NULL OR length(btrim(substitution_reason)) BETWEEN 1 AND 2000),
 meal_service_id uuid REFERENCES public.meal_services(id),
 menu_label text CHECK(menu_label IS NULL OR length(btrim(menu_label)) BETWEEN 1 AND 200),
 approver_label text CHECK(approver_label IS NULL OR length(btrim(approver_label)) BETWEEN 1 AND 200),
 approval_document_id uuid REFERENCES public.facility_documents(id),
 readings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(readings)='object'),
 issue_summary text CHECK(issue_summary IS NULL OR length(btrim(issue_summary)) BETWEEN 1 AND 2000),
 note text CHECK(note IS NULL OR length(btrim(note)) BETWEEN 1 AND 4000),
 entry_reason text CHECK(entry_reason IS NULL OR length(btrim(entry_reason)) BETWEEN 1 AND 2000),
 correction_reason text CHECK(correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 2000),
 record_version integer NOT NULL DEFAULT 1 CHECK(record_version>=1),
 finalized_at timestamptz NOT NULL,
 finalized_by uuid NOT NULL REFERENCES public.user_profiles(id),
 version_recorded_at timestamptz NOT NULL,
 version_recorded_by uuid NOT NULL REFERENCES public.user_profiles(id),
 voided_at timestamptz,
 voided_by uuid REFERENCES public.user_profiles(id),
 void_reason text CHECK(void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES public.user_profiles(id),
 updated_by uuid REFERENCES public.user_profiles(id),
 deleted_at timestamptz,
 CONSTRAINT dietary_records_kind_shape CHECK(
  (record_kind='meal_substitution' AND service_date IS NOT NULL AND meal_period IS NOT NULL AND planned_item IS NOT NULL AND substitute_item IS NOT NULL AND substitution_reason IS NOT NULL AND menu_label IS NULL AND approver_label IS NULL AND approval_document_id IS NULL AND outcome='performed')
  OR (record_kind='menu_approval' AND menu_label IS NOT NULL AND approver_label IS NOT NULL AND service_date IS NULL AND meal_period IS NULL AND planned_item IS NULL AND substitute_item IS NULL AND substitution_reason IS NULL AND meal_service_id IS NULL AND outcome='performed')
  OR (record_kind='emergency_food_supply_check' AND service_date IS NULL AND meal_period IS NULL AND planned_item IS NULL AND substitute_item IS NULL AND substitution_reason IS NULL AND meal_service_id IS NULL AND menu_label IS NULL AND approver_label IS NULL AND approval_document_id IS NULL)),
 CONSTRAINT dietary_records_failed_issue CHECK(outcome<>'failed' OR issue_summary IS NOT NULL),
 CONSTRAINT dietary_records_voided_shape CHECK(((voided_at IS NULL)=(voided_by IS NULL)) AND ((voided_at IS NULL)=(void_reason IS NULL)))
);
CREATE INDEX idx_dietary_records_site_kind ON public.dietary_records(organization_id,facility_id,record_kind,performed_at DESC);
CREATE INDEX idx_dietary_records_meal ON public.dietary_records(facility_id,service_date,meal_period) WHERE record_kind='meal_substitution' AND voided_at IS NULL;

CREATE FUNCTION haven.guard_dietary_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE content_changed boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dietary records are retained history; void with a reason' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_source_record_approved() THEN RAISE EXCEPTION 'Use the dietary record commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=NEW.facility_id AND f.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Dietary record site is not in this organisation' USING ERRCODE='23514'; END IF;
  IF NEW.voided_at IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.correction_reason IS NOT NULL THEN RAISE EXCEPTION 'A new dietary record is final and not voided' USING ERRCODE='23514'; END IF;
  NEW.record_version:=1;
  RETURN NEW;
 END IF;
 IF (OLD.id,OLD.organization_id,OLD.facility_id,OLD.record_kind,OLD.created_at,OLD.created_by,OLD.finalized_at,OLD.finalized_by) IS DISTINCT FROM (NEW.id,NEW.organization_id,NEW.facility_id,NEW.record_kind,NEW.created_at,NEW.created_by,NEW.finalized_at,NEW.finalized_by) THEN
  RAISE EXCEPTION 'Dietary record identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'Dietary records are voided, not deleted' USING ERRCODE='23514'; END IF;
 content_changed:=(OLD.performed_at,OLD.performed_by,OLD.outcome,OLD.service_date,OLD.meal_period,OLD.planned_item,OLD.substitute_item,OLD.substitution_reason,OLD.meal_service_id,OLD.menu_label,OLD.approver_label,OLD.approval_document_id,OLD.readings,OLD.issue_summary,OLD.note,OLD.entry_reason)
  IS DISTINCT FROM (NEW.performed_at,NEW.performed_by,NEW.outcome,NEW.service_date,NEW.meal_period,NEW.planned_item,NEW.substitute_item,NEW.substitution_reason,NEW.meal_service_id,NEW.menu_label,NEW.approver_label,NEW.approval_document_id,NEW.readings,NEW.issue_summary,NEW.note,NEW.entry_reason);
 IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Voided dietary records are immutable' USING ERRCODE='23514'; END IF;
 IF content_changed AND (NEW.version_recorded_at,NEW.version_recorded_by) IS NOT DISTINCT FROM (OLD.version_recorded_at,OLD.version_recorded_by) THEN
  RAISE EXCEPTION 'A correction records who restated the dietary record' USING ERRCODE='23514'; END IF;
 NEW.record_version:=CASE WHEN content_changed THEN OLD.record_version+1 ELSE OLD.record_version END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_dietary_record() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER dietary_record_guard BEFORE INSERT OR UPDATE OR DELETE ON public.dietary_records FOR EACH ROW EXECUTE FUNCTION haven.guard_dietary_record();
CREATE TRIGGER dietary_records_no_truncate BEFORE TRUNCATE ON public.dietary_records FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER dietary_records_set_updated_at BEFORE UPDATE ON public.dietary_records FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER dietary_records_audit AFTER INSERT OR UPDATE OR DELETE ON public.dietary_records FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.dietary_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dietary_records FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.dietary_records TO authenticated,service_role;
CREATE POLICY dietary_records_read ON public.dietary_records FOR SELECT TO authenticated USING(organization_id=haven.organization_id() AND haven.operation_facility_access(facility_id));

-- ---------------------------------------------------------------------------
-- Readers (346 shape). Executable by no role. A record id that is not a uuid
-- or is unknown is {exists:false}; a voided or soft-deleted record is voided.
-- The two service readers share one table and each raises by name when the
-- kind belongs to the other adapter (a recorded reader_failed if delivered
-- through the wrong key; the commands always choose the right one).
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_service_snapshot(r public.facility_service_records) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE act uuid; fin text; performer jsonb;
BEGIN
 fin:=CASE WHEN r.voided_at IS NOT NULL OR r.deleted_at IS NOT NULL THEN 'voided' ELSE 'final' END;
 act:=haven.operation_source_activity_by_key(r.organization_id,CASE r.service_kind WHEN 'fire_safety_inspection' THEN 'hfo-al-y02-01' WHEN 'fire_inspection' THEN 'hfo-al-y04-01' WHEN 'sprinkler_inspection' THEN 'hfo-al-y04-02'
  WHEN 'extinguisher_inspection' THEN 'hfo-al-y03-01' WHEN 'hood_cleaning' THEN 'hfo-al-y05-01' WHEN 'ac_filter_change' THEN 'hfo-al-m11-01' END);
 IF act IS NULL THEN RAISE EXCEPTION 'Service kind % has no checklist activity in this organisation',r.service_kind; END IF;
 performer:=CASE WHEN r.performer_kind='vendor' THEN jsonb_build_object('kind','vendor','vendor_id',r.vendor_id,'label',r.performer_label)
  WHEN r.performed_by=r.version_recorded_by THEN jsonb_build_object('kind','self') ELSE jsonb_build_object('kind','other_staff','user_id',r.performed_by) END;
 RETURN jsonb_strip_nulls(jsonb_build_object('exists',true,'version',r.record_version::text,'finality',fin,'facility_id',r.facility_id,'activity_id',act,
  'subject',CASE WHEN r.asset_id IS NULL THEN jsonb_build_object('kind','facility') ELSE jsonb_build_object('kind','asset','id',r.asset_id) END,
  'recorded_by',r.version_recorded_by,'recorded_at',r.finalized_at,
  'statement',CASE WHEN fin='voided' THEN NULL ELSE haven.operation_source_statement_for(r.performed_at,r.finalized_at,performer,r.entry_reason,
   CASE r.outcome WHEN 'pass' THEN 'performed' ELSE 'failed' END,r.readings,r.note,r.issue_summary) END));
END $$;
CREATE FUNCTION haven.operation_source_read_facility_service(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.facility_service_records; rid uuid;
BEGIN
 BEGIN rid:=p_id::uuid; EXCEPTION WHEN OTHERS THEN RETURN '{"exists":false}'::jsonb; END;
 SELECT * INTO r FROM public.facility_service_records WHERE id=rid;
 IF NOT FOUND THEN RETURN '{"exists":false}'::jsonb; END IF;
 IF haven.operation_source_service_is_asset_kind(r.service_kind) THEN RAISE EXCEPTION 'Service kind % is an asset service; it is delivered through the asset-service adapter',r.service_kind; END IF;
 RETURN haven.operation_source_service_snapshot(r);
END $$;
CREATE FUNCTION haven.operation_source_read_asset_service(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.facility_service_records; rid uuid;
BEGIN
 BEGIN rid:=p_id::uuid; EXCEPTION WHEN OTHERS THEN RETURN '{"exists":false}'::jsonb; END;
 SELECT * INTO r FROM public.facility_service_records WHERE id=rid;
 IF NOT FOUND THEN RETURN '{"exists":false}'::jsonb; END IF;
 IF NOT haven.operation_source_service_is_asset_kind(r.service_kind) THEN RAISE EXCEPTION 'Service kind % is a site service; it is delivered through the facility-service adapter',r.service_kind; END IF;
 RETURN haven.operation_source_service_snapshot(r);
END $$;
CREATE FUNCTION haven.operation_source_read_dietary_record(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.dietary_records; rid uuid; act uuid; fin text;
BEGIN
 BEGIN rid:=p_id::uuid; EXCEPTION WHEN OTHERS THEN RETURN '{"exists":false}'::jsonb; END;
 SELECT * INTO r FROM public.dietary_records WHERE id=rid;
 IF NOT FOUND THEN RETURN '{"exists":false}'::jsonb; END IF;
 fin:=CASE WHEN r.voided_at IS NOT NULL OR r.deleted_at IS NOT NULL THEN 'voided' ELSE 'final' END;
 act:=haven.operation_source_activity_by_key(r.organization_id,CASE r.record_kind WHEN 'meal_substitution' THEN 'hfo-al-m08-01' WHEN 'menu_approval' THEN 'hfo-al-y01-01' WHEN 'emergency_food_supply_check' THEN 'hfo-al-m01-01' END);
 IF act IS NULL THEN RAISE EXCEPTION 'Dietary record kind % has no checklist activity in this organisation',r.record_kind; END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('exists',true,'version',r.record_version::text,'finality',fin,'facility_id',r.facility_id,'activity_id',act,
  'subject',jsonb_build_object('kind','facility'),'recorded_by',r.version_recorded_by,'recorded_at',r.finalized_at,
  'statement',CASE WHEN fin='voided' THEN NULL ELSE haven.operation_source_statement(r.performed_at,r.finalized_at,r.version_recorded_by,r.performed_by,r.entry_reason,r.outcome,r.readings,r.note,r.issue_summary) END));
END $$;
REVOKE ALL ON FUNCTION haven.operation_source_service_snapshot(public.facility_service_records),haven.operation_source_read_facility_service(text),haven.operation_source_read_asset_service(text),haven.operation_source_read_dietary_record(text)
 FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Service record commands: record (final), correct, void. Shared content
-- validation runs on the record as it would be after the command, against the
-- original recording act for a correction.
-- ---------------------------------------------------------------------------
-- p_prev is the row before a correction (NULL on record). A certificate is checked when it is first recorded or restated, never re-validated on a
-- correction that leaves it alone: the vault archiving last year's certificate must not freeze the record (review F1). The vendor link is different:
-- 346 re-validates it at every delivery, so it is re-checked here too.
CREATE FUNCTION haven.operation_source_service_problem(n public.facility_service_records,p_prev public.facility_service_records,p_actor uuid,p_reference timestamptz,p_correction boolean,p_now timestamptz) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE asset public.facility_assets; problem text; other boolean;
BEGIN
 IF n.performer_kind NOT IN('staff','vendor') THEN RETURN 'performer_kind must be staff or vendor'; END IF;
 IF haven.operation_source_service_is_asset_kind(n.service_kind) THEN
  IF n.asset_id IS NULL THEN RETURN haven.operation_source_service_label(n.service_kind)||' is recorded against a named asset'; END IF;
  SELECT * INTO asset FROM public.facility_assets WHERE id=n.asset_id AND organization_id=n.organization_id AND facility_id=n.facility_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR asset.status='retired' THEN RETURN 'Asset is not current at this site'; END IF;
  problem:=haven.operation_source_service_kind_problem(n.service_kind,asset.asset_type); IF problem IS NOT NULL THEN RETURN problem; END IF;
 ELSIF n.asset_id IS NOT NULL THEN RETURN haven.operation_source_service_label(n.service_kind)||' is recorded against the site, not an asset'; END IF;
 IF n.performer_kind='vendor' THEN
  IF n.performed_by IS NOT NULL THEN RETURN 'performed_by must be empty for a vendor performer'; END IF;
  IF n.vendor_id IS NULL THEN RETURN 'vendor_id must be set for a vendor performer'; END IF;
  -- The vendor link is re-checked on every version because the 344 statement rules re-check it at every delivery: refusing here keeps the record at its
  -- current version instead of rewriting it under a refused delivery. Re-link the vendor or restate the performer to correct such a record.
  PERFORM 1 FROM public.vendors WHERE id=n.vendor_id FOR SHARE;
  IF NOT haven.operation_source_vendor_linked(n.vendor_id,n.organization_id,n.facility_id) THEN RETURN 'Performer vendor is not linked to this site'; END IF;
  other:=true;
 ELSE
  IF n.vendor_id IS NOT NULL OR n.performer_label IS NOT NULL THEN RETURN 'vendor_id and performer_label must be empty for a staff performer'; END IF;
  IF n.performed_by IS NULL THEN RETURN 'performed_by must name the staff performer'; END IF;
  IF n.performed_by<>p_actor AND NOT haven.operation_source_staff_current(n.performed_by,n.organization_id,n.facility_id,p_now) THEN RETURN 'Performer is not current staff at this site'; END IF;
  other:=n.performed_by<>p_actor;
 END IF;
 IF n.next_due_on IS NOT NULL AND n.next_due_on<=haven.operation_source_local_date(n.performed_at,n.facility_id) THEN RETURN 'next_due_on must be after the service date'; END IF;
 IF n.certificate_document_id IS NOT NULL AND (p_prev IS NULL OR n.certificate_document_id IS DISTINCT FROM p_prev.certificate_document_id) THEN
  PERFORM 1 FROM public.facility_documents WHERE id=n.certificate_document_id FOR SHARE;
  IF NOT haven.operation_source_document_current(n.certificate_document_id,n.organization_id,n.facility_id) THEN RETURN 'Certificate is not a current document of this site'; END IF;
 END IF;
 RETURN haven.operation_source_entry_problem(n.performed_at,p_reference,p_correction,other,n.entry_reason,n.outcome='fail',n.issue_summary);
END $$;

CREATE FUNCTION haven.operation_source_service_key(p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE WHEN haven.operation_source_service_is_asset_kind(p_kind) THEN 'asset-service' ELSE 'facility-service' END $$;

CREATE FUNCTION haven.record_facility_service(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; n public.facility_service_records; r public.facility_service_records; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text; src text;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Service record payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('facility_id','service_kind','asset_id','performed_at','performer_kind','performed_by','vendor_id','performer_label','outcome','readings','issue_summary','next_due_on','certificate_document_id','note','entry_reason') THEN
   RAISE EXCEPTION 'Service record field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 n.facility_id:=haven.operation_source_uuid(p_payload,'facility_id'); IF n.facility_id IS NULL THEN RAISE EXCEPTION 'facility_id is required' USING ERRCODE='22023'; END IF;
 n.service_kind:=p_payload->>'service_kind';
 IF n.service_kind IS NULL OR n.service_kind NOT IN('fire_safety_inspection','fire_inspection','sprinkler_inspection','extinguisher_inspection','hood_cleaning','ac_filter_change') THEN
  RAISE EXCEPTION 'service_kind must be fire_safety_inspection, fire_inspection, sprinkler_inspection, extinguisher_inspection, hood_cleaning or ac_filter_change' USING ERRCODE='22023'; END IF;
 n.asset_id:=haven.operation_source_uuid(p_payload,'asset_id');
 n.performed_at:=haven.operation_occurrence_timestamp(p_payload->'performed_at');
 IF n.performed_at IS NULL THEN RAISE EXCEPTION 'performed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 n.performer_kind:=coalesce(p_payload->>'performer_kind','staff');
 IF n.performer_kind NOT IN('staff','vendor') THEN RAISE EXCEPTION 'performer_kind must be staff or vendor' USING ERRCODE='22023'; END IF;
 n.performed_by:=haven.operation_source_uuid(p_payload,'performed_by'); n.vendor_id:=haven.operation_source_uuid(p_payload,'vendor_id'); n.performer_label:=haven.operation_source_text(p_payload,'performer_label',200);
 n.outcome:=p_payload->>'outcome';
 IF n.outcome IS NULL OR n.outcome NOT IN('pass','fail') THEN RAISE EXCEPTION 'outcome must be pass or fail' USING ERRCODE='22023'; END IF;
 n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb);
 problem:=haven.operation_source_readings_problem(n.readings); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); n.next_due_on:=haven.operation_source_date(p_payload,'next_due_on'); n.certificate_document_id:=haven.operation_source_uuid(p_payload,'certificate_document_id');
 n.note:=haven.operation_source_text(p_payload,'note',4000); n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000);
 actor:=haven.operation_source_record_actor(n.facility_id);
 org:=haven.organization_id();
 n.organization_id:=org;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 hash:=encode(sha256(convert_to(jsonb_build_object('action','record','actor',actor,'payload',jsonb_build_object('facility_id',n.facility_id,'service_kind',n.service_kind,'asset_id',n.asset_id,'performed_at',p_payload->'performed_at',
  'performer_kind',n.performer_kind,'performed_by',n.performed_by,'vendor_id',n.vendor_id,'performer_label',n.performer_label,'outcome',n.outcome,'readings',n.readings,'issue_summary',n.issue_summary,
  'next_due_on',n.next_due_on,'certificate_document_id',n.certificate_document_id,'note',n.note,'entry_reason',n.entry_reason))::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 now_at:=clock_timestamp();
 IF n.performer_kind='staff' THEN n.performed_by:=coalesce(n.performed_by,actor); END IF;
 problem:=haven.operation_source_service_problem(n,NULL,actor,now_at,false,now_at);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 src:=haven.operation_source_service_key(n.service_kind);
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 INSERT INTO public.facility_service_records(organization_id,facility_id,service_kind,asset_id,performed_at,performer_kind,performed_by,vendor_id,performer_label,outcome,readings,issue_summary,next_due_on,certificate_document_id,note,entry_reason,
  finalized_at,finalized_by,version_recorded_at,version_recorded_by,created_by,updated_by)
 VALUES(org,n.facility_id,n.service_kind,n.asset_id,n.performed_at,n.performer_kind,n.performed_by,n.vendor_id,n.performer_label,n.outcome,n.readings,n.issue_summary,n.next_due_on,n.certificate_document_id,n.note,n.entry_reason,
  now_at,actor,now_at,actor,actor,actor) RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,src,r.id::text,r.record_version::text,'final',r.facility_id);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,src,r.id::text,'record',to_jsonb(r),delivery);
END $$;

CREATE FUNCTION haven.correct_facility_service(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.facility_service_records; n public.facility_service_records; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text; src text; had_receipt boolean;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'An expected record version is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Correction payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k='service_kind' THEN RAISE EXCEPTION 'Service kind cannot change; void the record and record it again' USING ERRCODE='22023'; END IF;
  IF k NOT IN('reason','asset_id','performed_at','performer_kind','performed_by','vendor_id','performer_label','outcome','readings','issue_summary','next_due_on','certificate_document_id','note','entry_reason') THEN
   RAISE EXCEPTION 'Correction field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A correction reason is required' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'performed_at' AND haven.operation_occurrence_timestamp(p_payload->'performed_at') IS NULL THEN RAISE EXCEPTION 'performed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'outcome' AND (p_payload->>'outcome') NOT IN('pass','fail') THEN RAISE EXCEPTION 'outcome must be pass or fail' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'performer_kind' AND (p_payload->>'performer_kind') NOT IN('staff','vendor') THEN RAISE EXCEPTION 'performer_kind must be staff or vendor' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'readings' THEN problem:=haven.operation_source_readings_problem(p_payload->'readings'); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF; END IF;
 SELECT * INTO r FROM public.facility_service_records WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 -- Lock order everywhere: the request key, then the record, then 346's per-record delivery lock.
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.facility_service_records WHERE id=p_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','correct','actor',actor,'record',p_id,'expected_version',p_expected_version,'payload',p_payload)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Service record is voided' USING ERRCODE='P0001'; END IF;
 IF r.record_version<>p_expected_version THEN RAISE EXCEPTION 'Record changed since it was read' USING ERRCODE='P0001',DETAIL='current_record_version='||r.record_version; END IF;
 now_at:=clock_timestamp();
 n:=r;
 IF p_payload ? 'asset_id' THEN n.asset_id:=haven.operation_source_uuid(p_payload,'asset_id'); END IF;
 IF p_payload ? 'performed_at' THEN n.performed_at:=haven.operation_occurrence_timestamp(p_payload->'performed_at'); END IF;
 IF p_payload ? 'performer_kind' THEN n.performer_kind:=p_payload->>'performer_kind'; END IF;
 IF p_payload ? 'performed_by' THEN n.performed_by:=haven.operation_source_uuid(p_payload,'performed_by'); END IF;
 IF p_payload ? 'vendor_id' THEN n.vendor_id:=haven.operation_source_uuid(p_payload,'vendor_id'); END IF;
 IF p_payload ? 'performer_label' THEN n.performer_label:=haven.operation_source_text(p_payload,'performer_label',200); END IF;
 IF p_payload ? 'outcome' THEN n.outcome:=p_payload->>'outcome'; END IF;
 IF p_payload ? 'readings' THEN n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb); END IF;
 IF p_payload ? 'issue_summary' THEN n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); END IF;
 IF p_payload ? 'next_due_on' THEN n.next_due_on:=haven.operation_source_date(p_payload,'next_due_on'); END IF;
 IF p_payload ? 'certificate_document_id' THEN n.certificate_document_id:=haven.operation_source_uuid(p_payload,'certificate_document_id'); END IF;
 IF p_payload ? 'note' THEN n.note:=haven.operation_source_text(p_payload,'note',4000); END IF;
 IF p_payload ? 'entry_reason' THEN n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000); END IF;
 -- A performer restated from vendor to staff without naming the staff member is the corrector; a restatement to vendor drops the staff member.
 IF n.performer_kind='staff' AND r.performer_kind='vendor' THEN n.vendor_id:=CASE WHEN p_payload ? 'vendor_id' THEN n.vendor_id ELSE NULL END; n.performer_label:=CASE WHEN p_payload ? 'performer_label' THEN n.performer_label ELSE NULL END; n.performed_by:=coalesce(n.performed_by,actor); END IF;
 IF n.performer_kind='vendor' AND r.performer_kind='staff' AND NOT (p_payload ? 'performed_by') THEN n.performed_by:=NULL; END IF;
 -- A restated performer never inherits the earlier entry reason (review F3): the on-behalf rule asks for a fresh one unless the correction states it.
 IF (n.performer_kind,n.performed_by,n.vendor_id) IS DISTINCT FROM (r.performer_kind,r.performed_by,r.vendor_id) AND NOT (p_payload ? 'entry_reason') THEN n.entry_reason:=NULL; END IF;
 IF (n.asset_id,n.performed_at,n.performer_kind,n.performed_by,n.vendor_id,n.performer_label,n.outcome,n.readings,n.issue_summary,n.next_due_on,n.certificate_document_id,n.note,n.entry_reason)
  IS NOT DISTINCT FROM (r.asset_id,r.performed_at,r.performer_kind,r.performed_by,r.vendor_id,r.performer_label,r.outcome,r.readings,r.issue_summary,r.next_due_on,r.certificate_document_id,r.note,r.entry_reason) THEN
  RAISE EXCEPTION 'A correction must restate at least one field' USING ERRCODE='22023'; END IF;
 -- The late and future rules stay anchored on the original recording act (344): a correction never moves them.
 problem:=haven.operation_source_service_problem(n,r,actor,r.finalized_at,true,now_at);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 src:=haven.operation_source_service_key(r.service_kind);
 had_receipt:=haven.operation_source_record_effective(org,src,p_id::text);
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.facility_service_records SET asset_id=n.asset_id,performed_at=n.performed_at,performer_kind=n.performer_kind,performed_by=n.performed_by,vendor_id=n.vendor_id,performer_label=n.performer_label,outcome=n.outcome,readings=n.readings,
  issue_summary=n.issue_summary,next_due_on=n.next_due_on,certificate_document_id=n.certificate_document_id,note=n.note,entry_reason=n.entry_reason,
  correction_reason=reason,version_recorded_at=now_at,version_recorded_by=actor,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,src,r.id::text,r.record_version::text,'final',r.facility_id);
 PERFORM haven.operation_source_correction_unmatched(had_receipt,delivery);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,src,r.id::text,'correct',to_jsonb(r),delivery);
END $$;

CREATE FUNCTION haven.void_facility_service(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.facility_service_records; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; src text;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Void payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP IF k<>'reason' THEN RAISE EXCEPTION 'Void field is not editable' USING ERRCODE='22023'; END IF; END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A void reason is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.facility_service_records WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.facility_service_records WHERE id=p_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','void','actor',actor,'record',p_id,'reason',reason)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Service record is already voided' USING ERRCODE='P0001'; END IF;
 -- COL-133 retired-subject boundary (COL-154 3k(xii)): a void must be able to reverse the receipt it delivered.
 IF r.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=r.asset_id AND a.organization_id=org AND a.facility_id=r.facility_id AND a.deleted_at IS NULL AND a.status<>'retired') THEN
  RAISE EXCEPTION 'Asset is not current at this site; the service record stays as history until a historical-record scope exists' USING ERRCODE='22023'; END IF;
 now_at:=clock_timestamp();
 src:=haven.operation_source_service_key(r.service_kind);
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.facility_service_records SET voided_at=now_at,voided_by=actor,void_reason=reason,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,src,r.id::text,r.record_version::text,'voided',r.facility_id);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,src,r.id::text,'void',to_jsonb(r),delivery);
END $$;

-- ---------------------------------------------------------------------------
-- Dietary record commands: record (final), correct, void.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_dietary_problem(n public.dietary_records,p_prev public.dietary_records,p_actor uuid,p_reference timestamptz,p_correction boolean,p_now timestamptz) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
 IF n.performed_by IS NULL THEN RETURN 'performed_by must name the staff performer'; END IF;
 IF n.performed_by<>p_actor AND NOT haven.operation_source_staff_current(n.performed_by,n.organization_id,n.facility_id,p_now) THEN RETURN 'Performer is not current staff at this site'; END IF;
 IF n.record_kind='meal_substitution' THEN
  IF n.outcome<>'performed' THEN RETURN 'A meal substitution is recorded as performed; state a problem as an issue summary'; END IF;
  IF n.service_date IS NULL OR n.meal_period IS NULL OR n.planned_item IS NULL OR n.substitute_item IS NULL OR n.substitution_reason IS NULL THEN
   RETURN 'service_date, meal_period, planned_item, substitute_item and substitution_reason are required for a meal substitution'; END IF;
  IF n.meal_period NOT IN('breakfast','lunch','dinner','snack_am','snack_pm','snack_hs') THEN RETURN 'meal_period must be breakfast, lunch, dinner, snack_am, snack_pm or snack_hs'; END IF;
  IF n.menu_label IS NOT NULL OR n.approver_label IS NOT NULL OR n.approval_document_id IS NOT NULL THEN RETURN 'menu_label, approver_label and approval_document_id must be empty for a meal substitution'; END IF;
  IF haven.operation_source_local_date(n.performed_at,n.facility_id)<>n.service_date THEN RETURN 'A meal substitution is recorded on its service date'; END IF;
  IF n.meal_service_id IS NOT NULL THEN
   PERFORM 1 FROM public.meal_services WHERE id=n.meal_service_id FOR SHARE;
   IF NOT EXISTS(SELECT 1 FROM public.meal_services m WHERE m.id=n.meal_service_id AND m.organization_id=n.organization_id AND m.facility_id=n.facility_id AND m.service_date=n.service_date AND m.meal_period=n.meal_period) THEN
    RETURN 'Meal service must be this site''s service for that date and period'; END IF;
  END IF;
 ELSIF n.record_kind='menu_approval' THEN
  IF n.outcome<>'performed' THEN RETURN 'A menu approval is recorded as performed; state a problem as an issue summary'; END IF;
  IF n.menu_label IS NULL OR n.approver_label IS NULL THEN RETURN 'menu_label and approver_label are required for a menu approval'; END IF;
  IF n.service_date IS NOT NULL OR n.meal_period IS NOT NULL OR n.planned_item IS NOT NULL OR n.substitute_item IS NOT NULL OR n.substitution_reason IS NOT NULL OR n.meal_service_id IS NOT NULL THEN
   RETURN 'meal fields must be empty for a menu approval'; END IF;
  IF n.approval_document_id IS NOT NULL AND (p_prev IS NULL OR n.approval_document_id IS DISTINCT FROM p_prev.approval_document_id) THEN
   PERFORM 1 FROM public.facility_documents WHERE id=n.approval_document_id FOR SHARE;
   IF NOT haven.operation_source_document_current(n.approval_document_id,n.organization_id,n.facility_id) THEN RETURN 'Approval document is not a current document of this site'; END IF;
  END IF;
 ELSE
  IF n.service_date IS NOT NULL OR n.meal_period IS NOT NULL OR n.planned_item IS NOT NULL OR n.substitute_item IS NOT NULL OR n.substitution_reason IS NOT NULL OR n.meal_service_id IS NOT NULL
   OR n.menu_label IS NOT NULL OR n.approver_label IS NOT NULL OR n.approval_document_id IS NOT NULL THEN RETURN 'meal and menu fields must be empty for an emergency food supply check'; END IF;
 END IF;
 RETURN haven.operation_source_entry_problem(n.performed_at,p_reference,p_correction,n.performed_by<>p_actor,n.entry_reason,n.outcome='failed',n.issue_summary);
END $$;

CREATE FUNCTION haven.record_dietary_record(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; n public.dietary_records; r public.dietary_records; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Dietary record payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('facility_id','record_kind','performed_at','performed_by','outcome','service_date','meal_period','planned_item','substitute_item','substitution_reason','meal_service_id','menu_label','approver_label','approval_document_id','readings','issue_summary','note','entry_reason') THEN
   RAISE EXCEPTION 'Dietary record field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 n.facility_id:=haven.operation_source_uuid(p_payload,'facility_id'); IF n.facility_id IS NULL THEN RAISE EXCEPTION 'facility_id is required' USING ERRCODE='22023'; END IF;
 n.record_kind:=p_payload->>'record_kind';
 IF n.record_kind IS NULL OR n.record_kind NOT IN('meal_substitution','menu_approval','emergency_food_supply_check') THEN RAISE EXCEPTION 'record_kind must be meal_substitution, menu_approval or emergency_food_supply_check' USING ERRCODE='22023'; END IF;
 n.performed_at:=haven.operation_occurrence_timestamp(p_payload->'performed_at');
 IF n.performed_at IS NULL THEN RAISE EXCEPTION 'performed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 n.performed_by:=haven.operation_source_uuid(p_payload,'performed_by');
 n.outcome:=coalesce(p_payload->>'outcome','performed');
 IF n.outcome NOT IN('performed','failed') THEN RAISE EXCEPTION 'outcome must be performed or failed' USING ERRCODE='22023'; END IF;
 n.service_date:=haven.operation_source_date(p_payload,'service_date'); n.meal_period:=haven.operation_source_text(p_payload,'meal_period',20);
 n.planned_item:=haven.operation_source_text(p_payload,'planned_item',200); n.substitute_item:=haven.operation_source_text(p_payload,'substitute_item',200); n.substitution_reason:=haven.operation_source_text(p_payload,'substitution_reason',2000);
 n.meal_service_id:=haven.operation_source_uuid(p_payload,'meal_service_id'); n.menu_label:=haven.operation_source_text(p_payload,'menu_label',200); n.approver_label:=haven.operation_source_text(p_payload,'approver_label',200);
 n.approval_document_id:=haven.operation_source_uuid(p_payload,'approval_document_id');
 n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb);
 problem:=haven.operation_source_readings_problem(n.readings); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); n.note:=haven.operation_source_text(p_payload,'note',4000); n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000);
 actor:=haven.operation_source_record_actor(n.facility_id);
 org:=haven.organization_id();
 n.organization_id:=org;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 hash:=encode(sha256(convert_to(jsonb_build_object('action','record','actor',actor,'payload',jsonb_build_object('facility_id',n.facility_id,'record_kind',n.record_kind,'performed_at',p_payload->'performed_at','performed_by',n.performed_by,'outcome',n.outcome,
  'service_date',n.service_date,'meal_period',n.meal_period,'planned_item',n.planned_item,'substitute_item',n.substitute_item,'substitution_reason',n.substitution_reason,'meal_service_id',n.meal_service_id,
  'menu_label',n.menu_label,'approver_label',n.approver_label,'approval_document_id',n.approval_document_id,'readings',n.readings,'issue_summary',n.issue_summary,'note',n.note,'entry_reason',n.entry_reason))::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 now_at:=clock_timestamp();
 n.performed_by:=coalesce(n.performed_by,actor);
 problem:=haven.operation_source_dietary_problem(n,NULL,actor,now_at,false,now_at);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 INSERT INTO public.dietary_records(organization_id,facility_id,record_kind,performed_at,performed_by,outcome,service_date,meal_period,planned_item,substitute_item,substitution_reason,meal_service_id,menu_label,approver_label,approval_document_id,
  readings,issue_summary,note,entry_reason,finalized_at,finalized_by,version_recorded_at,version_recorded_by,created_by,updated_by)
 VALUES(org,n.facility_id,n.record_kind,n.performed_at,n.performed_by,n.outcome,n.service_date,n.meal_period,n.planned_item,n.substitute_item,n.substitution_reason,n.meal_service_id,n.menu_label,n.approver_label,n.approval_document_id,
  n.readings,n.issue_summary,n.note,n.entry_reason,now_at,actor,now_at,actor,actor,actor) RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'dietary-record',r.id::text,r.record_version::text,'final',r.facility_id);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'dietary-record',r.id::text,'record',to_jsonb(r),delivery);
END $$;

CREATE FUNCTION haven.correct_dietary_record(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.dietary_records; n public.dietary_records; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text; had_receipt boolean;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'An expected record version is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Correction payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k='record_kind' THEN RAISE EXCEPTION 'Record kind cannot change; void the record and record it again' USING ERRCODE='22023'; END IF;
  IF k NOT IN('reason','performed_at','performed_by','outcome','service_date','meal_period','planned_item','substitute_item','substitution_reason','meal_service_id','menu_label','approver_label','approval_document_id','readings','issue_summary','note','entry_reason') THEN
   RAISE EXCEPTION 'Correction field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A correction reason is required' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'performed_at' AND haven.operation_occurrence_timestamp(p_payload->'performed_at') IS NULL THEN RAISE EXCEPTION 'performed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'outcome' AND (p_payload->>'outcome') NOT IN('performed','failed') THEN RAISE EXCEPTION 'outcome must be performed or failed' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'readings' THEN problem:=haven.operation_source_readings_problem(p_payload->'readings'); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF; END IF;
 SELECT * INTO r FROM public.dietary_records WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.dietary_records WHERE id=p_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','correct','actor',actor,'record',p_id,'expected_version',p_expected_version,'payload',p_payload)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Dietary record is voided' USING ERRCODE='P0001'; END IF;
 IF r.record_version<>p_expected_version THEN RAISE EXCEPTION 'Record changed since it was read' USING ERRCODE='P0001',DETAIL='current_record_version='||r.record_version; END IF;
 now_at:=clock_timestamp();
 n:=r;
 IF p_payload ? 'performed_at' THEN n.performed_at:=haven.operation_occurrence_timestamp(p_payload->'performed_at'); END IF;
 IF p_payload ? 'performed_by' THEN n.performed_by:=coalesce(haven.operation_source_uuid(p_payload,'performed_by'),actor); END IF;
 IF n.performed_by IS DISTINCT FROM r.performed_by AND NOT (p_payload ? 'entry_reason') THEN n.entry_reason:=NULL; END IF;
 IF p_payload ? 'outcome' THEN n.outcome:=p_payload->>'outcome'; END IF;
 IF p_payload ? 'service_date' THEN n.service_date:=haven.operation_source_date(p_payload,'service_date'); END IF;
 IF p_payload ? 'meal_period' THEN n.meal_period:=haven.operation_source_text(p_payload,'meal_period',20); END IF;
 IF p_payload ? 'planned_item' THEN n.planned_item:=haven.operation_source_text(p_payload,'planned_item',200); END IF;
 IF p_payload ? 'substitute_item' THEN n.substitute_item:=haven.operation_source_text(p_payload,'substitute_item',200); END IF;
 IF p_payload ? 'substitution_reason' THEN n.substitution_reason:=haven.operation_source_text(p_payload,'substitution_reason',2000); END IF;
 IF p_payload ? 'meal_service_id' THEN n.meal_service_id:=haven.operation_source_uuid(p_payload,'meal_service_id'); END IF;
 IF p_payload ? 'menu_label' THEN n.menu_label:=haven.operation_source_text(p_payload,'menu_label',200); END IF;
 IF p_payload ? 'approver_label' THEN n.approver_label:=haven.operation_source_text(p_payload,'approver_label',200); END IF;
 IF p_payload ? 'approval_document_id' THEN n.approval_document_id:=haven.operation_source_uuid(p_payload,'approval_document_id'); END IF;
 IF p_payload ? 'readings' THEN n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb); END IF;
 IF p_payload ? 'issue_summary' THEN n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); END IF;
 IF p_payload ? 'note' THEN n.note:=haven.operation_source_text(p_payload,'note',4000); END IF;
 IF p_payload ? 'entry_reason' THEN n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000); END IF;
 IF (n.performed_at,n.performed_by,n.outcome,n.service_date,n.meal_period,n.planned_item,n.substitute_item,n.substitution_reason,n.meal_service_id,n.menu_label,n.approver_label,n.approval_document_id,n.readings,n.issue_summary,n.note,n.entry_reason)
  IS NOT DISTINCT FROM (r.performed_at,r.performed_by,r.outcome,r.service_date,r.meal_period,r.planned_item,r.substitute_item,r.substitution_reason,r.meal_service_id,r.menu_label,r.approver_label,r.approval_document_id,r.readings,r.issue_summary,r.note,r.entry_reason) THEN
  RAISE EXCEPTION 'A correction must restate at least one field' USING ERRCODE='22023'; END IF;
 problem:=haven.operation_source_dietary_problem(n,r,actor,r.finalized_at,true,now_at);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 had_receipt:=haven.operation_source_record_effective(org,'dietary-record',p_id::text);
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.dietary_records SET performed_at=n.performed_at,performed_by=n.performed_by,outcome=n.outcome,service_date=n.service_date,meal_period=n.meal_period,planned_item=n.planned_item,substitute_item=n.substitute_item,
  substitution_reason=n.substitution_reason,meal_service_id=n.meal_service_id,menu_label=n.menu_label,approver_label=n.approver_label,approval_document_id=n.approval_document_id,readings=n.readings,issue_summary=n.issue_summary,note=n.note,entry_reason=n.entry_reason,
  correction_reason=reason,version_recorded_at=now_at,version_recorded_by=actor,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'dietary-record',r.id::text,r.record_version::text,'final',r.facility_id);
 PERFORM haven.operation_source_correction_unmatched(had_receipt,delivery);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'dietary-record',r.id::text,'correct',to_jsonb(r),delivery);
END $$;

CREATE FUNCTION haven.void_dietary_record(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.dietary_records; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Void payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP IF k<>'reason' THEN RAISE EXCEPTION 'Void field is not editable' USING ERRCODE='22023'; END IF; END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A void reason is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.dietary_records WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record_request:'||p_request_key));
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.dietary_records WHERE id=p_id FOR UPDATE;
 IF r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','void','actor',actor,'record',p_id,'reason',reason)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Dietary record is already voided' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.dietary_records SET voided_at=now_at,voided_by=actor,void_reason=reason,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'dietary-record',r.id::text,r.record_version::text,'voided',r.facility_id);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'dietary-record',r.id::text,'void',to_jsonb(r),delivery);
END $$;

-- ---------------------------------------------------------------------------
-- Wrappers and grants (session only; invokers).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_facility_service_review(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.record_facility_service(p_request_key,p_payload) $$;
CREATE FUNCTION public.correct_facility_service_review(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.correct_facility_service(p_id,p_request_key,p_expected_version,p_payload) $$;
CREATE FUNCTION public.void_facility_service_review(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.void_facility_service(p_id,p_request_key,p_payload) $$;
CREATE FUNCTION public.record_dietary_record_review(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.record_dietary_record(p_request_key,p_payload) $$;
CREATE FUNCTION public.correct_dietary_record_review(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.correct_dietary_record(p_id,p_request_key,p_expected_version,p_payload) $$;
CREATE FUNCTION public.void_dietary_record_review(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.void_dietary_record(p_id,p_request_key,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.operation_source_service_problem(public.facility_service_records,public.facility_service_records,uuid,timestamptz,boolean,timestamptz),haven.operation_source_service_key(text),haven.operation_source_dietary_problem(public.dietary_records,public.dietary_records,uuid,timestamptz,boolean,timestamptz),
 haven.record_facility_service(text,jsonb),haven.correct_facility_service(uuid,text,integer,jsonb),haven.void_facility_service(uuid,text,jsonb),
 haven.record_dietary_record(text,jsonb),haven.correct_dietary_record(uuid,text,integer,jsonb),haven.void_dietary_record(uuid,text,jsonb),
 public.record_facility_service_review(text,jsonb),public.correct_facility_service_review(uuid,text,integer,jsonb),public.void_facility_service_review(uuid,text,jsonb),
 public.record_dietary_record_review(text,jsonb),public.correct_dietary_record_review(uuid,text,integer,jsonb),public.void_dietary_record_review(uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.record_facility_service(text,jsonb),haven.correct_facility_service(uuid,text,integer,jsonb),haven.void_facility_service(uuid,text,jsonb),
 haven.record_dietary_record(text,jsonb),haven.correct_dietary_record(uuid,text,integer,jsonb),haven.void_dietary_record(uuid,text,jsonb),
 public.record_facility_service_review(text,jsonb),public.correct_facility_service_review(uuid,text,integer,jsonb),public.void_facility_service_review(uuid,text,jsonb),
 public.record_dietary_record_review(text,jsonb),public.correct_dietary_record_review(uuid,text,integer,jsonb),public.void_dietary_record_review(uuid,text,jsonb)
 TO authenticated;

-- ---------------------------------------------------------------------------
-- Registration (migration-only) for the organisation the 336 catalog seeded.
-- Review activities and the human-path items are never allowlisted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_org constant uuid:='00000000-0000-0000-0000-000000000001'; n int;
 v_new constant text[]:=ARRAY['hfo-al-w04-01','hfo-al-w04-02','hfo-al-y03-01','hfo-al-y05-01','hfo-al-m11-01','hfo-al-y02-01','hfo-al-y04-01','hfo-al-y04-02','hfo-al-m01-01','hfo-al-m08-01','hfo-al-y01-01'];
 v_never constant text[]:=ARRAY['hfo-al-d11-01','hfo-al-a07-01','hfo-al-a07-02','hfo-al-a08-01','hfo-al-a08-02',
  'hfo-al-d01-01','hfo-al-d02-01','hfo-al-d02-02','hfo-al-d03-01','hfo-al-d03-02','hfo-al-d16-01','hfo-al-w03-01','hfo-al-m10-01','hfo-al-y06-01','hfo-al-y07-01'];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=v_org) THEN RAISE NOTICE 'COL-159: organisation % is absent; no adapter registered',v_org; RETURN; END IF;
 SELECT count(*) INTO n FROM public.operation_activities WHERE organization_id=v_org AND activity_key=ANY(v_new);
 IF n<>11 THEN RAISE EXCEPTION 'COL-159: the 336 catalog activities for dietary and facility services are missing (% of 11)',n; END IF;
 IF (SELECT count(*) FROM public.operation_source_adapters WHERE organization_id=v_org AND source_key IN('drill-log','asset-observation') AND status='registered')<>2 THEN
  RAISE EXCEPTION 'COL-159: the COL-154 adapters are not registered'; END IF;
 INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function,note) VALUES
  (v_org,'facility-service','facility','operation_source_read_facility_service','COL-159: fire safety, fire and sprinkler inspections performed against the site (facility_service_records)'),
  (v_org,'asset-service','asset','operation_source_read_asset_service','COL-159: extinguisher inspections, hood cleanings and AC filter changes performed against a named asset (facility_service_records)'),
  (v_org,'dietary-record','facility','operation_source_read_dietary_record','COL-159: meal-level substitutions, dietitian menu approval and the emergency food supply check (dietary_records)');
 INSERT INTO public.operation_source_rules(organization_id,source_key,activity_id)
  SELECT v_org,'asset-observation',id FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-w04-01','hfo-al-w04-02')
  UNION ALL SELECT v_org,'asset-service',id FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-y03-01','hfo-al-y05-01','hfo-al-m11-01')
  UNION ALL SELECT v_org,'facility-service',id FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-y02-01','hfo-al-y04-01','hfo-al-y04-02')
  UNION ALL SELECT v_org,'dietary-record',id FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-m01-01','hfo-al-m08-01','hfo-al-y01-01');
 IF (SELECT count(*) FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE ru.organization_id=v_org AND a.activity_key=ANY(v_new))<>11 THEN
  RAISE EXCEPTION 'COL-159: allowlist registration incomplete'; END IF;
 IF (SELECT count(*) FROM public.operation_source_rules WHERE organization_id=v_org AND source_key IN('drill-log','asset-observation'))<>7 THEN
  RAISE EXCEPTION 'COL-159: the COL-154 rules changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE a.activity_key=ANY(v_never) OR a.activity_kind='record_review') THEN
  RAISE EXCEPTION 'COL-159: a review or human-path activity must never be allowlisted for a source'; END IF;
 IF EXISTS(SELECT 1 FROM public.operation_source_events WHERE source_key IN('facility-service','asset-service','dietary-record'))
  OR EXISTS(SELECT 1 FROM public.operation_source_record_requests WHERE source_key IN('facility-service','asset-service','dietary-record'))
  OR EXISTS(SELECT 1 FROM public.facility_service_records) OR EXISTS(SELECT 1 FROM public.dietary_records)
  OR EXISTS(SELECT 1 FROM public.asset_observations WHERE observation_kind IN('aed_operation_check','aed_equipment_check')) THEN
  RAISE EXCEPTION 'COL-159: the migration must not deliver or record anything'; END IF;
END $$;

COMMENT ON TABLE public.facility_service_records IS 'COL-159: one inspection, cleaning or maintenance action on one occasion against the site (fire safety, fire, sprinkler) or a named asset (extinguisher, hood, AC unit), by staff or a site-linked vendor; recorded final by command only, versioned corrections, void with a reason; delivered to the checklist through 346. The stated next-due date and certificate reference are read-only record columns.';
COMMENT ON TABLE public.dietary_records IS 'COL-159: a meal-level substitution (service date + meal period, no resident), a dietitian menu approval (labels verbatim) or the emergency food supply check; recorded final by command only and delivered through 346.';
COMMENT ON COLUMN public.facility_service_records.next_due_on IS 'COL-159: the next-due date the certificate or vendor stated; informational, never a rule, never copied to an asset or profile.';
COMMENT ON FUNCTION haven.operation_source_read_facility_service(text) IS 'COL-159: 346 reader for site services (fire_safety_inspection -> hfo-al-y02-01, fire_inspection -> hfo-al-y04-01, sprinkler_inspection -> hfo-al-y04-02).';
COMMENT ON FUNCTION haven.operation_source_read_asset_service(text) IS 'COL-159: 346 reader for asset services (extinguisher_inspection -> hfo-al-y03-01, hood_cleaning -> hfo-al-y05-01, ac_filter_change -> hfo-al-m11-01).';
COMMENT ON FUNCTION haven.operation_source_read_dietary_record(text) IS 'COL-159: 346 reader for dietary records (meal_substitution -> hfo-al-m08-01, menu_approval -> hfo-al-y01-01, emergency_food_supply_check -> hfo-al-m01-01).';
COMMENT ON FUNCTION haven.operation_source_read_asset_observation(text) IS 'COL-154/159: 346 reader for asset_observations (generator_test -> hfo-al-w01-01, carbon_monoxide_check -> hfo-al-w01-02, extinguisher_check -> hfo-al-a07-03, aed_operation_check -> hfo-al-w04-01, aed_equipment_check -> hfo-al-w04-02).';
NOTIFY pgrst,'reload schema';
COMMIT;
