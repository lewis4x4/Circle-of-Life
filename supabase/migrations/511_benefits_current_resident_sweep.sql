-- Created with supabase migration new; repository claim 511. COL-765 (Medicaid Amendment A, build 3).
-- Current-resident sweep: the admission Medicaid questions only reach new admissions, so an owner starts a
-- one-time sweep per facility and the facility administrator asks every current resident once.
-- "Current" = status active, hospital_hold or loa. "Answered" = any admission screening on record. Both are
-- computed live, so progress can never drift from the answers themselves. Residents already on Medicaid are
-- answered with coverage "enrolled" (Haven has no long-term-care payer type to infer it from).
-- Starting a sweep changes nothing else; the owner decides when (Brian cleans up records first).
BEGIN;

CREATE TABLE public.benefits_sweeps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL UNIQUE REFERENCES public.facilities(id), started_by uuid NOT NULL REFERENCES public.user_profiles(id),
 started_at timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL UNIQUE,
 note text CHECK(length(note)<=2000)
);
ALTER TABLE public.benefits_sweeps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benefits_sweeps FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER benefits_immutable BEFORE UPDATE OR DELETE ON public.benefits_sweeps FOR EACH ROW EXECUTE FUNCTION haven.benefits_immutable();
CREATE TRIGGER tr_benefits_sweeps_audit AFTER INSERT OR UPDATE OR DELETE ON public.benefits_sweeps FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION haven.benefits_sweep_start_internal(p_facility_id uuid,p_note text,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); s public.benefits_sweeps; f public.facilities; BEGIN
 IF p_request_id IS NULL OR p_facility_id IS NULL OR length(coalesce(p_note,''))>2000 THEN RAISE EXCEPTION 'Choose the facility' USING ERRCODE='22023'; END IF;
 IF NOT (a->>'admin')::boolean THEN RAISE EXCEPTION 'An owner or organization administrator starts the sweep' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facilities WHERE id=p_facility_id AND organization_id=(a->>'org')::uuid AND deleted_at IS NULL;
 IF f.id IS NULL OR NOT haven.has_facility_access(p_facility_id) THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('benefits-sweep:'||p_facility_id,0));
 SELECT * INTO s FROM public.benefits_sweeps WHERE facility_id=p_facility_id;
 IF FOUND THEN
  -- Starting twice is harmless: the existing sweep stands and is returned.
  RETURN jsonb_build_object('sweep_id',s.id,'facility_id',s.facility_id,'started_at',s.started_at,'already_started',true);
 END IF;
 INSERT INTO public.benefits_sweeps(organization_id,facility_id,started_by,request_id,note) VALUES(f.organization_id,f.id,(a->>'id')::uuid,p_request_id,nullif(btrim(p_note),'')) RETURNING * INTO s;
 RETURN jsonb_build_object('sweep_id',s.id,'facility_id',s.facility_id,'started_at',s.started_at,'already_started',false);
END $$;

-- Per facility the actor may read: whether a sweep started, how many current residents, how many answered;
-- with a facility filter, the residents still to ask (up to 300).
CREATE OR REPLACE FUNCTION haven.benefits_sweep_status_internal(p_facility_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb:=haven.benefits_actor(); BEGIN
 IF p_facility_id IS NOT NULL AND NOT haven.benefits_permission(p_facility_id,'read') THEN RAISE EXCEPTION 'Facility unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id)) THEN RAISE EXCEPTION 'Benefits access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('can_start',(a->>'admin')::boolean,'facilities',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.facility_name) FROM (
  SELECT f.id facility_id,f.name facility_name,s.started_at,sp.full_name started_by_name,
   haven.benefits_permission(f.id,'write') can_write,
   (SELECT count(*) FROM public.residents r WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')) total,
   (SELECT count(*) FROM public.residents r WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')
     AND EXISTS(SELECT 1 FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id)) answered,
   CASE WHEN p_facility_id IS NOT NULL THEN coalesce((SELECT jsonb_agg(jsonb_build_object('resident_id',r.id,'resident_name',r.first_name||' '||r.last_name,'status',r.status::text) ORDER BY r.last_name,r.first_name,r.id)
     FROM (SELECT * FROM public.residents r WHERE r.facility_id=f.id AND r.deleted_at IS NULL AND r.status IN ('active','hospital_hold','loa')
      AND NOT EXISTS(SELECT 1 FROM public.benefits_admission_screenings x WHERE x.resident_id=r.id) ORDER BY r.last_name,r.first_name,r.id LIMIT 300) r),'[]') END remaining
  FROM public.facilities f LEFT JOIN public.benefits_sweeps s ON s.facility_id=f.id LEFT JOIN public.user_profiles sp ON sp.id=s.started_by
  WHERE f.organization_id=(a->>'org')::uuid AND f.deleted_at IS NULL AND haven.benefits_permission(f.id,'read') AND (p_facility_id IS NULL OR f.id=p_facility_id)) q),'[]'));
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='haven' AND p.proname IN ('benefits_sweep_start_internal','benefits_sweep_status_internal') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
CREATE FUNCTION public.benefits_sweep_start(p_facility_id uuid,p_note text,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_sweep_start_internal(p_facility_id,p_note,p_request_id); $$;
CREATE FUNCTION public.benefits_sweep_status(p_facility_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT haven.benefits_sweep_status_internal(p_facility_id); $$;
REVOKE ALL ON FUNCTION public.benefits_sweep_start(uuid,text,uuid),public.benefits_sweep_status(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.benefits_sweep_start(uuid,text,uuid),haven.benefits_sweep_start_internal(uuid,text,uuid),
 public.benefits_sweep_status(uuid),haven.benefits_sweep_status_internal(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
