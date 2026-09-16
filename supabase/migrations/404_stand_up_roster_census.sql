-- COL-351: Weekly Stand Up census and hospital figures are suggested from the
-- resident roster and confirmed by an administrator. Every confirmation is
-- recorded against the revision it belongs to, with the roster as-of time.
-- Counts and tokens only: no resident name, room or id leaves this migration.
-- Additive: no existing table, column, response key or grant changes meaning.
BEGIN;

-- Current roster counts for one facility. `security invoker`, so the caller's
-- resident row-level security decides what is visible; inside the Stand Up
-- save path the facility grant has already been asserted. The status set
-- mirrors STAND_UP_ROSTER_CENSUS_STATUSES in src/lib/stand-up/roster-census.ts
-- and the billable set in public.resident_billable_status (migration 217).
CREATE FUNCTION public.stand_up_roster_census(p_organization_id uuid,p_facility_id uuid)
RETURNS TABLE(in_house_count integer,hospital_hold_count integer,loa_count integer,roster_census_count integer,resident_count_in_haven integer,roster_as_of timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH scoped AS (
  SELECT r.status FROM public.residents r
  WHERE r.organization_id=p_organization_id AND r.facility_id=p_facility_id AND r.deleted_at IS NULL
 )
 SELECT
  count(*) FILTER (WHERE status='active')::integer,
  count(*) FILTER (WHERE status='hospital_hold')::integer,
  count(*) FILTER (WHERE status='loa')::integer,
  count(*) FILTER (WHERE status IN('active','hospital_hold','loa'))::integer,
  count(*)::integer,
  (SELECT max(h.effective_from) FROM public.resident_status_history h
    WHERE h.organization_id=p_organization_id AND h.facility_id=p_facility_id AND h.deleted_at IS NULL)
 FROM scoped
$$;
REVOKE ALL ON FUNCTION public.stand_up_roster_census(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stand_up_roster_census(uuid,uuid) TO authenticated,service_role;
COMMENT ON FUNCTION public.stand_up_roster_census(uuid,uuid) IS 'COL-351 roster counts for Stand Up: in house (active), hospital (hospital_hold), leave (loa), census = the three together, residents in Haven, and the latest status change. Counts only.';

-- One row per confirmed figure per saved revision. Append only, like the
-- revisions it belongs to; every read goes through the Stand Up command.
CREATE TABLE public.stand_up_roster_confirmations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 report_id uuid NOT NULL REFERENCES public.stand_up_reports(id),
 revision_id uuid NOT NULL REFERENCES public.stand_up_revisions(id),
 field_key text NOT NULL CHECK(field_key IN('current_total_census','hospital_and_rehab_total')),
 roster_suggested_value integer CHECK(roster_suggested_value IS NULL OR roster_suggested_value>=0),
 confirmed_value integer NOT NULL CHECK(confirmed_value>=0),
 source text NOT NULL CHECK(source IN('roster_confirmed','entered_no_roster','overridden')),
 override_reason text CHECK(override_reason IS NULL OR override_reason IN('roster_not_current','change_not_entered','different_definition','other')),
 roster_as_of timestamptz,
 confirmed_by uuid NOT NULL,
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((source='overridden')=(override_reason IS NOT NULL)),
 CHECK((source='entered_no_roster')=(roster_suggested_value IS NULL)),
 UNIQUE(revision_id,field_key)
);
CREATE INDEX idx_stand_up_roster_confirmations_report ON public.stand_up_roster_confirmations(report_id,field_key,confirmed_at DESC);
CREATE TRIGGER stand_up_roster_confirmation_immutable BEFORE UPDATE OR DELETE ON public.stand_up_roster_confirmations FOR EACH ROW EXECUTE FUNCTION haven.stand_up_immutable();
ALTER TABLE public.stand_up_roster_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stand_up_roster_confirmations FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.stand_up_roster_confirmations IS 'COL-351: what the roster suggested and what the administrator saved for census and hospital on each Stand Up revision. Source is decided by the server. Counts only; no resident identifiers.';

CREATE FUNCTION haven.stand_up_roster_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT ARRAY['current_total_census','hospital_and_rehab_total']::text[] $$;

-- Records the confirmations for one saved revision. The server recomputes the
-- suggestion at save time and decides the source; a client-supplied reason is
-- kept only when the saved figure actually differs from the roster.
CREATE FUNCTION haven.stand_up_roster_confirm(p jsonb,p_organization uuid,p_facility uuid,p_actor uuid,p_report uuid,p_revision uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE roster jsonb:=p->'roster'; c record; k text; v jsonb; entry jsonb; reason text; suggested integer; confirmed integer; src text;
BEGIN
 IF roster IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(roster)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(roster) x WHERE x<>ALL(haven.stand_up_roster_keys())) THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 SELECT * INTO c FROM public.stand_up_roster_census(p_organization,p_facility);
 FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
  v:=p->'values'->k;
  IF v IS NULL OR v='null'::jsonb THEN CONTINUE; END IF; -- a blank figure confirms nothing
  entry:=roster->k;
  IF entry IS NOT NULL AND jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  reason:=nullif(btrim(coalesce(entry->>'override_reason','')),'');
  IF reason IS NOT NULL AND reason NOT IN('roster_not_current','change_not_entered','different_definition','other') THEN RAISE EXCEPTION 'Invalid override reason'; END IF;
  confirmed:=(v#>>'{}')::numeric::integer;
  suggested:=CASE WHEN c.resident_count_in_haven=0 THEN NULL WHEN k='current_total_census' THEN c.roster_census_count ELSE c.hospital_hold_count END;
  src:=CASE WHEN suggested IS NULL THEN 'entered_no_roster' WHEN confirmed=suggested THEN 'roster_confirmed' ELSE 'overridden' END;
  IF src='overridden' AND reason IS NULL THEN
   RAISE EXCEPTION '% differs from the Haven roster (%). Choose why it is different or use the roster figure.',
    CASE WHEN k='current_total_census' THEN 'Current census' ELSE 'Residents at hospital or rehab' END,suggested USING ERRCODE='22023';
  END IF;
  IF src<>'overridden' THEN reason:=NULL; END IF;
  INSERT INTO public.stand_up_roster_confirmations(organization_id,facility_id,report_id,revision_id,field_key,roster_suggested_value,confirmed_value,source,override_reason,roster_as_of,confirmed_by)
  VALUES(p_organization,p_facility,p_report,p_revision,k,suggested,confirmed,src,reason,c.roster_as_of,p_actor);
 END LOOP;
END $$;

-- Confirmations recorded on one revision, keyed by field. Counts and tokens only.
CREATE FUNCTION haven.stand_up_roster_confirmations(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(c.field_key,jsonb_build_object('source',c.source,'suggested',c.roster_suggested_value,'confirmed',c.confirmed_value,
  'override_reason',c.override_reason,'roster_as_of',c.roster_as_of,'confirmed_at',c.confirmed_at)),'{}'::jsonb)
 FROM public.stand_up_roster_confirmations c WHERE c.revision_id=p_revision
$$;

-- The save keeps the 336 lock, receipt, CAS, validation and revision writes
-- exactly; the roster confirmation is written in the same transaction, after
-- the revision it belongs to and before the receipt, so a replayed request
-- returns its receipt and writes nothing twice.
CREATE OR REPLACE FUNCTION haven.stand_up_save(p jsonb,p_batch uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
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
  -- A past meeting keeps the confirmation recorded at the time; today's roster is not its evidence.
  IF p ? 'roster' THEN RAISE EXCEPTION 'Roster confirmation applies to the open reporting period only'; END IF;
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
 PERFORM haven.stand_up_roster_confirm(p,o,f,a,r.id,v_id);
 UPDATE public.stand_up_reports SET version=r.version+1,revision_id=v_id,values=p->'values',status=s,source_as_of=asof,updated_at=clock_timestamp() WHERE id=r.id RETURNING to_jsonb(stand_up_reports.*) INTO result;
 INSERT INTO public.stand_up_receipts(actor_id,request_id,payload,result) VALUES(a,request,p,result);
 RETURN result;
END $$;

-- Every report and revision response now carries its recorded confirmations.
CREATE OR REPLACE FUNCTION haven.stand_up_revision_metadata(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'overtime_minutes',v.overtime_minutes,'overtime_issue',v.overtime_issue,
  'entry_origin',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(v.values) kv WHERE kv.value<>'null'::jsonb) THEN 'initialized'
    WHEN v.batch_id IS NOT NULL THEN 'imported'
    WHEN EXISTS(SELECT 1 FROM public.stand_up_recovery_decisions d WHERE d.result->>'revision_id'=v.id::text) THEN 'recovery'
    ELSE 'manual' END,
  'updated_by',v.actor_id,
  'updated_by_name',(SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id),
  'first_submitted_at',(SELECT min(s.created_at) FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready'),
  'last_submitted_at',(SELECT s.created_at FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1),
  'last_submitted_revision_id',(SELECT s.id FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1),
  'field_dispositions',haven.stand_up_field_dispositions(v.id),
  'roster_confirmations',haven.stand_up_roster_confirmations(v.id)
 ) FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE v.id=p_revision
$$;

-- The suggestion an administrator sees before saving. Same authorization as
-- entering the report: the facility grant is asserted, then counts are read.
CREATE FUNCTION haven.stand_up_roster_suggestion(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE f uuid; o uuid; c record;
BEGIN
 f:=(p_payload->>'facility_id')::uuid;
 IF f IS NULL THEN RAISE EXCEPTION 'Facility required'; END IF;
 o:=haven.stand_up_assert(f);
 SELECT * INTO c FROM public.stand_up_roster_census(o,f);
 RETURN jsonb_build_object('facility_id',f,'in_house_count',c.in_house_count,'hospital_hold_count',c.hospital_hold_count,'loa_count',c.loa_count,
  'roster_census_count',c.roster_census_count,'resident_count_in_haven',c.resident_count_in_haven,'roster_as_of',c.roster_as_of,'server_now',clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb;
BEGIN
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 IF p_action='roster' THEN RETURN haven.stand_up_roster_suggestion(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  SELECT coalesce(jsonb_agg(x||coalesce(haven.stand_up_revision_metadata((x->>'revision_id')::uuid),'{}') ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  RETURN result||jsonb_build_object('reports',reports,'server_now',clock_timestamp(),'actor_role',haven.app_role()::text);
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||coalesce(haven.stand_up_revision_metadata((result->>'revision_id')::uuid),'{}');
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_roster_keys(),haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid),haven.stand_up_roster_confirmations(uuid),haven.stand_up_roster_suggestion(jsonb),haven.stand_up_save(jsonb,uuid),haven.stand_up_revision_metadata(uuid),haven.stand_up_command(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.stand_up_command(text,jsonb) TO authenticated;
COMMENT ON FUNCTION haven.stand_up_roster_suggestion(jsonb) IS 'COL-351: roster counts for the Stand Up form (command action roster). Reachable only through the authorized Stand Up command.';
NOTIFY pgrst,'reload schema';
COMMIT;
-- Rollback: restore the 338 definitions of haven.stand_up_revision_metadata and
-- haven.stand_up_command and the 336 definition of haven.stand_up_save, then DROP
-- FUNCTION haven.stand_up_roster_suggestion(jsonb), haven.stand_up_roster_confirmations(uuid),
-- haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid), haven.stand_up_roster_keys(),
-- public.stand_up_roster_census(uuid,uuid) and TABLE public.stand_up_roster_confirmations
-- (append-only evidence; keep it while any confirmed report exists).
