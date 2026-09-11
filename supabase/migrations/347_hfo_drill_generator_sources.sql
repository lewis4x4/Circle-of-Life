BEGIN;

-- COL-154 / HFO-18: connect drill and generator records to the checklist
-- first. Two domain adapters on the COL-147 source-link mechanism (346):
-- the existing drill_log table (fire and elopement drills; facility subject)
-- gains an explicit finality lifecycle (draft until a person finalizes it,
-- versioned corrections, void with a reason), and a new asset_observations
-- table records generator tests, carbon-monoxide checks and extinguisher
-- currency checks against a named asset, recorded final by a staff member
-- who observed the work. Each has a reader that returns the record's live
-- state and session commands that commit a version and deliver it through
-- 346 in the same transaction, so a final record satisfies exactly its
-- occurrence once, a correction supersedes as a 344 chain, a void reverses
-- into retained history with an attention row, and every refusal is a
-- recorded ledger row. An automatic self-test or a photo alone is refused as
-- an observation by name. Review activities (AL-A07-01/02, AL-A08-01/02) are
-- never allowlisted: a log cannot satisfy its own review. No Homewood rule,
-- day, time, count or deadline is set (Q06, Q09, Q14 open); no occurrence,
-- schedule, reminder or legacy drill consumer (220/221/250/125/200) is
-- created, changed or activated.

-- ---------------------------------------------------------------------------
-- Domain token: a third transaction-local marker on the same owner secret for
-- the domain commands' own writes (drill_log, asset_observations, requests).
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_record_approved() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(nullif(current_setting('haven.operation_source_record_command',true),'')=haven.operation_occurrence_token(),false)
$$;
REVOKE ALL ON FUNCTION haven.operation_source_record_approved() FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- drill_log lifecycle. Every existing row, and every row the legacy page
-- keeps writing, is a draft: existence never implies finality.
-- ---------------------------------------------------------------------------
ALTER TABLE public.drill_log
 ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK(record_version>=1),
 ADD COLUMN finalized_at timestamptz,
 ADD COLUMN finalized_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN version_recorded_at timestamptz,
 ADD COLUMN version_recorded_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN entry_reason text CHECK(entry_reason IS NULL OR length(btrim(entry_reason)) BETWEEN 1 AND 2000),
 ADD COLUMN correction_reason text CHECK(correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 2000),
 ADD COLUMN voided_at timestamptz,
 ADD COLUMN voided_by uuid REFERENCES public.user_profiles(id),
 ADD COLUMN void_reason text CHECK(void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 1 AND 2000),
 ADD COLUMN readings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(readings)='object'),
 ADD COLUMN outcome text NOT NULL DEFAULT 'performed' CHECK(outcome IN('performed','failed')),
 ADD COLUMN issue_summary text CHECK(issue_summary IS NULL OR length(btrim(issue_summary)) BETWEEN 1 AND 2000),
 ADD CONSTRAINT drill_log_finalized_shape CHECK((finalized_at IS NULL)=(finalized_by IS NULL)),
 ADD CONSTRAINT drill_log_version_recorded_shape CHECK(((version_recorded_at IS NULL)=(version_recorded_by IS NULL)) AND (finalized_at IS NULL OR version_recorded_at IS NOT NULL)),
 ADD CONSTRAINT drill_log_voided_shape CHECK(((voided_at IS NULL)=(voided_by IS NULL)) AND ((voided_at IS NULL)=(void_reason IS NULL)) AND (voided_at IS NULL OR finalized_at IS NOT NULL)),
 ADD CONSTRAINT drill_log_failed_issue CHECK(finalized_at IS NULL OR outcome<>'failed' OR issue_summary IS NOT NULL);
CREATE INDEX idx_drill_log_final ON public.drill_log(organization_id,facility_id,finalized_at) WHERE finalized_at IS NOT NULL AND voided_at IS NULL;

CREATE FUNCTION haven.guard_drill_log_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE approved boolean; content_changed boolean; lifecycle_changed boolean; finalizing boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Drill logs are retained history; void a final log or soft-delete a draft' USING ERRCODE='23514'; END IF;
 approved:=haven.operation_source_record_approved();
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=NEW.facility_id AND f.organization_id=NEW.organization_id) THEN
   RAISE EXCEPTION 'Drill log site is not in this organisation' USING ERRCODE='23514'; END IF;
  IF NEW.finalized_at IS NOT NULL OR NEW.finalized_by IS NOT NULL OR NEW.version_recorded_at IS NOT NULL OR NEW.version_recorded_by IS NOT NULL
   OR NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL OR NEW.correction_reason IS NOT NULL THEN
   RAISE EXCEPTION 'A drill log is recorded as a draft; finality comes from the finalize command' USING ERRCODE='23514'; END IF;
  NEW.record_version:=1;
  RETURN NEW;
 END IF;
 IF (OLD.id,OLD.organization_id,OLD.facility_id,OLD.created_at,OLD.created_by) IS DISTINCT FROM (NEW.id,NEW.organization_id,NEW.facility_id,NEW.created_at,NEW.created_by) THEN
  RAISE EXCEPTION 'Drill log identity is immutable' USING ERRCODE='23514'; END IF;
 content_changed:=(OLD.drill_type,OLD.drill_date,OLD.drill_time,OLD.pull_station_activated,OLD.staff_present_count,OLD.residents_present_count,OLD.conducted_by,OLD.notes,OLD.evidence_url,OLD.evidence_storage_path,OLD.readings,OLD.outcome,OLD.issue_summary,OLD.entry_reason)
  IS DISTINCT FROM (NEW.drill_type,NEW.drill_date,NEW.drill_time,NEW.pull_station_activated,NEW.staff_present_count,NEW.residents_present_count,NEW.conducted_by,NEW.notes,NEW.evidence_url,NEW.evidence_storage_path,NEW.readings,NEW.outcome,NEW.issue_summary,NEW.entry_reason);
 lifecycle_changed:=(OLD.finalized_at,OLD.finalized_by,OLD.version_recorded_at,OLD.version_recorded_by,OLD.voided_at,OLD.voided_by,OLD.void_reason,OLD.correction_reason,OLD.record_version)
  IS DISTINCT FROM (NEW.finalized_at,NEW.finalized_by,NEW.version_recorded_at,NEW.version_recorded_by,NEW.voided_at,NEW.voided_by,NEW.void_reason,NEW.correction_reason,NEW.record_version);
 IF OLD.voided_at IS NOT NULL AND (content_changed OR lifecycle_changed OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
  RAISE EXCEPTION 'Voided drill logs are immutable' USING ERRCODE='23514'; END IF;
 IF NOT approved THEN
  IF lifecycle_changed THEN RAISE EXCEPTION 'Drill log finality changes only through the finalize, correct and void commands' USING ERRCODE='42501'; END IF;
  IF OLD.finalized_at IS NOT NULL AND content_changed THEN RAISE EXCEPTION 'Finalized drill logs change only through a correction' USING ERRCODE='23514'; END IF;
  IF OLD.finalized_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'Finalized drill logs are voided with a reason' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.finalized_at IS NOT NULL AND (NEW.finalized_at,NEW.finalized_by) IS DISTINCT FROM (OLD.finalized_at,OLD.finalized_by) THEN
   RAISE EXCEPTION 'Drill log finalization is recorded once' USING ERRCODE='23514'; END IF;
  IF OLD.finalized_at IS NULL AND NEW.finalized_at IS NULL AND lifecycle_changed THEN
   RAISE EXCEPTION 'A draft drill log carries no lifecycle values' USING ERRCODE='23514'; END IF;
  IF OLD.finalized_at IS NOT NULL AND content_changed AND (NEW.version_recorded_at,NEW.version_recorded_by) IS NOT DISTINCT FROM (OLD.version_recorded_at,OLD.version_recorded_by) THEN
   RAISE EXCEPTION 'A correction records who restated the drill log' USING ERRCODE='23514'; END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'The commands void a drill log; they never delete it' USING ERRCODE='23514'; END IF;
 END IF;
 finalizing:=OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL;
 NEW.record_version:=CASE WHEN content_changed AND NOT finalizing THEN OLD.record_version+1 ELSE OLD.record_version END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_drill_log_lifecycle() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER drill_log_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON public.drill_log FOR EACH ROW EXECUTE FUNCTION haven.guard_drill_log_lifecycle();
CREATE TRIGGER drill_log_no_truncate BEFORE TRUNCATE ON public.drill_log FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();

-- ---------------------------------------------------------------------------
-- asset_observations: a staff member's observation of one asset (generator
-- test, carbon-monoxide check, extinguisher currency), recorded final by
-- command only. No draft state; a void is the only later lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE public.asset_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 asset_id uuid NOT NULL REFERENCES public.facility_assets(id),
 observation_kind text NOT NULL CHECK(observation_kind IN('generator_test','carbon_monoxide_check','extinguisher_check')),
 basis text NOT NULL CHECK(basis='staff_observed'),
 observed_at timestamptz NOT NULL,
 observed_by uuid NOT NULL REFERENCES public.user_profiles(id),
 outcome text NOT NULL CHECK(outcome IN('pass','fail')),
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
 CHECK(outcome<>'fail' OR issue_summary IS NOT NULL),
 CHECK(((voided_at IS NULL)=(voided_by IS NULL)) AND ((voided_at IS NULL)=(void_reason IS NULL)))
);
CREATE INDEX idx_asset_observations_site_asset ON public.asset_observations(organization_id,facility_id,asset_id,observed_at DESC);
CREATE INDEX idx_asset_observations_kind ON public.asset_observations(facility_id,observation_kind,observed_at DESC) WHERE voided_at IS NULL;

CREATE FUNCTION haven.guard_asset_observation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE content_changed boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Observations are retained history; void with a reason' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_source_record_approved() THEN RAISE EXCEPTION 'Use the observation commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=NEW.asset_id AND a.organization_id=NEW.organization_id AND a.facility_id=NEW.facility_id) THEN
   RAISE EXCEPTION 'Observation asset is not at this site' USING ERRCODE='23514'; END IF;
  IF NEW.voided_at IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NEW.correction_reason IS NOT NULL THEN RAISE EXCEPTION 'A new observation is final and not voided' USING ERRCODE='23514'; END IF;
  NEW.record_version:=1;
  RETURN NEW;
 END IF;
 IF (OLD.id,OLD.organization_id,OLD.facility_id,OLD.created_at,OLD.created_by,OLD.finalized_at,OLD.finalized_by,OLD.basis) IS DISTINCT FROM (NEW.id,NEW.organization_id,NEW.facility_id,NEW.created_at,NEW.created_by,NEW.finalized_at,NEW.finalized_by,NEW.basis) THEN
  RAISE EXCEPTION 'Observation identity is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'Observations are voided, not deleted' USING ERRCODE='23514'; END IF;
 content_changed:=(OLD.asset_id,OLD.observation_kind,OLD.observed_at,OLD.observed_by,OLD.outcome,OLD.readings,OLD.issue_summary,OLD.note,OLD.entry_reason)
  IS DISTINCT FROM (NEW.asset_id,NEW.observation_kind,NEW.observed_at,NEW.observed_by,NEW.outcome,NEW.readings,NEW.issue_summary,NEW.note,NEW.entry_reason);
 IF OLD.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Voided observations are immutable' USING ERRCODE='23514'; END IF;
 IF content_changed AND (NEW.version_recorded_at,NEW.version_recorded_by) IS NOT DISTINCT FROM (OLD.version_recorded_at,OLD.version_recorded_by) THEN
  RAISE EXCEPTION 'A correction records who restated the observation' USING ERRCODE='23514'; END IF;
 IF content_changed AND NOT EXISTS(SELECT 1 FROM public.facility_assets a WHERE a.id=NEW.asset_id AND a.organization_id=NEW.organization_id AND a.facility_id=NEW.facility_id) THEN
  RAISE EXCEPTION 'Observation asset is not at this site' USING ERRCODE='23514'; END IF;
 NEW.record_version:=CASE WHEN content_changed THEN OLD.record_version+1 ELSE OLD.record_version END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_asset_observation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER asset_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.asset_observations FOR EACH ROW EXECUTE FUNCTION haven.guard_asset_observation();
CREATE TRIGGER asset_observations_no_truncate BEFORE TRUNCATE ON public.asset_observations FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER asset_observations_set_updated_at BEFORE UPDATE ON public.asset_observations FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER asset_observations_audit AFTER INSERT OR UPDATE OR DELETE ON public.asset_observations FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.asset_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_observations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.asset_observations TO authenticated,service_role;
CREATE POLICY asset_observations_read ON public.asset_observations FOR SELECT TO authenticated USING(organization_id=haven.organization_id() AND haven.operation_facility_access(facility_id));

-- ---------------------------------------------------------------------------
-- Idempotency ledger for the domain commands (record, finalize, correct,
-- void): one immutable row per request key with the reply as returned.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_source_record_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 request_key text NOT NULL UNIQUE CHECK(request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$'),
 request_hash text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_role text NOT NULL,
 at timestamptz NOT NULL,
 source_key text NOT NULL,
 source_record_id text NOT NULL,
 action text NOT NULL CHECK(action IN('record','finalize','correct','void')),
 source_event_id uuid REFERENCES public.operation_source_events(id),
 reply jsonb NOT NULL CHECK(jsonb_typeof(reply)='object'),
 FOREIGN KEY(organization_id,source_key) REFERENCES public.operation_source_adapters(organization_id,source_key)
);
CREATE INDEX idx_operation_source_record_requests_record ON public.operation_source_record_requests(organization_id,source_key,source_record_id,at);
CREATE FUNCTION haven.guard_operation_source_record_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Source record requests are immutable' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_source_record_approved() THEN RAISE EXCEPTION 'Use the source record commands' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_source_record_request() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_source_record_request_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_source_record_requests FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_source_record_request();
CREATE TRIGGER operation_source_record_requests_no_truncate BEFORE TRUNCATE ON public.operation_source_record_requests FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
CREATE TRIGGER operation_source_record_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_source_record_requests FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
ALTER TABLE public.operation_source_record_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_source_record_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_source_record_requests TO authenticated;
CREATE POLICY operation_source_record_requests_read ON public.operation_source_record_requests FOR SELECT TO authenticated USING(organization_id=haven.organization_id() AND haven.operation_facility_access(facility_id));
CREATE POLICY operation_source_record_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name<>'operation_source_record_requests');

-- ---------------------------------------------------------------------------
-- Readers: the live state of one record in the 346 shape. Executable by no
-- role; only the mechanism calls them. A record id that is not a uuid or is
-- unknown is {exists:false}. A draft is reported as a draft; a voided or
-- soft-deleted final record as voided. The activity is resolved by catalog
-- key in the record's organisation, never by a constant.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_activity_by_key(p_org uuid,p_key text) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT a.id FROM public.operation_activities a WHERE a.organization_id=p_org AND a.activity_key=p_key $$;
CREATE FUNCTION haven.operation_source_statement(p_performed timestamptz,p_reference timestamptz,p_recorder uuid,p_performer uuid,p_entry_reason text,p_outcome text,p_readings jsonb,p_note text,p_issue text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'performed_at',p_performed,
  'performer',CASE WHEN p_performer IS NULL OR p_performer=p_recorder THEN jsonb_build_object('kind','self') ELSE jsonb_build_object('kind','other_staff','user_id',p_performer) END,
  'entry_kind',CASE WHEN p_performed<p_reference-interval '15 minutes' THEN 'late' WHEN p_performer IS NOT NULL AND p_performer<>p_recorder THEN 'on_behalf' ELSE 'routine' END,
  'entry_reason',p_entry_reason,
  'outcome',p_outcome,
  'values',coalesce(p_readings,'{}'::jsonb),
  'note',p_note,
  'issue',CASE WHEN p_issue IS NULL THEN NULL ELSE jsonb_build_object('kind',CASE WHEN p_outcome='failed' THEN 'failed_result' ELSE 'problem' END,'summary',p_issue) END))
$$;
CREATE FUNCTION haven.operation_source_read_drill_log(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.drill_log; rid uuid; act uuid; fin text; tz text; performed timestamptz; recorder uuid; reference timestamptz;
BEGIN
 BEGIN rid:=p_id::uuid; EXCEPTION WHEN OTHERS THEN RETURN '{"exists":false}'::jsonb; END;
 SELECT * INTO r FROM public.drill_log WHERE id=rid;
 IF NOT FOUND OR (r.deleted_at IS NOT NULL AND r.finalized_at IS NULL) THEN RETURN '{"exists":false}'::jsonb; END IF;
 fin:=CASE WHEN r.voided_at IS NOT NULL OR r.deleted_at IS NOT NULL THEN 'voided' WHEN r.finalized_at IS NULL THEN 'draft' ELSE 'final' END;
 act:=haven.operation_source_activity_by_key(r.organization_id,CASE r.drill_type WHEN 'fire' THEN 'hfo-al-m05-01' WHEN 'elopement' THEN 'hfo-al-m06-01' END);
 IF act IS NULL THEN RAISE EXCEPTION 'Drill type % has no checklist activity; only fire and elopement drills are linked',r.drill_type; END IF;
 SELECT coalesce(f.timezone,'America/New_York') INTO tz FROM public.facilities f WHERE f.id=r.facility_id;
 performed:=(r.drill_date::timestamp+r.drill_time) AT TIME ZONE coalesce(tz,'America/New_York');
 recorder:=coalesce(r.version_recorded_by,r.created_by,r.updated_by);
 reference:=coalesce(r.finalized_at,r.updated_at,r.created_at);
 RETURN jsonb_strip_nulls(jsonb_build_object('exists',true,'version',r.record_version::text,'finality',fin,'facility_id',r.facility_id,'activity_id',act,
  'subject',jsonb_build_object('kind','facility'),'recorded_by',recorder,'recorded_at',reference,
  'statement',CASE WHEN fin='voided' THEN NULL ELSE haven.operation_source_statement(performed,reference,recorder,r.conducted_by,r.entry_reason,r.outcome,r.readings,r.notes,r.issue_summary) END));
END $$;
CREATE FUNCTION haven.operation_source_read_asset_observation(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.asset_observations; rid uuid; act uuid; fin text;
BEGIN
 BEGIN rid:=p_id::uuid; EXCEPTION WHEN OTHERS THEN RETURN '{"exists":false}'::jsonb; END;
 SELECT * INTO r FROM public.asset_observations WHERE id=rid;
 IF NOT FOUND THEN RETURN '{"exists":false}'::jsonb; END IF;
 fin:=CASE WHEN r.voided_at IS NOT NULL OR r.deleted_at IS NOT NULL THEN 'voided' ELSE 'final' END;
 act:=haven.operation_source_activity_by_key(r.organization_id,CASE r.observation_kind WHEN 'generator_test' THEN 'hfo-al-w01-01' WHEN 'carbon_monoxide_check' THEN 'hfo-al-w01-02' WHEN 'extinguisher_check' THEN 'hfo-al-a07-03' END);
 IF act IS NULL THEN RAISE EXCEPTION 'Observation kind % has no checklist activity in this organisation',r.observation_kind; END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('exists',true,'version',r.record_version::text,'finality',fin,'facility_id',r.facility_id,'activity_id',act,
  'subject',jsonb_build_object('kind','asset','id',r.asset_id),'recorded_by',r.version_recorded_by,'recorded_at',r.finalized_at,
  'statement',CASE WHEN fin='voided' THEN NULL ELSE haven.operation_source_statement(r.observed_at,r.finalized_at,r.version_recorded_by,r.observed_by,r.entry_reason,
   CASE r.outcome WHEN 'pass' THEN 'performed' ELSE 'failed' END,r.readings,r.note,r.issue_summary) END));
END $$;
REVOKE ALL ON FUNCTION haven.operation_source_activity_by_key(uuid,text),haven.operation_source_statement(timestamptz,timestamptz,uuid,uuid,text,text,jsonb,text,text),
 haven.operation_source_read_drill_log(text),haven.operation_source_read_asset_observation(text) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Command helpers: actor and site lock, shape rules, replay, delivery and
-- the request row.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_record_actor(p_facility uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR p_facility IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.facilities WHERE id=p_facility AND organization_id=haven.organization_id() AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_profiles p JOIN auth.users u ON u.id=p.id
  JOIN auth.sessions session ON session.user_id=p.id AND session.id=nullif(auth.jwt()->>'session_id','')::uuid
  WHERE p.id=auth.uid() FOR SHARE OF p,u,session;
 PERFORM 1 FROM public.user_facility_access WHERE user_id=auth.uid() AND facility_id=p_facility FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM haven.current_authorized_actor() x WHERE x.actor_is_managed) OR NOT haven.operation_facility_access(p_facility) THEN
  RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END $$;
-- Readings are typed values keyed as the governing rule's inputs; the rule decides definition, requirement and range at delivery.
CREATE FUNCTION haven.operation_source_readings_problem(p_readings jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; n int:=0;
BEGIN
 IF p_readings IS NULL OR jsonb_typeof(p_readings)<>'object' THEN RETURN 'readings must be an object of named values'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_readings) LOOP
  n:=n+1;
  IF k !~ '^[a-z][a-z0-9_]{0,63}$' THEN RETURN 'readings must be keyed by input names (lowercase, digits, underscores)'; END IF;
  IF jsonb_typeof(p_readings->k) NOT IN('string','number','boolean','null') THEN RETURN 'readings must be scalar values'; END IF;
 END LOOP;
 IF n>50 THEN RETURN 'readings must be at most fifty values'; END IF;
 RETURN NULL;
END $$;
-- The same rules 341/344 apply at delivery, checked here first so a person is refused with the reason rather than left with a refused delivery.
CREATE FUNCTION haven.operation_source_entry_problem(p_performed timestamptz,p_reference timestamptz,p_correction boolean,p_other_performer boolean,p_entry_reason text,p_failed boolean,p_issue text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
  WHEN p_performed>p_reference+interval '2 minutes' THEN CASE WHEN p_correction THEN 'Corrected performed time cannot be after the original recording' ELSE 'Performed time cannot be in the future' END
  WHEN p_performed<p_reference-interval '15 minutes' AND p_entry_reason IS NULL THEN 'Work performed earlier than fifteen minutes ago must be entered as late with a reason'
  WHEN p_other_performer AND p_entry_reason IS NULL THEN 'Work performed by someone else must be entered on behalf with a reason'
  WHEN p_failed AND p_issue IS NULL THEN 'A failed outcome requires an issue summary'
  END
$$;
CREATE FUNCTION haven.operation_source_staff_current(p_user uuid,p_org uuid,p_facility uuid,p_now timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_profiles p JOIN public.user_facility_access g ON g.user_id=p.id AND g.facility_id=p_facility AND g.revoked_at IS NULL
  AND (g.operation_expires_at IS NULL OR g.operation_expires_at>p_now)
  WHERE p.id=p_user AND p.organization_id=p_org AND p.is_active AND p.deleted_at IS NULL)
$$;
CREATE FUNCTION haven.operation_source_record_replay(p_key text,p_hash text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE q public.operation_source_record_requests;
BEGIN
 SELECT * INTO q FROM public.operation_source_record_requests WHERE request_key=p_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF q.request_hash=p_hash AND q.actor_id=p_actor THEN RETURN q.reply||'{"replayed":true}'::jsonb; END IF;
 RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
END $$;
CREATE FUNCTION haven.operation_source_record_deliver(p_key text,p_source_key text,p_record_id text,p_version text,p_kind text,p_facility uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT haven.deliver_operation_source_event(NULL,auth.uid(),'session',p_key||':deliver',
  jsonb_build_object('source_key',p_source_key,'source_record_id',p_record_id,'source_record_version',p_version,'event_kind',p_kind,'facility_id',p_facility))
$$;
CREATE FUNCTION haven.operation_source_record_finish(p_key text,p_hash text,p_actor uuid,p_org uuid,p_facility uuid,p_source_key text,p_record_id text,p_action text,p_record jsonb,p_delivery jsonb,p_link_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE reply jsonb;
BEGIN
 reply:=jsonb_build_object('record',p_record,'delivery',p_delivery,'linked',coalesce((p_delivery->'event'->>'state') IN('satisfied','corrected'),false),'replayed',false)
  ||CASE WHEN p_link_reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('link_reason',p_link_reason) END;
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 INSERT INTO public.operation_source_record_requests(organization_id,facility_id,request_key,request_hash,actor_id,actor_role,at,source_key,source_record_id,action,source_event_id,reply)
 VALUES(p_org,p_facility,p_key,p_hash,p_actor,haven.app_role()::text,clock_timestamp(),p_source_key,p_record_id,p_action,(p_delivery->'event'->>'id')::uuid,reply);
 PERFORM set_config('haven.operation_source_record_command','',true);
 RETURN reply;
END $$;
CREATE FUNCTION haven.operation_source_text(p_payload jsonb,p_key text,p_max int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF NOT (p_payload ? p_key) OR jsonb_typeof(p_payload->p_key)='null' THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_payload->p_key)<>'string' THEN RAISE EXCEPTION '% must be text of at most % characters',p_key,p_max USING ERRCODE='22023'; END IF;
 v:=nullif(btrim(p_payload->>p_key),'');
 IF length(coalesce(v,''))>p_max THEN RAISE EXCEPTION '% must be text of at most % characters',p_key,p_max USING ERRCODE='22023'; END IF;
 RETURN v;
END $$;
CREATE FUNCTION haven.operation_source_uuid(p_payload jsonb,p_key text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF NOT (p_payload ? p_key) OR jsonb_typeof(p_payload->p_key)='null' THEN RETURN NULL; END IF;
 RETURN (p_payload->>p_key)::uuid;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '% must be a uuid',p_key USING ERRCODE='22023';
END $$;
CREATE FUNCTION haven.operation_source_request_key(p_key text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF; END $$;
REVOKE ALL ON FUNCTION haven.operation_source_record_actor(uuid),haven.operation_source_readings_problem(jsonb),haven.operation_source_entry_problem(timestamptz,timestamptz,boolean,boolean,text,boolean,text),
 haven.operation_source_staff_current(uuid,uuid,uuid,timestamptz),haven.operation_source_record_replay(text,text,uuid),haven.operation_source_record_deliver(text,text,text,text,text,uuid),
 haven.operation_source_record_finish(text,text,uuid,uuid,uuid,text,text,text,jsonb,jsonb,text),haven.operation_source_text(jsonb,text,int),haven.operation_source_uuid(jsonb,text),haven.operation_source_request_key(text)
 FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Asset observations: record (final), correct, void.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.record_asset_observation(p_request_key text,p_payload jsonb) RETURNS jsonb
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
 IF kind IS NULL OR kind NOT IN('generator_test','carbon_monoxide_check','extinguisher_check') THEN RAISE EXCEPTION 'observation_kind must be generator_test, carbon_monoxide_check or extinguisher_check' USING ERRCODE='22023'; END IF;
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
 IF kind='generator_test' AND asset.asset_type<>'generator' THEN RAISE EXCEPTION 'A generator test is recorded against a generator' USING ERRCODE='22023'; END IF;
 IF kind='extinguisher_check' AND asset.asset_type<>'fire_extinguisher' THEN RAISE EXCEPTION 'An extinguisher check is recorded against a fire extinguisher' USING ERRCODE='22023'; END IF;
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

CREATE FUNCTION haven.correct_asset_observation(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.asset_observations; n public.asset_observations; asset public.facility_assets; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text;
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
 -- The record's site decides the authority; an unknown id is indistinguishable from an unheld site.
 SELECT * INTO r FROM public.asset_observations WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.asset_observations WHERE id=p_id FOR UPDATE;
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
 IF p_payload ? 'outcome' THEN n.outcome:=p_payload->>'outcome'; END IF;
 IF p_payload ? 'readings' THEN n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb); END IF;
 IF p_payload ? 'issue_summary' THEN n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); END IF;
 IF p_payload ? 'note' THEN n.note:=haven.operation_source_text(p_payload,'note',4000); END IF;
 IF p_payload ? 'entry_reason' THEN n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000); END IF;
 IF (n.asset_id,n.observed_at,n.observed_by,n.outcome,n.readings,n.issue_summary,n.note,n.entry_reason) IS NOT DISTINCT FROM (r.asset_id,r.observed_at,r.observed_by,r.outcome,r.readings,r.issue_summary,r.note,r.entry_reason) THEN
  RAISE EXCEPTION 'A correction must restate at least one field' USING ERRCODE='22023'; END IF;
 SELECT * INTO asset FROM public.facility_assets WHERE id=n.asset_id AND organization_id=org AND facility_id=r.facility_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR asset.status='retired' THEN RAISE EXCEPTION 'Asset is not current at this site' USING ERRCODE='22023'; END IF;
 IF n.observation_kind='generator_test' AND asset.asset_type<>'generator' THEN RAISE EXCEPTION 'A generator test is recorded against a generator' USING ERRCODE='22023'; END IF;
 IF n.observation_kind='extinguisher_check' AND asset.asset_type<>'fire_extinguisher' THEN RAISE EXCEPTION 'An extinguisher check is recorded against a fire extinguisher' USING ERRCODE='22023'; END IF;
 IF n.observed_by<>actor AND NOT haven.operation_source_staff_current(n.observed_by,org,r.facility_id,now_at) THEN RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 -- The late and future rules stay anchored on the original recording act (344): a correction never moves them.
 problem:=haven.operation_source_entry_problem(n.observed_at,r.finalized_at,true,n.observed_by<>actor,n.entry_reason,n.outcome='fail',n.issue_summary);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.asset_observations SET asset_id=n.asset_id,observed_at=n.observed_at,observed_by=n.observed_by,outcome=n.outcome,readings=n.readings,issue_summary=n.issue_summary,note=n.note,entry_reason=n.entry_reason,
  correction_reason=reason,version_recorded_at=now_at,version_recorded_by=actor,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'asset-observation',r.id::text,r.record_version::text,'final',r.facility_id);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'asset-observation',r.id::text,'correct',to_jsonb(r),delivery);
END $$;

CREATE FUNCTION haven.void_asset_observation(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.asset_observations; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Void payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP IF k<>'reason' THEN RAISE EXCEPTION 'Void field is not editable' USING ERRCODE='22023'; END IF; END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A void reason is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.asset_observations WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.asset_observations WHERE id=p_id FOR UPDATE;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','void','actor',actor,'record',p_id,'reason',reason)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Observation is already voided' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.asset_observations SET voided_at=now_at,voided_by=actor,void_reason=reason,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 delivery:=haven.operation_source_record_deliver(p_request_key,'asset-observation',r.id::text,r.record_version::text,'voided',r.facility_id);
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'asset-observation',r.id::text,'void',to_jsonb(r),delivery);
END $$;

-- ---------------------------------------------------------------------------
-- Drill logs: finalize a draft, correct a final log, void a final log.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_source_drill_instant(r public.drill_log) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (r.drill_date::timestamp+r.drill_time) AT TIME ZONE coalesce((SELECT f.timezone FROM public.facilities f WHERE f.id=r.facility_id),'America/New_York')
$$;
CREATE FUNCTION haven.finalize_drill_log(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.drill_log; entry text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text; performed timestamptz;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Finalize payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP IF k<>'entry_reason' THEN RAISE EXCEPTION 'Finalize field is not editable' USING ERRCODE='22023'; END IF; END LOOP;
 entry:=haven.operation_source_text(p_payload,'entry_reason',2000);
 SELECT * INTO r FROM public.drill_log WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.drill_log WHERE id=p_id FOR UPDATE;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','finalize','actor',actor,'record',p_id,'entry_reason',entry)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Drill log is voided' USING ERRCODE='P0001'; END IF;
 IF r.finalized_at IS NOT NULL THEN RAISE EXCEPTION 'Drill log is already final' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 entry:=coalesce(entry,r.entry_reason);
 IF r.conducted_by IS NOT NULL AND r.conducted_by<>actor AND NOT haven.operation_source_staff_current(r.conducted_by,org,r.facility_id,now_at) THEN
  RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 performed:=haven.operation_source_drill_instant(r);
 problem:=haven.operation_source_entry_problem(performed,now_at,false,r.conducted_by IS NOT NULL AND r.conducted_by<>actor,entry,r.outcome='failed',r.issue_summary);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.drill_log SET finalized_at=now_at,finalized_by=actor,version_recorded_at=now_at,version_recorded_by=actor,entry_reason=entry,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 IF r.drill_type IN('fire','elopement') THEN
  delivery:=haven.operation_source_record_deliver(p_request_key,'drill-log',r.id::text,r.record_version::text,'final',r.facility_id);
  RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'drill-log',r.id::text,'finalize',to_jsonb(r),delivery);
 END IF;
 -- A tornado drill is a real record with no checklist activity yet: final, retained, not delivered.
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'drill-log',r.id::text,'finalize',to_jsonb(r),NULL,'no_checklist_activity');
END $$;

CREATE FUNCTION haven.correct_drill_log(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.drill_log; n public.drill_log; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb; problem text; performed timestamptz;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'An expected record version is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Correction payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('reason','drill_type','drill_date','drill_time','pull_station_activated','staff_present_count','residents_present_count','conducted_by','notes','readings','outcome','issue_summary','entry_reason') THEN
   RAISE EXCEPTION 'Correction field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A correction reason is required' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'drill_type' AND (p_payload->>'drill_type') NOT IN('fire','elopement','tornado') THEN RAISE EXCEPTION 'drill_type must be fire, elopement or tornado' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'outcome' AND (p_payload->>'outcome') NOT IN('performed','failed') THEN RAISE EXCEPTION 'outcome must be performed or failed' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'readings' THEN problem:=haven.operation_source_readings_problem(p_payload->'readings'); IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF; END IF;
 SELECT * INTO r FROM public.drill_log WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.drill_log WHERE id=p_id FOR UPDATE;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','correct','actor',actor,'record',p_id,'expected_version',p_expected_version,'payload',p_payload)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Drill log is voided' USING ERRCODE='P0001'; END IF;
 IF r.finalized_at IS NULL THEN RAISE EXCEPTION 'Drill log is a draft; corrections apply to final logs' USING ERRCODE='P0001'; END IF;
 IF r.record_version<>p_expected_version THEN RAISE EXCEPTION 'Record changed since it was read' USING ERRCODE='P0001',DETAIL='current_record_version='||r.record_version; END IF;
 now_at:=clock_timestamp();
 n:=r;
 BEGIN
  IF p_payload ? 'drill_type' THEN n.drill_type:=p_payload->>'drill_type'; END IF;
  IF p_payload ? 'drill_date' THEN n.drill_date:=(p_payload->>'drill_date')::date; END IF;
  IF p_payload ? 'drill_time' THEN n.drill_time:=(p_payload->>'drill_time')::time; END IF;
  IF p_payload ? 'pull_station_activated' THEN n.pull_station_activated:=coalesce((p_payload->>'pull_station_activated')::boolean,false); END IF;
  IF p_payload ? 'staff_present_count' THEN n.staff_present_count:=nullif(p_payload->>'staff_present_count','')::integer; END IF;
  IF p_payload ? 'residents_present_count' THEN n.residents_present_count:=nullif(p_payload->>'residents_present_count','')::integer; END IF;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Correction request contains an invalid drill value' USING ERRCODE='22023'; END;
 IF n.drill_date IS NULL OR n.drill_time IS NULL THEN RAISE EXCEPTION 'drill_date and drill_time are required' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'conducted_by' THEN n.conducted_by:=haven.operation_source_uuid(p_payload,'conducted_by'); END IF;
 IF p_payload ? 'notes' THEN n.notes:=haven.operation_source_text(p_payload,'notes',4000); END IF;
 IF p_payload ? 'readings' THEN n.readings:=coalesce(nullif(p_payload->'readings','null'::jsonb),'{}'::jsonb); END IF;
 IF p_payload ? 'outcome' THEN n.outcome:=p_payload->>'outcome'; END IF;
 IF p_payload ? 'issue_summary' THEN n.issue_summary:=haven.operation_source_text(p_payload,'issue_summary',2000); END IF;
 IF p_payload ? 'entry_reason' THEN n.entry_reason:=haven.operation_source_text(p_payload,'entry_reason',2000); END IF;
 IF (n.drill_type,n.drill_date,n.drill_time,n.pull_station_activated,n.staff_present_count,n.residents_present_count,n.conducted_by,n.notes,n.readings,n.outcome,n.issue_summary,n.entry_reason)
  IS NOT DISTINCT FROM (r.drill_type,r.drill_date,r.drill_time,r.pull_station_activated,r.staff_present_count,r.residents_present_count,r.conducted_by,r.notes,r.readings,r.outcome,r.issue_summary,r.entry_reason) THEN
  RAISE EXCEPTION 'A correction must restate at least one field' USING ERRCODE='22023'; END IF;
 IF n.conducted_by IS NOT NULL AND n.conducted_by<>actor AND NOT haven.operation_source_staff_current(n.conducted_by,org,r.facility_id,now_at) THEN
  RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 performed:=haven.operation_source_drill_instant(n);
 problem:=haven.operation_source_entry_problem(performed,r.finalized_at,true,n.conducted_by IS NOT NULL AND n.conducted_by<>actor,n.entry_reason,n.outcome='failed',n.issue_summary);
 IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.drill_log SET drill_type=n.drill_type,drill_date=n.drill_date,drill_time=n.drill_time,pull_station_activated=n.pull_station_activated,staff_present_count=n.staff_present_count,
  residents_present_count=n.residents_present_count,conducted_by=n.conducted_by,notes=n.notes,readings=n.readings,outcome=n.outcome,issue_summary=n.issue_summary,entry_reason=n.entry_reason,
  correction_reason=reason,version_recorded_at=now_at,version_recorded_by=actor,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 IF r.drill_type IN('fire','elopement') THEN
  delivery:=haven.operation_source_record_deliver(p_request_key,'drill-log',r.id::text,r.record_version::text,'final',r.facility_id);
  RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'drill-log',r.id::text,'correct',to_jsonb(r),delivery);
 END IF;
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'drill-log',r.id::text,'correct',to_jsonb(r),NULL,'no_checklist_activity');
END $$;

CREATE FUNCTION haven.void_drill_log(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; r public.drill_log; reason text; org uuid; actor uuid; hash text; existing jsonb; now_at timestamptz; delivery jsonb;
BEGIN
 PERFORM haven.operation_source_request_key(p_request_key);
 IF p_id IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Void payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP IF k<>'reason' THEN RAISE EXCEPTION 'Void field is not editable' USING ERRCODE='22023'; END IF; END LOOP;
 reason:=haven.operation_source_text(p_payload,'reason',2000);
 IF reason IS NULL THEN RAISE EXCEPTION 'A void reason is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.drill_log WHERE id=p_id;
 IF NOT FOUND OR r.organization_id IS DISTINCT FROM haven.organization_id() OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 actor:=haven.operation_source_record_actor(r.facility_id);
 org:=r.organization_id;
 PERFORM pg_advisory_xact_lock(hashtext('operation_source_record:'||p_id::text));
 SELECT * INTO r FROM public.drill_log WHERE id=p_id FOR UPDATE;
 hash:=encode(sha256(convert_to(jsonb_build_object('action','void','actor',actor,'record',p_id,'reason',reason)::text,'UTF8')),'hex');
 existing:=haven.operation_source_record_replay(p_request_key,hash,actor);
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Drill log is already voided' USING ERRCODE='P0001'; END IF;
 IF r.finalized_at IS NULL THEN RAISE EXCEPTION 'Drill log is a draft; only a final log is voided' USING ERRCODE='P0001'; END IF;
 now_at:=clock_timestamp();
 PERFORM set_config('haven.operation_source_record_command',haven.operation_occurrence_token(),true);
 UPDATE public.drill_log SET voided_at=now_at,voided_by=actor,void_reason=reason,updated_by=actor WHERE id=p_id RETURNING * INTO r;
 PERFORM set_config('haven.operation_source_record_command','',true);
 IF r.drill_type IN('fire','elopement') THEN
  delivery:=haven.operation_source_record_deliver(p_request_key,'drill-log',r.id::text,r.record_version::text,'voided',r.facility_id);
  RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'drill-log',r.id::text,'void',to_jsonb(r),delivery);
 END IF;
 RETURN haven.operation_source_record_finish(p_request_key,hash,actor,org,r.facility_id,'drill-log',r.id::text,'void',to_jsonb(r),NULL,'no_checklist_activity');
END $$;

-- ---------------------------------------------------------------------------
-- Wrappers and grants (session only; invokers).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_asset_observation_review(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.record_asset_observation(p_request_key,p_payload) $$;
CREATE FUNCTION public.correct_asset_observation_review(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.correct_asset_observation(p_id,p_request_key,p_expected_version,p_payload) $$;
CREATE FUNCTION public.void_asset_observation_review(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.void_asset_observation(p_id,p_request_key,p_payload) $$;
CREATE FUNCTION public.finalize_drill_log_review(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.finalize_drill_log(p_id,p_request_key,p_payload) $$;
CREATE FUNCTION public.correct_drill_log_review(p_id uuid,p_request_key text,p_expected_version integer,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.correct_drill_log(p_id,p_request_key,p_expected_version,p_payload) $$;
CREATE FUNCTION public.void_drill_log_review(p_id uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.void_drill_log(p_id,p_request_key,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.record_asset_observation(text,jsonb),haven.correct_asset_observation(uuid,text,integer,jsonb),haven.void_asset_observation(uuid,text,jsonb),
 haven.finalize_drill_log(uuid,text,jsonb),haven.correct_drill_log(uuid,text,integer,jsonb),haven.void_drill_log(uuid,text,jsonb),haven.operation_source_drill_instant(public.drill_log),
 public.record_asset_observation_review(text,jsonb),public.correct_asset_observation_review(uuid,text,integer,jsonb),public.void_asset_observation_review(uuid,text,jsonb),
 public.finalize_drill_log_review(uuid,text,jsonb),public.correct_drill_log_review(uuid,text,integer,jsonb),public.void_drill_log_review(uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.record_asset_observation(text,jsonb),haven.correct_asset_observation(uuid,text,integer,jsonb),haven.void_asset_observation(uuid,text,jsonb),
 haven.finalize_drill_log(uuid,text,jsonb),haven.correct_drill_log(uuid,text,integer,jsonb),haven.void_drill_log(uuid,text,jsonb),
 public.record_asset_observation_review(text,jsonb),public.correct_asset_observation_review(uuid,text,integer,jsonb),public.void_asset_observation_review(uuid,text,jsonb),
 public.finalize_drill_log_review(uuid,text,jsonb),public.correct_drill_log_review(uuid,text,integer,jsonb),public.void_drill_log_review(uuid,text,jsonb)
 TO authenticated;

-- ---------------------------------------------------------------------------
-- Registration (migration-only) for the organisation the 336 catalog seeded.
-- Review activities are never allowlisted: a log cannot satisfy its review.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_org constant uuid:='00000000-0000-0000-0000-000000000001'; n int;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=v_org) THEN RETURN; END IF;
 SELECT count(*) INTO n FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-m05-01','hfo-al-m06-01','hfo-al-w01-01','hfo-al-w01-02','hfo-al-a07-03');
 IF n<>5 THEN RAISE EXCEPTION 'COL-154: the 336 catalog activities for drills and asset observations are missing (% of 5)',n; END IF;
 INSERT INTO public.operation_source_adapters(organization_id,source_key,subject_kind,reader_function,note) VALUES
  (v_org,'drill-log','facility','operation_source_read_drill_log','COL-154: fire and elopement drill logs (drill_log), final only when a person finalizes them'),
  (v_org,'asset-observation','asset','operation_source_read_asset_observation','COL-154: staff-observed generator tests, carbon-monoxide checks and extinguisher currency checks (asset_observations)');
 INSERT INTO public.operation_source_rules(organization_id,source_key,activity_id)
  SELECT v_org,'drill-log',id FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-m05-01','hfo-al-m06-01')
  UNION ALL SELECT v_org,'asset-observation',id FROM public.operation_activities WHERE organization_id=v_org AND activity_key IN('hfo-al-w01-01','hfo-al-w01-02','hfo-al-a07-03');
 IF (SELECT count(*) FROM public.operation_source_rules WHERE organization_id=v_org AND source_key IN('drill-log','asset-observation'))<>5 THEN RAISE EXCEPTION 'COL-154: allowlist registration incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.operation_source_rules ru JOIN public.operation_activities a ON a.id=ru.activity_id WHERE a.activity_key IN('hfo-al-a07-01','hfo-al-a07-02','hfo-al-a08-01','hfo-al-a08-02')) THEN
  RAISE EXCEPTION 'COL-154: a review activity must never be allowlisted for a source'; END IF;
 IF EXISTS(SELECT 1 FROM public.operation_source_events) OR EXISTS(SELECT 1 FROM public.operation_source_record_requests) OR EXISTS(SELECT 1 FROM public.asset_observations)
  OR EXISTS(SELECT 1 FROM public.drill_log WHERE finalized_at IS NOT NULL OR voided_at IS NOT NULL OR record_version<>1) THEN
  RAISE EXCEPTION 'COL-154: the migration must not deliver, record or finalize anything'; END IF;
END $$;

COMMENT ON TABLE public.asset_observations IS 'COL-154: a staff member''s observation of one asset (generator test, carbon-monoxide check, extinguisher currency), recorded final by command only; versioned corrections and void with a reason; delivered to the checklist through the 346 source-link mechanism.';
COMMENT ON TABLE public.operation_source_record_requests IS 'COL-154: immutable idempotency ledger for the drill-log and asset-observation commands (record, finalize, correct, void) with the reply as returned.';
COMMENT ON COLUMN public.drill_log.finalized_at IS 'COL-154: the instant a person finalized this drill log. NULL means draft: existence never implies finality, and no legacy row is final.';
COMMENT ON COLUMN public.drill_log.record_version IS 'COL-154: bumped on every content change; the version a delivery names.';
COMMENT ON FUNCTION haven.operation_source_read_drill_log(text) IS 'COL-154: 346 reader for drill_log (fire -> hfo-al-m05-01, elopement -> hfo-al-m06-01; tornado has no activity). Draft until finalized; voided when voided or soft-deleted after finalization.';
COMMENT ON FUNCTION haven.operation_source_read_asset_observation(text) IS 'COL-154: 346 reader for asset_observations (generator_test -> hfo-al-w01-01, carbon_monoxide_check -> hfo-al-w01-02, extinguisher_check -> hfo-al-a07-03).';
NOTIFY pgrst,'reload schema';
COMMIT;
