-- COL-804: role-specific work presets and actual published assignment intervals.
-- Clinical cadence definitions retain their independent complete-day partition.
BEGIN;
CREATE FUNCTION haven.schedule_blocks_valid(p_blocks jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b jsonb; starts integer; ends integer; previous_end integer:=-1;
BEGIN
 IF p_blocks IS NULL OR jsonb_typeof(p_blocks)<>'array' OR jsonb_array_length(p_blocks) NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  IF jsonb_typeof(b)<>'object' OR NOT b ?& ARRAY['start','end'] OR (SELECT count(*) FROM jsonb_object_keys(b))<>2 OR NOT(coalesce(b->>'start','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$') OR NOT(coalesce(b->>'end','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RETURN false; END IF;
  starts:=extract(epoch FROM (b->>'start')::time)::integer/60; ends:=extract(epoch FROM (b->>'end')::time)::integer/60;
  IF starts=ends OR starts<previous_end THEN RETURN false; END IF;
  IF ends<starts THEN ends:=ends+1440; END IF;
  previous_end:=ends;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION haven.schedule_blocks_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_blocks_valid(jsonb) TO authenticated,service_role;
-- Read only the effective job role; never widen payroll-bearing staff SELECT.
CREATE FUNCTION haven.schedule_staff_role_internal(p_staff uuid,p_facility uuid,p_from date,p_to date) RETURNS public.staff_role
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE employee public.staff; target public.facilities; day date; roles public.staff_role[]; resolved public.staff_role; previous public.staff_role;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>2 THEN RETURN NULL; END IF;
 SELECT * INTO target FROM public.facilities WHERE id=p_facility AND deleted_at IS NULL;
 SELECT * INTO employee FROM public.staff WHERE id=p_staff AND organization_id=target.organization_id AND deleted_at IS NULL AND employment_status='active';
 IF employee.id IS NULL OR target.id IS NULL THEN RETURN NULL; END IF;

 FOR day IN SELECT generate_series(p_from::timestamp,p_to::timestamp,interval '1 day')::date LOOP
  SELECT array_agg(DISTINCT coalesce(a.role_at_facility,employee.staff_role)) INTO roles FROM public.staff_facility_assignments a WHERE a.staff_id=p_staff AND a.facility_id=p_facility AND a.organization_id=target.organization_id AND a.deleted_at IS NULL AND a.start_date<=day AND (a.end_date IS NULL OR a.end_date>=day);
  IF cardinality(roles)>1 THEN RAISE EXCEPTION 'Conflicting facility role assignments require review'; END IF;
  resolved:=CASE WHEN cardinality(roles)=1 THEN roles[1] WHEN employee.facility_id=p_facility THEN employee.staff_role END;
  IF resolved IS NULL THEN RETURN NULL; END IF;
  IF previous IS NOT NULL AND resolved<>previous THEN RAISE EXCEPTION 'Facility role changes inside this work block'; END IF;
  previous:=resolved;
 END LOOP;RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION haven.schedule_staff_role_internal(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.schedule_staff_role(p_staff uuid,p_facility uuid,p_from date,p_to date) RETURNS public.staff_role LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility AND organization_id=haven.organization_id() AND deleted_at IS NULL) OR NOT haven.has_facility_access(p_facility) OR (haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') AND NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_staff AND user_id=auth.uid()))) THEN RETURN NULL; END IF;
 RETURN haven.schedule_staff_role_internal(p_staff,p_facility,p_from,p_to);
END $$;
REVOKE ALL ON FUNCTION haven.schedule_staff_role(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_staff_role(uuid,uuid,date,date) TO authenticated,service_role;
CREATE TABLE public.facility_schedule_presets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),facility_id uuid NOT NULL REFERENCES public.facilities(id),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 60),color text NOT NULL CHECK(color~'^#[0-9A-Fa-f]{6}$'),
 allowed_staff_roles public.staff_role[] NOT NULL CHECK(cardinality(allowed_staff_roles)>0 AND array_position(allowed_staff_roles,NULL) IS NULL),
 rounding_coverage boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),active boolean NOT NULL DEFAULT true,
 blocks jsonb NOT NULL CHECK(haven.schedule_blocks_valid(blocks)),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 roster_shift_type public.shift_type NOT NULL DEFAULT 'custom',source_shift_definition_id uuid UNIQUE REFERENCES public.facility_shift_definitions(id),
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES public.user_profiles(id),updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES public.user_profiles(id),deleted_at timestamptz
);
CREATE INDEX idx_schedule_presets_facility ON public.facility_schedule_presets(organization_id,facility_id,sort_order) WHERE deleted_at IS NULL;
ALTER TABLE public.facility_schedule_presets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_schedule_presets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.facility_schedule_presets TO authenticated;
GRANT SELECT ON public.facility_schedule_presets TO service_role;
CREATE POLICY schedule_presets_read ON public.facility_schedule_presets FOR SELECT TO authenticated USING(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()));
CREATE POLICY schedule_presets_insert ON public.facility_schedule_presets FOR INSERT TO authenticated WITH CHECK(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','manager'));
CREATE POLICY schedule_presets_update ON public.facility_schedule_presets FOR UPDATE TO authenticated USING(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','manager')) WITH CHECK(organization_id=(SELECT haven.organization_id()) AND facility_id IN(SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role()) IN('owner','org_admin','facility_admin','manager'));
-- Existing choices alone are imported. All job roles can keep using these legacy
-- choices until a facility explicitly limits them; no hours are invented.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.facility_shift_definitions WHERE deleted_at IS NULL AND (extract(second FROM starts_at_local)<>0 OR extract(second FROM ends_at_local)<>0)) THEN RAISE EXCEPTION 'Existing sub-minute shift times require explicit preservation before preset import'; END IF;END $$;
INSERT INTO public.facility_schedule_presets(organization_id,facility_id,label,color,allowed_staff_roles,sort_order,active,blocks,roster_shift_type,source_shift_definition_id,rounding_coverage,created_by,updated_by)
 SELECT organization_id,facility_id,label,'#64748B',enum_range(NULL::public.staff_role),sort_order,active,jsonb_build_array(jsonb_build_object('start',to_char(starts_at_local,'HH24:MI'),'end',to_char(ends_at_local,'HH24:MI'))),roster_shift_type,id,true,created_by,updated_by
 FROM public.facility_shift_definitions WHERE deleted_at IS NULL AND starts_at_local<>ends_at_local AND starts_at_local<'24:00'::time AND ends_at_local<'24:00'::time;
CREATE FUNCTION haven.guard_schedule_preset() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deactivate a shift option instead of deleting its history'; END IF;
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') OR NEW.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.has_facility_access(NEW.facility_id) THEN RAISE EXCEPTION 'Schedule manager access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.facilities WHERE id=NEW.facility_id AND organization_id=NEW.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Shift option facility unavailable'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.created_by:=auth.uid();NEW.created_at:=clock_timestamp();NEW.version:=1;
  IF NEW.source_shift_definition_id IS NOT NULL OR NEW.roster_shift_type<>'custom' THEN RAISE EXCEPTION 'New shift options use custom classification'; END IF;
 ELSE
  IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.created_at,NEW.created_by,NEW.source_shift_definition_id,NEW.roster_shift_type) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.created_at,OLD.created_by,OLD.source_shift_definition_id,OLD.roster_shift_type) THEN RAISE EXCEPTION 'Shift option identity is immutable'; END IF;
  IF OLD.deleted_at IS NOT NULL OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Shift option changed. Reload before saving.' USING ERRCODE='40001'; END IF;
 END IF;
 IF NEW.deleted_at IS NOT NULL THEN NEW.active:=false; END IF;
 NEW.label:=trim(NEW.label);NEW.color:=upper(NEW.color);NEW.updated_by:=auth.uid();NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER schedule_preset_guard BEFORE INSERT OR UPDATE OR DELETE ON public.facility_schedule_presets FOR EACH ROW EXECUTE FUNCTION haven.guard_schedule_preset();
CREATE TRIGGER schedule_preset_audit AFTER INSERT OR UPDATE ON public.facility_schedule_presets FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
REVOKE ALL ON FUNCTION haven.guard_schedule_preset() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.schedule_preset_save(p_facility_id uuid,p_preset_id uuid,p_expected_version integer,p_label text,p_color text,p_sort_order integer,p_blocks jsonb,p_allowed_staff_roles public.staff_role[],p_active boolean DEFAULT true,p_deleted boolean DEFAULT false,p_rounding_coverage boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.facility_schedule_presets;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') OR NOT haven.has_facility_access(p_facility_id) THEN RAISE EXCEPTION 'Schedule manager access required' USING ERRCODE='42501'; END IF;
 IF p_active IS NULL OR p_deleted IS NULL OR p_rounding_coverage IS NULL THEN RAISE EXCEPTION 'Shift option state required'; END IF;
 IF p_preset_id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 OR p_deleted THEN RAISE EXCEPTION 'New shift option requires version zero'; END IF;
  INSERT INTO public.facility_schedule_presets(organization_id,facility_id,label,color,sort_order,blocks,allowed_staff_roles,active,rounding_coverage) VALUES(haven.organization_id(),p_facility_id,p_label,p_color,p_sort_order,p_blocks,p_allowed_staff_roles,p_active,p_rounding_coverage) RETURNING * INTO p;
 ELSE
  UPDATE public.facility_schedule_presets SET label=p_label,color=p_color,sort_order=p_sort_order,blocks=p_blocks,allowed_staff_roles=p_allowed_staff_roles,active=p_active,rounding_coverage=p_rounding_coverage,deleted_at=CASE WHEN p_deleted THEN clock_timestamp() END,version=version+1 WHERE id=p_preset_id AND facility_id=p_facility_id AND deleted_at IS NULL AND version=p_expected_version RETURNING * INTO p;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Shift option changed or unavailable. Reload before saving.' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.schedule_preset_save(uuid,uuid,integer,text,text,integer,jsonb,public.staff_role[],boolean,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_preset_save(uuid,uuid,integer,text,text,integer,jsonb,public.staff_role[],boolean,boolean,boolean) TO authenticated;

ALTER TABLE public.shift_assignments
 ADD COLUMN schedule_preset_id uuid REFERENCES public.facility_schedule_presets(id),ADD COLUMN schedule_preset_name text,ADD COLUMN schedule_preset_color text,
 ADD COLUMN schedule_preset_version integer,ADD COLUMN schedule_rounding_coverage boolean,ADD COLUMN schedule_role_snapshot public.staff_role,ADD COLUMN schedule_time_zone text,
 ADD COLUMN schedule_starts_at timestamptz,ADD COLUMN schedule_ends_at timestamptz,ADD COLUMN schedule_group_id uuid,
 ADD COLUMN schedule_block_index integer,ADD COLUMN schedule_block_count integer,ADD COLUMN schedule_copied_from_assignment_id uuid REFERENCES public.shift_assignments(id),
 ADD CONSTRAINT schedule_snapshot_shape CHECK((schedule_group_id IS NULL AND schedule_preset_id IS NULL AND schedule_preset_name IS NULL AND schedule_preset_color IS NULL AND schedule_preset_version IS NULL AND schedule_block_index IS NULL AND schedule_block_count IS NULL) OR
 (schedule_group_id IS NOT NULL AND schedule_preset_name IS NOT NULL AND schedule_preset_color IS NOT NULL AND schedule_block_index IS NOT NULL AND schedule_block_count IS NOT NULL AND ((schedule_preset_id IS NOT NULL AND schedule_preset_version IS NOT NULL AND schedule_preset_version>0) OR (schedule_preset_id IS NULL AND schedule_preset_version IS NULL AND schedule_preset_name='Custom')) AND length(schedule_preset_name) BETWEEN 1 AND 60 AND schedule_preset_color~'^#[0-9A-Fa-f]{6}$' AND schedule_block_count BETWEEN 1 AND 8 AND schedule_block_index>=0 AND schedule_block_index<schedule_block_count)),
 ADD CONSTRAINT schedule_interval_shape CHECK((schedule_starts_at IS NULL AND schedule_ends_at IS NULL) OR (schedule_time_zone IS NOT NULL AND schedule_starts_at IS NOT NULL AND schedule_ends_at IS NOT NULL AND schedule_ends_at>schedule_starts_at));
CREATE UNIQUE INDEX idx_schedule_assignment_group_block ON public.shift_assignments(schedule_group_id,schedule_block_index) WHERE schedule_group_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_schedule_assignment_interval ON public.shift_assignments(facility_id,schedule_starts_at,schedule_ends_at) WHERE deleted_at IS NULL;
CREATE FUNCTION haven.stamp_schedule_assignment_interval() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tz text; job public.staff_role; phase public.schedule_status; p public.facility_schedule_presets; origin public.shift_assignments; changed boolean; block jsonb;
BEGIN
 SELECT status INTO phase FROM public.schedules WHERE id=NEW.schedule_id;
 IF NEW.covers_assignment_id IS NOT NULL AND NEW.schedule_copied_from_assignment_id IS NOT NULL THEN RAISE EXCEPTION 'Choose copy or coverage provenance, not both'; END IF;
 IF phase<>'published' AND NEW.covers_assignment_id IS NOT NULL AND NEW.deleted_at IS NULL THEN RAISE EXCEPTION 'Call-out covers belong only to an already published schedule'; END IF;
 IF TG_OP='UPDATE' AND phase<>'draft' THEN
  IF (NEW.schedule_preset_id,NEW.schedule_preset_name,NEW.schedule_preset_color,NEW.schedule_preset_version,NEW.schedule_role_snapshot,NEW.schedule_time_zone,NEW.schedule_starts_at,NEW.schedule_ends_at,NEW.schedule_group_id,NEW.schedule_block_index,NEW.schedule_block_count,NEW.schedule_copied_from_assignment_id,NEW.schedule_rounding_coverage) IS DISTINCT FROM (OLD.schedule_preset_id,OLD.schedule_preset_name,OLD.schedule_preset_color,OLD.schedule_preset_version,OLD.schedule_role_snapshot,OLD.schedule_time_zone,OLD.schedule_starts_at,OLD.schedule_ends_at,OLD.schedule_group_id,OLD.schedule_block_index,OLD.schedule_block_count,OLD.schedule_copied_from_assignment_id,OLD.schedule_rounding_coverage) THEN RAISE EXCEPTION 'Published assignment snapshots are immutable'; END IF;
  RETURN NEW;
 END IF;
 changed:=TG_OP='INSERT' OR (NEW.staff_id,NEW.shift_date,NEW.shift_type,NEW.custom_start_time,NEW.custom_end_time,NEW.shift_definition_id,NEW.covers_assignment_id,NEW.schedule_preset_id,NEW.schedule_preset_version,NEW.schedule_group_id,NEW.schedule_block_index,NEW.schedule_block_count,NEW.schedule_copied_from_assignment_id,NEW.schedule_rounding_coverage) IS DISTINCT FROM (OLD.staff_id,OLD.shift_date,OLD.shift_type,OLD.custom_start_time,OLD.custom_end_time,OLD.shift_definition_id,OLD.covers_assignment_id,OLD.schedule_preset_id,OLD.schedule_preset_version,OLD.schedule_group_id,OLD.schedule_block_index,OLD.schedule_block_count,OLD.schedule_copied_from_assignment_id,OLD.schedule_rounding_coverage) OR (OLD.schedule_time_zone IS NULL AND NEW.schedule_time_zone IS NOT NULL);
 IF NOT changed THEN
  IF (NEW.schedule_preset_name,NEW.schedule_preset_color,NEW.schedule_role_snapshot,NEW.schedule_time_zone,NEW.schedule_starts_at,NEW.schedule_ends_at,NEW.schedule_rounding_coverage) IS DISTINCT FROM (OLD.schedule_preset_name,OLD.schedule_preset_color,OLD.schedule_role_snapshot,OLD.schedule_time_zone,OLD.schedule_starts_at,OLD.schedule_ends_at,OLD.schedule_rounding_coverage) THEN RAISE EXCEPTION 'Assignment snapshot fields are derived from its selected work block'; END IF;
  RETURN NEW;
 END IF;
 SELECT timezone INTO tz FROM public.facilities WHERE id=NEW.facility_id;
 job:=haven.schedule_staff_role(NEW.staff_id,NEW.facility_id,NEW.shift_date,NEW.shift_date+CASE WHEN NEW.custom_end_time<NEW.custom_start_time AND NEW.custom_end_time>'00:00'::time THEN 1 ELSE 0 END);
 IF job IS NULL THEN RAISE EXCEPTION 'Facility membership must cover the entire work block'; END IF;
 IF NEW.schedule_copied_from_assignment_id IS NOT NULL OR NEW.covers_assignment_id IS NOT NULL THEN
  SELECT * INTO origin FROM public.shift_assignments WHERE id=coalesce(NEW.covers_assignment_id,NEW.schedule_copied_from_assignment_id) AND organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND deleted_at IS NULL;
  IF origin.id IS NULL OR (NEW.custom_start_time,NEW.custom_end_time) IS DISTINCT FROM(origin.custom_start_time,origin.custom_end_time) THEN RAISE EXCEPTION 'Copied work snapshot must match its recorded source'; END IF;
  IF NEW.covers_assignment_id IS NULL AND (origin.covers_assignment_id IS NOT NULL OR NOT haven.schedule_cell_intact(origin.schedule_id,origin.staff_id,origin.shift_date)) THEN RAISE EXCEPTION 'Copy must reference an intact original work plan, not one-off coverage'; END IF;
  IF NEW.covers_assignment_id IS NULL AND (NEW.staff_id<>origin.staff_id OR NEW.shift_date<>origin.shift_date+7 OR NOT EXISTS(SELECT 1 FROM public.schedules oldweek JOIN public.schedules newweek ON newweek.id=NEW.schedule_id WHERE oldweek.id=origin.schedule_id AND oldweek.deleted_at IS NULL AND newweek.week_start_date=oldweek.week_start_date+7)) THEN RAISE EXCEPTION 'Copied work snapshot must reference the previous week'; END IF;
  NEW.schedule_preset_id:=origin.schedule_preset_id;NEW.schedule_preset_name:=origin.schedule_preset_name;NEW.schedule_preset_color:=origin.schedule_preset_color;NEW.schedule_preset_version:=origin.schedule_preset_version;NEW.schedule_rounding_coverage:=origin.schedule_rounding_coverage;
  tz:=coalesce(origin.schedule_time_zone,tz);
  IF NEW.covers_assignment_id IS NULL THEN NEW.schedule_block_index:=origin.schedule_block_index;NEW.schedule_block_count:=origin.schedule_block_count;END IF;
  IF origin.schedule_preset_id IS NOT NULL AND job IS DISTINCT FROM origin.schedule_role_snapshot THEN RAISE EXCEPTION 'Employee role changed since the copied plan. Choose an eligible shift option.'; END IF;
 ELSE
  IF NEW.schedule_time_zone IS NOT NULL AND NEW.schedule_time_zone<>tz THEN RAISE EXCEPTION 'Work block timezone must match its facility'; END IF;
  IF NEW.schedule_preset_id IS NOT NULL THEN
   SELECT * INTO p FROM public.facility_schedule_presets WHERE id=NEW.schedule_preset_id AND organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND active AND deleted_at IS NULL;
   IF p.id IS NULL OR p.version IS DISTINCT FROM NEW.schedule_preset_version OR NOT job=ANY(p.allowed_staff_roles) THEN RAISE EXCEPTION 'Current eligible shift option version required'; END IF;
   block:=p.blocks->NEW.schedule_block_index;
   IF NEW.schedule_block_count IS DISTINCT FROM jsonb_array_length(p.blocks) OR block IS NULL OR (NEW.custom_start_time,NEW.custom_end_time) IS DISTINCT FROM((block->>'start')::time,(block->>'end')::time) THEN RAISE EXCEPTION 'Work block times must match its selected option'; END IF;
   NEW.schedule_preset_name:=p.label;NEW.schedule_preset_color:=p.color;NEW.shift_type:=p.roster_shift_type;NEW.schedule_rounding_coverage:=p.rounding_coverage;
  ELSIF NEW.schedule_group_id IS NOT NULL THEN
   NEW.schedule_preset_name:='Custom';NEW.schedule_preset_color:='#64748B';NEW.schedule_preset_version:=NULL;NEW.shift_type:='custom';NEW.schedule_rounding_coverage:=coalesce(NEW.schedule_rounding_coverage,false);
  ELSE NEW.schedule_preset_name:=NULL;NEW.schedule_preset_color:=NULL;NEW.schedule_preset_version:=NULL;NEW.schedule_rounding_coverage:=coalesce(NEW.schedule_rounding_coverage,NEW.shift_definition_id IS NOT NULL OR NEW.shift_type<>'custom');END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN RAISE EXCEPTION 'Valid facility timezone required'; END IF;
 NEW.schedule_role_snapshot:=job;
 IF NEW.custom_start_time IS NOT NULL AND NEW.custom_end_time IS NOT NULL AND NEW.custom_start_time<>NEW.custom_end_time THEN
  NEW.schedule_time_zone:=tz;NEW.schedule_starts_at:=(NEW.shift_date+NEW.custom_start_time) AT TIME ZONE tz;
  NEW.schedule_ends_at:=(NEW.shift_date+CASE WHEN NEW.custom_end_time<NEW.custom_start_time THEN 1 ELSE 0 END+NEW.custom_end_time) AT TIME ZONE tz;
  IF (NEW.schedule_starts_at AT TIME ZONE tz) IS DISTINCT FROM (NEW.shift_date+NEW.custom_start_time) OR (NEW.schedule_ends_at AT TIME ZONE tz) IS DISTINCT FROM (NEW.shift_date+CASE WHEN NEW.custom_end_time<NEW.custom_start_time THEN 1 ELSE 0 END+NEW.custom_end_time) THEN RAISE EXCEPTION 'Shift time does not exist in the facility timezone'; END IF;
 ELSE NEW.schedule_starts_at:=NULL;NEW.schedule_ends_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_stamp_assignment_interval BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION haven.stamp_schedule_assignment_interval();
REVOKE ALL ON FUNCTION haven.stamp_schedule_assignment_interval() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.schedule_people_for_week(p_schedule_id uuid)
RETURNS TABLE(id uuid,facility_id uuid,first_name text,last_name text,staff_role public.staff_role,employment_status public.employment_status,role_assignments jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.schedules;
BEGIN
 SELECT * INTO w FROM public.schedules WHERE schedules.id=p_schedule_id AND organization_id=haven.organization_id() AND deleted_at IS NULL;
 IF auth.uid() IS NULL OR w.id IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') OR NOT haven.has_facility_access(w.facility_id) THEN RAISE EXCEPTION 'Schedule manager access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.id,s.facility_id,s.first_name,s.last_name,s.staff_role,s.employment_status,
 coalesce((SELECT jsonb_agg(jsonb_build_object('role_at_facility',a.role_at_facility,'start_date',a.start_date,'end_date',a.end_date) ORDER BY a.start_date,a.id) FROM public.staff_facility_assignments a WHERE a.staff_id=s.id AND a.facility_id=w.facility_id AND a.organization_id=w.organization_id AND a.deleted_at IS NULL AND a.start_date<=w.week_start_date+7 AND (a.end_date IS NULL OR a.end_date>=w.week_start_date)),'[]'::jsonb)
 FROM public.staff s WHERE s.organization_id=w.organization_id AND ((s.deleted_at IS NULL AND (s.facility_id=w.facility_id OR EXISTS(SELECT 1 FROM public.staff_facility_assignments a WHERE a.staff_id=s.id AND a.facility_id=w.facility_id AND a.organization_id=w.organization_id AND a.deleted_at IS NULL AND a.start_date<=w.week_start_date+6 AND (a.end_date IS NULL OR a.end_date>=w.week_start_date)))) OR EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.staff_id=s.id AND a.schedule_id=w.id AND a.deleted_at IS NULL)) ORDER BY s.last_name,s.first_name,s.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_people_for_week(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_people_for_week(uuid) TO authenticated;
CREATE FUNCTION public.schedule_assignment_intervals(p_facility_id uuid,p_from timestamptz,p_to timestamptz,p_staff_id uuid DEFAULT NULL)
RETURNS TABLE(assignment_id uuid,schedule_id uuid,staff_id uuid,facility_id uuid,service_date date,starts_at timestamptz,ends_at timestamptz,time_zone text,preset_id uuid,preset_version integer,label text,color text,staff_role public.staff_role,group_id uuid,block_index integer,block_count integer,legacy_shift_type public.shift_type,status public.shift_assignment_status,is_legacy boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT a.id,a.schedule_id,a.staff_id,a.facility_id,a.shift_date,t.starts_at,t.ends_at,t.tz,a.schedule_preset_id,a.schedule_preset_version,
 coalesce(a.schedule_preset_name,CASE WHEN a.shift_type='custom' THEN 'Custom' ELSE initcap(a.shift_type::text) END),coalesce(a.schedule_preset_color,'#64748B'),coalesce(a.schedule_role_snapshot,haven.schedule_staff_role(a.staff_id,a.facility_id,a.shift_date,a.shift_date)),a.schedule_group_id,a.schedule_block_index,a.schedule_block_count,a.shift_type,a.status,a.schedule_starts_at IS NULL
 FROM public.shift_assignments a JOIN public.schedules w ON w.id=a.schedule_id AND w.status='published' AND w.deleted_at IS NULL
 JOIN public.facilities f ON f.id=a.facility_id AND f.organization_id=a.organization_id AND f.deleted_at IS NULL
 CROSS JOIN LATERAL(SELECT coalesce(a.schedule_time_zone,f.timezone) tz) z
 CROSS JOIN LATERAL(SELECT coalesce(a.schedule_starts_at,(a.shift_date+a.custom_start_time) AT TIME ZONE z.tz) starts_at,coalesce(a.schedule_ends_at,(a.shift_date+CASE WHEN a.custom_end_time<a.custom_start_time THEN 1 ELSE 0 END+a.custom_end_time) AT TIME ZONE z.tz) ends_at,z.tz) t
 WHERE (a.facility_id=p_facility_id OR (p_facility_id IS NULL AND p_staff_id IS NOT NULL)) AND (p_staff_id IS NULL OR a.staff_id=p_staff_id) AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed') AND p_to>p_from AND t.starts_at<p_to AND t.ends_at>p_from AND t.ends_at>t.starts_at AND haven.schedule_staff_role(a.staff_id,a.facility_id,a.shift_date,((t.ends_at-interval '1 microsecond') AT TIME ZONE t.tz)::date) IS NOT NULL
 ORDER BY t.starts_at,a.staff_id,a.id;
$$;
REVOKE ALL ON FUNCTION public.schedule_assignment_intervals(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_assignment_intervals(uuid,timestamptz,timestamptz,uuid) TO authenticated,service_role;

-- A Boolean conflict check can see another authorized employee's work at a
-- different building without exposing that building's roster to the caller.
CREATE FUNCTION haven.schedule_employee_overlap(p_assignment uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.shift_assignments; tz text; starts timestamptz; ends timestamptz;
BEGIN
 SELECT * INTO a FROM public.shift_assignments WHERE id=p_assignment AND deleted_at IS NULL AND status NOT IN('called_out','no_show');
 IF a.id IS NULL THEN RETURN false; END IF;
 IF auth.uid() IS NOT NULL AND (a.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.has_facility_access(a.facility_id) OR (haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') AND NOT EXISTS(SELECT 1 FROM public.staff s WHERE s.id=a.staff_id AND s.user_id=auth.uid()))) THEN RAISE EXCEPTION 'Assignment scope is not authorized' USING ERRCODE='42501'; END IF;
 SELECT timezone INTO tz FROM public.facilities WHERE id=a.facility_id;
 starts:=coalesce(a.schedule_starts_at,(a.shift_date+a.custom_start_time) AT TIME ZONE coalesce(a.schedule_time_zone,tz));
 ends:=coalesce(a.schedule_ends_at,(a.shift_date+CASE WHEN a.custom_end_time<a.custom_start_time THEN 1 ELSE 0 END+a.custom_end_time) AT TIME ZONE coalesce(a.schedule_time_zone,tz));
 RETURN EXISTS(SELECT 1 FROM public.shift_assignments b JOIN public.schedules w ON w.id=b.schedule_id AND w.deleted_at IS NULL AND w.status<>'archived' JOIN public.facilities f ON f.id=b.facility_id
 WHERE b.staff_id=a.staff_id AND b.organization_id=a.organization_id AND b.id<>a.id AND b.deleted_at IS NULL AND b.status NOT IN('called_out','no_show')
 AND tstzrange(starts,ends,'[)') && tstzrange(coalesce(b.schedule_starts_at,(b.shift_date+b.custom_start_time) AT TIME ZONE coalesce(b.schedule_time_zone,f.timezone)),coalesce(b.schedule_ends_at,(b.shift_date+CASE WHEN b.custom_end_time<b.custom_start_time THEN 1 ELSE 0 END+b.custom_end_time) AT TIME ZONE coalesce(b.schedule_time_zone,f.timezone)),'[)')
 AND starts IS NOT NULL AND ends IS NOT NULL AND b.custom_start_time IS NOT NULL AND b.custom_end_time IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION haven.schedule_employee_overlap(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_employee_overlap(uuid) TO authenticated;
CREATE FUNCTION haven.schedule_credentials_current(p_staff uuid,p_facility uuid,p_date date) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') OR NOT haven.has_facility_access(p_facility) OR haven.schedule_staff_role(p_staff,p_facility,p_date,p_date) IS NULL THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=p_staff AND deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=p_staff AND deleted_at IS NULL AND (status IN('expired','revoked') OR expiration_date<p_date));
END $$;
REVOKE ALL ON FUNCTION haven.schedule_credentials_current(uuid,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_credentials_current(uuid,uuid,date) TO authenticated;
-- Complete managed groups can be edited; unrelated legacy rows remain explicit.
CREATE FUNCTION haven.schedule_cell_intact(p_schedule uuid,p_staff uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM(SELECT schedule_starts_at,lag(schedule_ends_at) OVER(ORDER BY schedule_block_index) preceding_end FROM public.shift_assignments WHERE schedule_id=p_schedule AND staff_id=p_staff AND shift_date=p_date AND deleted_at IS NULL AND covers_assignment_id IS NULL AND schedule_group_id IS NOT NULL) ordered WHERE preceding_end>schedule_starts_at) AND (count(*)<=1 AND (count(schedule_group_id)=0 OR (min(schedule_block_index)=0 AND min(schedule_block_count)=1)) OR
 (count(*)>1 AND count(schedule_group_id)=count(*) AND count(DISTINCT schedule_group_id)=1 AND (count(schedule_preset_id)=0 OR (count(schedule_preset_id)=count(*) AND count(DISTINCT schedule_preset_id)=1)) AND (count(schedule_preset_version)=0 OR (count(schedule_preset_version)=count(*) AND count(DISTINCT schedule_preset_version)=1)) AND count(DISTINCT schedule_preset_name)=1 AND count(DISTINCT schedule_preset_color)=1 AND count(DISTINCT schedule_time_zone)=1 AND count(DISTINCT schedule_role_snapshot)=1 AND (count(schedule_rounding_coverage)=0 OR (count(schedule_rounding_coverage)=count(*) AND count(DISTINCT schedule_rounding_coverage)=1)) AND count(DISTINCT schedule_block_count)=1 AND min(schedule_block_count)=count(*) AND count(DISTINCT schedule_block_index)=count(*) AND min(schedule_block_index)=0 AND max(schedule_block_index)=count(*)-1))
 FROM public.shift_assignments WHERE schedule_id=p_schedule AND staff_id=p_staff AND shift_date=p_date AND deleted_at IS NULL AND covers_assignment_id IS NULL;
$$;
REVOKE ALL ON FUNCTION haven.schedule_cell_intact(uuid,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_cell_intact(uuid,uuid,date) TO authenticated;
CREATE OR REPLACE FUNCTION public.schedule_bulk_upsert(p_schedule_id uuid,p_expected_updated_at timestamptz,p_cells jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules; c record; p public.facility_schedule_presets; d public.facility_shift_definitions; s public.staff; b jsonb; blocks jsonb; plan jsonb:='[]'; entry jsonb; originals jsonb; group_key uuid; index_no integer; existing_id uuid; prior jsonb; classification public.shift_type; tz text; effective_role public.staff_role; block_last_date date;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
 SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
 IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before saving.'; END IF;
 IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Provide 1 to 1000 cell changes'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) GROUP BY staff_id,shift_date HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate employee/date cells'; END IF;
 SELECT timezone INTO tz FROM public.facilities WHERE id=w.facility_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(x.staff_id::text,0)) FROM(SELECT DISTINCT staff_id FROM jsonb_to_recordset(p_cells) AS j(staff_id uuid)) x ORDER BY x.staff_id;
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO originals FROM public.shift_assignments a JOIN jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) ON x.staff_id=a.staff_id AND x.shift_date=a.shift_date WHERE a.schedule_id=w.id AND a.deleted_at IS NULL;
 FOR c IN SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid,custom_start_time text,custom_end_time text,preset_id uuid,expected_preset_version integer,custom_blocks jsonb,custom_rounding_coverage boolean) ORDER BY staff_id,shift_date LOOP
  IF c.shift_date IS NULL OR c.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6 THEN RAISE EXCEPTION 'Shift date must be inside this schedule week'; END IF;
  effective_role:=haven.schedule_staff_role(c.staff_id,w.facility_id,c.shift_date,c.shift_date);
  IF effective_role IS NULL THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
  IF NOT haven.schedule_cell_intact(w.id,c.staff_id,c.shift_date) THEN RAISE EXCEPTION 'Multiple assignments in this cell. Review assignment details first.'; END IF;
  IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND staff_id=c.staff_id AND shift_date=c.shift_date AND deleted_at IS NULL AND (status NOT IN('assigned','confirmed') OR covers_assignment_id IS NOT NULL)) THEN RAISE EXCEPTION 'Resolve the assignment status before replacing this cell'; END IF;
  p:=NULL;d:=NULL;blocks:='[]';classification:='custom';group_key:=NULL;
  IF c.preset_id IS NOT NULL THEN
   IF c.shift_definition_id IS NOT NULL OR c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL OR c.custom_blocks IS NOT NULL THEN RAISE EXCEPTION 'Choose one shift option or custom times'; END IF;
   SELECT * INTO p FROM public.facility_schedule_presets WHERE id=c.preset_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND OR p.version IS DISTINCT FROM c.expected_preset_version THEN RAISE EXCEPTION 'Shift option changed or unavailable. Reload before saving.'; END IF;
   IF NOT effective_role=ANY(p.allowed_staff_roles) THEN RAISE EXCEPTION 'Shift option is not available for this employee role'; END IF;
   blocks:=p.blocks;classification:=p.roster_shift_type;group_key:=gen_random_uuid();
  ELSIF c.custom_blocks IS NOT NULL THEN
   IF c.shift_definition_id IS NOT NULL OR c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL OR NOT haven.schedule_blocks_valid(c.custom_blocks) THEN RAISE EXCEPTION 'Custom blocks require ordered nonoverlapping start and finish times'; END IF;
   blocks:=c.custom_blocks;group_key:=gen_random_uuid();
  ELSIF c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL THEN
   IF c.shift_definition_id IS NOT NULL THEN RAISE EXCEPTION 'Choose a facility shift or custom times, not both'; END IF;
   IF c.custom_start_time IS NULL OR c.custom_end_time IS NULL OR c.custom_start_time!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' OR c.custom_end_time!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' THEN RAISE EXCEPTION 'Custom shifts require valid start and finish times'; END IF;
   IF c.custom_start_time::time=c.custom_end_time::time THEN RAISE EXCEPTION 'Custom start and finish times must differ'; END IF;
   blocks:=jsonb_build_array(jsonb_build_object('start',c.custom_start_time,'end',c.custom_end_time));
  ELSIF c.shift_definition_id IS NOT NULL THEN
   SELECT * INTO d FROM public.facility_shift_definitions WHERE id=c.shift_definition_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL;
   IF NOT FOUND OR d.starts_at_local=d.ends_at_local THEN RAISE EXCEPTION 'Active facility shift definition with distinct times required'; END IF;
   blocks:=jsonb_build_array(jsonb_build_object('start',d.starts_at_local,'end',d.ends_at_local));classification:=d.roster_shift_type;
  END IF;
  index_no:=0;
  FOR b IN SELECT value FROM jsonb_array_elements(blocks) LOOP
   block_last_date:=c.shift_date+CASE WHEN (b->>'end')::time<(b->>'start')::time AND (b->>'end')::time>'00:00'::time THEN 1 ELSE 0 END;
   effective_role:=haven.schedule_staff_role(c.staff_id,w.facility_id,c.shift_date,block_last_date);
   IF effective_role IS NULL OR (p.id IS NOT NULL AND NOT effective_role=ANY(p.allowed_staff_roles)) THEN RAISE EXCEPTION 'Facility membership and role must cover the entire work block'; END IF;
   SELECT value INTO prior FROM jsonb_array_elements(originals) WHERE value->>'staff_id'=c.staff_id::text AND value->>'shift_date'=c.shift_date::text AND coalesce((value->>'schedule_block_index')::integer,0)=index_no;
   existing_id:=coalesce((prior->>'id')::uuid,gen_random_uuid());
   IF prior IS NULL THEN SELECT value INTO prior FROM jsonb_array_elements(originals) WHERE value->>'staff_id'=c.staff_id::text AND value->>'shift_date'=c.shift_date::text ORDER BY coalesce((value->>'schedule_block_index')::integer,0) LIMIT 1; END IF;
   plan:=plan||jsonb_build_array(jsonb_build_object('id',existing_id,'staff_id',c.staff_id,'shift_date',c.shift_date,'start',b->>'start','end',b->>'end','shift_type',classification,'definition',d.id,'preset',p.id,'name',CASE WHEN p.id IS NOT NULL THEN p.label WHEN group_key IS NOT NULL THEN 'Custom' END,'color',CASE WHEN p.id IS NOT NULL THEN p.color WHEN group_key IS NOT NULL THEN '#64748B' END,'version',p.version,'rounding',CASE WHEN p.id IS NOT NULL THEN p.rounding_coverage WHEN d.id IS NOT NULL THEN true ELSE coalesce(c.custom_rounding_coverage,false) END,'role',effective_role,'timezone',tz,'group',group_key,'index',CASE WHEN group_key IS NOT NULL THEN index_no END,'count',CASE WHEN group_key IS NOT NULL THEN jsonb_array_length(blocks) END,'prior',prior));
   index_no:=index_no+1;
  END LOOP;
 END LOOP;
 -- Temporarily retire all touched blocks in this transaction. Their IDs and
 -- metadata are restored by block index; overlap checks see only final plans.
 UPDATE public.shift_assignments a SET deleted_at=clock_timestamp(),updated_by=auth.uid() FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) WHERE a.schedule_id=w.id AND a.staff_id=x.staff_id AND a.shift_date=x.shift_date AND a.deleted_at IS NULL;
 FOR entry IN SELECT value FROM jsonb_array_elements(plan) LOOP
  UPDATE public.shift_assignments SET deleted_at=NULL,shift_type=(entry->>'shift_type')::public.shift_type,custom_start_time=(entry->>'start')::time,custom_end_time=(entry->>'end')::time,shift_definition_id=(entry->>'definition')::uuid,
   schedule_preset_id=(entry->>'preset')::uuid,schedule_preset_name=entry->>'name',schedule_preset_color=entry->>'color',schedule_preset_version=(entry->>'version')::integer,schedule_rounding_coverage=(entry->>'rounding')::boolean,schedule_role_snapshot=(entry->>'role')::public.staff_role,schedule_time_zone=entry->>'timezone',schedule_group_id=(entry->>'group')::uuid,schedule_block_index=(entry->>'index')::integer,schedule_block_count=(entry->>'count')::integer,schedule_copied_from_assignment_id=NULL,updated_by=auth.uid()
   WHERE id=(entry->>'id')::uuid AND schedule_id=w.id;
  IF NOT FOUND THEN
   INSERT INTO public.shift_assignments(id,schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time,shift_definition_id,schedule_preset_id,schedule_preset_name,schedule_preset_color,schedule_preset_version,schedule_rounding_coverage,schedule_role_snapshot,schedule_time_zone,schedule_group_id,schedule_block_index,schedule_block_count,unit_id,assigned_resident_ids,shift_classification,notes,created_by,updated_by)
    VALUES((entry->>'id')::uuid,w.id,(entry->>'staff_id')::uuid,w.facility_id,w.organization_id,(entry->>'shift_date')::date,(entry->>'shift_type')::public.shift_type,(entry->>'start')::time,(entry->>'end')::time,(entry->>'definition')::uuid,(entry->>'preset')::uuid,entry->>'name',entry->>'color',(entry->>'version')::integer,(entry->>'rounding')::boolean,(entry->>'role')::public.staff_role,entry->>'timezone',(entry->>'group')::uuid,(entry->>'index')::integer,(entry->>'count')::integer,(entry->'prior'->>'unit_id')::uuid,CASE WHEN jsonb_typeof(entry->'prior'->'assigned_resident_ids')='array' THEN ARRAY(SELECT jsonb_array_elements_text(entry->'prior'->'assigned_resident_ids'))::uuid[] END,coalesce((entry->'prior'->>'shift_classification')::public.shift_classification,'regular'::public.shift_classification),entry->'prior'->>'notes',auth.uid(),auth.uid());
  END IF;
 END LOOP;
 UPDATE public.schedules SET updated_by=auth.uid() WHERE id=w.id;RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_bulk_upsert(uuid,timestamptz,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_bulk_upsert(uuid,timestamptz,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.schedule_copy_week(p_schedule_id uuid,p_expected_updated_at timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules; source_week public.schedules; count_before integer; count_after integer;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
 SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
 IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before copying.'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Copy last week requires an empty draft'; END IF;
 SELECT * INTO source_week FROM public.schedules WHERE facility_id=w.facility_id AND organization_id=w.organization_id AND week_start_date=w.week_start_date-7 AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No schedule exists for the previous week'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND a.covers_assignment_id IS NULL AND a.schedule_group_id IS NULL AND NOT(a.shift_type='custom' AND a.shift_definition_id IS NULL) AND NOT EXISTS(SELECT 1 FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time)) THEN RAISE EXCEPTION 'Previous week contains shifts without a matching active definition. Plan those shifts explicitly.'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND (NOT haven.schedule_cell_intact(source_week.id,a.staff_id,a.shift_date) OR a.custom_start_time IS NULL OR a.custom_end_time IS NULL OR a.custom_start_time=a.custom_end_time)) THEN RAISE EXCEPTION 'Previous week contains incomplete groups or unrecorded times. Review assignments first.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(x.staff_id::text,0)) FROM(SELECT DISTINCT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL) x ORDER BY x.staff_id;
 IF EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.staff s ON s.id=a.staff_id WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND haven.schedule_staff_role(a.staff_id,w.facility_id,a.shift_date+7,a.shift_date+7+CASE WHEN a.custom_end_time<a.custom_start_time AND a.custom_end_time>'00:00'::time THEN 1 ELSE 0 END) IS NULL) THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
 SELECT count(*) INTO count_before FROM public.shift_assignments WHERE schedule_id=source_week.id AND deleted_at IS NULL AND covers_assignment_id IS NULL;
 IF count_before=0 THEN RAISE EXCEPTION 'Previous week has no assignments to copy'; END IF;
 WITH groups AS MATERIALIZED(SELECT g.schedule_group_id,gen_random_uuid() id FROM(SELECT DISTINCT schedule_group_id FROM public.shift_assignments WHERE schedule_id=source_week.id AND deleted_at IS NULL AND schedule_group_id IS NOT NULL)g)
 INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time,shift_definition_id,unit_id,assigned_resident_ids,shift_classification,notes,schedule_preset_id,schedule_preset_name,schedule_preset_color,schedule_preset_version,schedule_rounding_coverage,schedule_role_snapshot,schedule_time_zone,schedule_group_id,schedule_block_index,schedule_block_count,schedule_copied_from_assignment_id,created_by,updated_by)
 SELECT w.id,a.staff_id,w.facility_id,w.organization_id,a.shift_date+7,a.shift_type,a.custom_start_time,a.custom_end_time,a.shift_definition_id,a.unit_id,a.assigned_resident_ids,a.shift_classification,a.notes,a.schedule_preset_id,a.schedule_preset_name,a.schedule_preset_color,a.schedule_preset_version,a.schedule_rounding_coverage,a.schedule_role_snapshot,a.schedule_time_zone,g.id,a.schedule_block_index,a.schedule_block_count,a.id,auth.uid(),auth.uid()
 FROM public.shift_assignments a LEFT JOIN groups g ON g.schedule_group_id=a.schedule_group_id WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND a.covers_assignment_id IS NULL;
 GET DIAGNOSTICS count_after=ROW_COUNT;
 IF count_before<>count_after THEN RAISE EXCEPTION 'Previous week planning details were not copied in full'; END IF;
 UPDATE public.schedules SET updated_by=auth.uid() WHERE id=w.id;RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_copy_week(uuid,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_copy_week(uuid,timestamptz) TO authenticated;
-- Clinical checks keep cadence timing, but each task resolves at its own due
-- instant. Preset labels/colors never confer clinical authority.
CREATE FUNCTION haven.resolve_observation_instant(p_facility uuid,p_at timestamptz,p_residents uuid[],p_now timestamptz)
RETURNS TABLE(resident_id uuid,shift_assignment_id uuid,staff_id uuid,assignment_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH scheduled AS MATERIALIZED(
  SELECT i.assignment_id id,i.staff_id,a.assigned_resident_ids FROM public.schedule_assignment_intervals(p_facility,p_at,p_at+interval '1 microsecond',NULL) i
  JOIN public.shift_assignments a ON a.id=i.assignment_id JOIN public.staff s ON s.id=i.staff_id
  JOIN public.user_profiles p ON p.id=s.user_id AND p.organization_id=s.organization_id AND p.is_active AND p.deleted_at IS NULL
  JOIN auth.users u ON u.id=p.id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=p_now)
  WHERE (a.schedule_rounding_coverage=true OR (a.schedule_rounding_coverage IS NULL AND EXISTS(SELECT 1 FROM public.facility_shift_window_at(p_facility,p_at) legacy WHERE legacy.roster_shift_type=a.shift_type AND legacy.shift_service_date=a.shift_date))) AND i.staff_role=haven.schedule_staff_role(i.staff_id,p_facility,i.service_date,((i.ends_at-interval '1 microsecond') AT TIME ZONE i.time_zone)::date) AND p.app_role::text=ANY(coalesce((SELECT t.rounding_owner_roles FROM public.timeclock_facility_settings t WHERE t.facility_id=p_facility AND t.organization_id=s.organization_id),ARRAY['med_tech']))
  AND (p.app_role IN('owner','org_admin') OR EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=p.id AND g.facility_id=p_facility AND g.organization_id=p.organization_id AND g.revoked_at IS NULL))
 ), splits AS(SELECT DISTINCT ON(r.id) r.id resident_id,s.id,s.staff_id FROM unnest(p_residents) r(id) JOIN scheduled s ON r.id=ANY(s.assigned_resident_ids) ORDER BY r.id,s.id),
 ring AS(SELECT id,staff_id,row_number() OVER(ORDER BY staff_id,id)-1 position,count(*) OVER() size FROM scheduled),
 phase AS(SELECT w.starts_at_utc,w.ends_at_utc,EXISTS(SELECT 1 FROM public.timeclock_facility_settings WHERE facility_id=p_facility AND timeclock_enabled) uses_clock FROM (SELECT 1) seed LEFT JOIN LATERAL public.facility_shift_window_at(p_facility,p_now) w ON true),
 clock_staff AS(SELECT c.staff_id FROM phase ph CROSS JOIN LATERAL haven.observation_shift_owner_staff(p_facility,p_now,ph.starts_at_utc) c WHERE NOT EXISTS(SELECT 1 FROM scheduled) AND p_at>=ph.starts_at_utc AND p_at<ph.ends_at_utc
  AND NOT EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(p_facility,p_at,p_at+interval '1 microsecond',c.staff_id) i JOIN public.shift_assignments a ON a.id=i.assignment_id WHERE a.schedule_rounding_coverage=false OR i.staff_role IS DISTINCT FROM haven.schedule_staff_role(i.staff_id,p_facility,i.service_date,((i.ends_at-interval '1 microsecond') AT TIME ZONE i.time_zone)::date))
  AND NOT EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(p_facility,ph.starts_at_utc,ph.ends_at_utc,c.staff_id) known WHERE NOT EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(p_facility,p_at,p_at+interval '1 microsecond',c.staff_id)))),
 clock_ring AS(SELECT staff_id,row_number() OVER(ORDER BY staff_id)-1 position,count(*) OVER() size FROM clock_staff)
 SELECT r.id,coalesce(sp.id,ro.id),coalesce(sp.staff_id,ro.staff_id,cl.staff_id),CASE WHEN sp.staff_id IS NOT NULL THEN 'resident_split' WHEN ro.staff_id IS NOT NULL THEN 'shift_roster' WHEN cl.staff_id IS NOT NULL THEN 'on_clock' WHEN ph.uses_clock AND (p_at>=ph.ends_at_utc OR p_now<ph.starts_at_utc+haven.observation_clock_in_lead(p_facility)) THEN 'awaiting_clock_in' ELSE 'none_scheduled' END
 FROM unnest(p_residents) r(id) CROSS JOIN phase ph LEFT JOIN splits sp ON sp.resident_id=r.id
 LEFT JOIN LATERAL(SELECT * FROM ring WHERE position=((hashtextextended(r.id::text,0)%size)+size)%size LIMIT 1) ro ON sp.id IS NULL
 LEFT JOIN LATERAL(SELECT * FROM clock_ring WHERE position=((hashtextextended(r.id::text,0)%size)+size)%size LIMIT 1) cl ON sp.id IS NULL AND ro.id IS NULL ORDER BY r.id;
$$;
REVOKE ALL ON FUNCTION haven.resolve_observation_instant(uuid,timestamptz,uuid[],timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.resolve_observation_task_assignees_for_instant(p_facility_id uuid,p_at timestamptz,p_resident_ids uuid[])
RETURNS TABLE(resident_id uuid,shift_assignment_id uuid,staff_id uuid,assignment_source text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT * FROM haven.resolve_observation_instant(p_facility_id,p_at,p_resident_ids,now()) $$;
REVOKE ALL ON FUNCTION public.resolve_observation_task_assignees_for_instant(uuid,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_observation_task_assignees_for_instant(uuid,timestamptz,uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION haven.resolve_observation_task_assignees_at(p_facility_id uuid,p_shift_service_date date,p_roster_shift_type text,p_resident_ids uuid[],p_at timestamptz)
RETURNS TABLE(resident_id uuid,shift_assignment_id uuid,staff_id uuid,assignment_source text) LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT r.* FROM(SELECT coalesce((SELECT p_at FROM public.facility_shift_window_at(p_facility_id,p_at) w WHERE w.shift_service_date=p_shift_service_date AND w.roster_shift_type::text=p_roster_shift_type),
 (SELECT (p_shift_service_date+d.starts_at_local) AT TIME ZONE f.timezone FROM public.facility_shift_definitions d JOIN public.facilities f ON f.id=d.facility_id WHERE d.facility_id=p_facility_id AND d.roster_shift_type::text=p_roster_shift_type AND d.active AND d.deleted_at IS NULL ORDER BY d.sort_order,d.id LIMIT 1),p_at) at) target
 CROSS JOIN LATERAL haven.resolve_observation_instant(p_facility_id,target.at,p_resident_ids,p_at) r;
$$;
CREATE OR REPLACE FUNCTION public.assign_unowned_observation_tasks(p_facility_id uuid,p_at timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task record; owner_row record; changed integer:=0;
BEGIN
 FOR task IN SELECT t.id,t.resident_id,t.due_at FROM public.resident_observation_tasks t WHERE t.facility_id=p_facility_id AND t.deleted_at IS NULL AND t.assigned_staff_id IS NULL AND t.status IN('upcoming','due_soon','due_now') AND t.due_at>p_at AND NOT EXISTS(SELECT 1 FROM public.resident_observation_assignments a WHERE a.task_id=t.id AND a.released_at IS NULL) ORDER BY t.id FOR UPDATE OF t LOOP
  SELECT * INTO owner_row FROM haven.resolve_observation_instant(p_facility_id,task.due_at,ARRAY[task.resident_id],p_at);
  IF owner_row.staff_id IS NOT NULL THEN
   UPDATE public.resident_observation_tasks SET assigned_staff_id=owner_row.staff_id,shift_assignment_id=owner_row.shift_assignment_id WHERE id=task.id AND assigned_staff_id IS NULL;
   IF FOUND THEN
    INSERT INTO public.resident_observation_assignments(organization_id,entity_id,facility_id,resident_id,task_id,shift_assignment_id,staff_id,assignment_type) SELECT organization_id,entity_id,facility_id,resident_id,id,shift_assignment_id,assigned_staff_id,'primary' FROM public.resident_observation_tasks WHERE id=task.id ON CONFLICT(task_id,staff_id) WHERE released_at IS NULL DO NOTHING;
    changed:=changed+1;
   END IF;
  END IF;
 END LOOP;
 RETURN changed;
END $$;
-- Existing service-only ACL is retained by CREATE OR REPLACE.
-- Preserve each existing writer's authority and clinical side effects; replace
-- only its enum-based work lookup with recorded published intervals.
DO $patch$
DECLARE src text; needle text; replacement text;
BEGIN
 SELECT pg_get_functiondef('haven.touch_assignment_schedule()'::regprocedure) INTO src;
 IF position('    IF EXISTS (' IN src)=0 OR position('    ) THEN RAISE EXCEPTION ''An employee has overlapping shifts.' IN src)=0 THEN RAISE EXCEPTION 'Assignment overlap anchor changed'; END IF;
 needle:=substring(src FROM position('    IF EXISTS (' IN src) FOR position('    ) THEN RAISE EXCEPTION ''An employee has overlapping shifts.' IN src)-position('    IF EXISTS (' IN src)+5);
 EXECUTE replace(src,needle,'    IF haven.schedule_employee_overlap(NEW.id)');
 SELECT pg_get_functiondef('haven.guard_schedule_assignment()'::regprocedure) INTO src;
 needle:='NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id=NEW.staff_id AND s.facility_id=w.facility_id AND s.organization_id=w.organization_id AND s.deleted_at IS NULL)';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Assignment membership anchor changed'; END IF;
 src:=replace(src,needle,'(TG_OP=''INSERT'' OR (NEW.staff_id,NEW.shift_date,NEW.custom_start_time,NEW.custom_end_time) IS DISTINCT FROM (OLD.staff_id,OLD.shift_date,OLD.custom_start_time,OLD.custom_end_time)) AND haven.schedule_staff_role(NEW.staff_id,w.facility_id,NEW.shift_date,NEW.shift_date+CASE WHEN NEW.custom_end_time<NEW.custom_start_time AND NEW.custom_end_time>''00:00''::time THEN 1 ELSE 0 END) IS NULL');
 src:=replace(src,'NOT EXISTS (SELECT 1 FROM public.staff WHERE id=NEW.staff_id AND employment_status=''active'' AND deleted_at IS NULL)','haven.schedule_staff_role(NEW.staff_id,w.facility_id,NEW.shift_date,NEW.shift_date) IS NULL');
 src:=replace(src,'PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id=NEW.staff_id OR (TG_OP=''UPDATE'' AND s.id=OLD.staff_id) ORDER BY s.id','PERFORM pg_advisory_xact_lock(hashtextextended(x.id::text,0)) FROM(SELECT NEW.staff_id id UNION SELECT OLD.staff_id WHERE TG_OP=''UPDATE'') x WHERE x.id IS NOT NULL ORDER BY x.id');EXECUTE src;
 SELECT pg_get_functiondef('haven.guard_schedule_row()'::regprocedure) INTO src;
 needle:='OR s.id IS NULL OR s.deleted_at IS NOT NULL OR s.employment_status<>''active'' OR s.facility_id<>w.facility_id OR s.organization_id<>w.organization_id';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Publication membership anchor changed'; END IF;
 src:=replace(src,needle,'OR haven.schedule_staff_role(a.staff_id,w.facility_id,a.shift_date,a.shift_date+CASE WHEN a.custom_end_time<a.custom_start_time AND a.custom_end_time>''00:00''::time THEN 1 ELSE 0 END) IS NULL OR a.covers_assignment_id IS NOT NULL OR NOT haven.schedule_cell_intact(w.id,a.staff_id,a.shift_date) OR haven.schedule_employee_overlap(a.id)');
 src:=replace(src,'PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (SELECT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.deleted_at IS NULL) ORDER BY s.id','PERFORM pg_advisory_xact_lock(hashtextextended(x.staff_id::text,0)) FROM(SELECT DISTINCT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.deleted_at IS NULL) x ORDER BY x.staff_id');EXECUTE src;
 SELECT pg_get_functiondef('public.schedule_publish(uuid,timestamptz)'::regprocedure) INTO src;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Publish RPC membership anchor changed'; END IF;
 src:=replace(src,needle,'OR haven.schedule_staff_role(a.staff_id,w.facility_id,a.shift_date,a.shift_date+CASE WHEN a.custom_end_time<a.custom_start_time AND a.custom_end_time>''00:00''::time THEN 1 ELSE 0 END) IS NULL OR a.covers_assignment_id IS NOT NULL OR NOT haven.schedule_cell_intact(w.id,a.staff_id,a.shift_date) OR haven.schedule_employee_overlap(a.id)');
 src:=replace(src,'PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (SELECT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.deleted_at IS NULL) ORDER BY s.id','PERFORM pg_advisory_xact_lock(hashtextextended(x.staff_id::text,0)) FROM(SELECT DISTINCT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.deleted_at IS NULL) x ORDER BY x.staff_id');EXECUTE src;
 SELECT pg_get_functiondef('public.edit_draft_schedule(uuid,text,uuid,uuid,date,time,time)'::regprocedure) INTO src;
 src:=replace(src,'NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_staff_id AND facility_id=v_schedule.facility_id AND organization_id=v_schedule.organization_id AND deleted_at IS NULL AND employment_status=''active'')','haven.schedule_staff_role(p_staff_id,v_schedule.facility_id,p_date,p_date+CASE WHEN p_end<p_start AND p_end>''00:00''::time THEN 1 ELSE 0 END) IS NULL');EXECUTE src;
 SELECT pg_get_functiondef('public.haven_apply_approved_shift_swap()'::regprocedure) INTO src;
 needle:='    SELECT staff_role::text INTO v_role FROM public.staff WHERE id=NEW.requesting_staff_id AND deleted_at IS NULL AND employment_status=''active'';';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Swap role lookup anchor changed'; END IF;
 src:=replace(src,needle,'    v_role:=haven.schedule_staff_role(NEW.requesting_staff_id,NEW.facility_id,v_request.shift_date,v_request.shift_date+CASE WHEN v_request.custom_end_time<v_request.custom_start_time AND v_request.custom_end_time>''00:00''::time THEN 1 ELSE 0 END)::text;');
 src:=replace(src,'    SELECT staff_role::text INTO v_cover_role FROM public.staff WHERE id=NEW.covering_staff_id AND deleted_at IS NULL AND employment_status=''active'' AND facility_id=NEW.facility_id;','    v_cover_role:=haven.schedule_staff_role(NEW.covering_staff_id,NEW.facility_id,v_request.shift_date,v_request.shift_date+CASE WHEN v_request.custom_end_time<v_request.custom_start_time AND v_request.custom_end_time>''00:00''::time THEN 1 ELSE 0 END)::text;');
 src:=replace(src,'NOT EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL AND (status::text IN (''expired'',''revoked'') OR expiration_date<v_request.shift_date))','NOT haven.schedule_credentials_current(NEW.covering_staff_id,NEW.facility_id,v_request.shift_date)');
 src:=replace(src,'PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (NEW.requesting_staff_id,NEW.covering_staff_id) ORDER BY s.id','PERFORM pg_advisory_xact_lock(hashtextextended(x.id::text,0)) FROM(SELECT NEW.requesting_staff_id id UNION SELECT NEW.covering_staff_id) x ORDER BY x.id');
 EXECUTE src;
 -- The service command has already proved p_actor_id/session/role/grant; its
 -- membership check must not consult an unrelated ambient auth.uid identity.
 SELECT pg_get_functiondef('haven.assert_rounding_service_actor(uuid,text,uuid,integer,uuid,uuid,boolean,boolean)'::regprocedure) INTO src;
 needle:='AND staff.facility_id=p_facility_id AND staff.employment_status=''active'' AND staff.deleted_at IS NULL';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Clinical actor membership anchor changed'; END IF;
 src:=replace(src,needle,'AND haven.schedule_staff_role_internal(staff.id,p_facility_id,(now() AT TIME ZONE haven.timeclock_facility_timezone(p_facility_id))::date,(now() AT TIME ZONE haven.timeclock_facility_timezone(p_facility_id))::date) IS NOT NULL AND staff.employment_status=''active'' AND staff.deleted_at IS NULL');
 src:=replace(src,'  SELECT staff.id INTO v_staff_id FROM public.staff AS staff', $text$  PERFORM membership.id FROM public.staff_facility_assignments membership JOIN public.staff employee ON employee.id=membership.staff_id WHERE employee.user_id=p_actor_id AND membership.organization_id=p_organization_id AND membership.facility_id=p_facility_id AND membership.deleted_at IS NULL ORDER BY membership.id FOR SHARE OF membership;
  SELECT staff.id INTO v_staff_id FROM public.staff AS staff$text$);EXECUTE src;
 SELECT pg_get_functiondef('public.floor_replay_complete_rounding_task(text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure) INTO src;
 needle:='AND s.facility_id = (v_proof->>''facility_id'')::uuid AND s.employment_status = ''active'' AND s.deleted_at IS NULL';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Floor replay membership anchor changed'; END IF;
 EXECUTE replace(src,needle,'AND s.id=(v_proof->>''staff_id'')::uuid AND haven.schedule_staff_role(s.id,(v_proof->>''facility_id'')::uuid,(now() AT TIME ZONE haven.timeclock_facility_timezone((v_proof->>''facility_id'')::uuid))::date,(now() AT TIME ZONE haven.timeclock_facility_timezone((v_proof->>''facility_id'')::uuid))::date) IS NOT NULL AND s.employment_status = ''active'' AND s.deleted_at IS NULL');
 SELECT pg_get_functiondef('haven.observation_on_clock_staff(uuid,timestamptz)'::regprocedure) INTO src;
 needle:='s.facility_id = p_facility_id';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'On-clock membership anchor changed'; END IF;
 EXECUTE replace(src,needle,'haven.schedule_staff_role(s.id,p_facility_id,(p_at AT TIME ZONE haven.timeclock_facility_timezone(p_facility_id))::date,(p_at AT TIME ZONE haven.timeclock_facility_timezone(p_facility_id))::date) IS NOT NULL');
 SELECT pg_get_functiondef('haven.med_tech_shift_open_from_clock(uuid,uuid,timestamptz,uuid,text,uuid,uuid)'::regprocedure) INTO src;
 needle:='  IF v_tz IS NULL THEN RETURN NULL; END IF;';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Med-Tech facility authority anchor changed'; END IF;
 src:=replace(src,needle,needle||$text$
  IF haven.schedule_staff_role(p_staff_id,p_facility_id,(p_at AT TIME ZONE v_tz)::date,(p_at AT TIME ZONE v_tz)::date) IS NULL THEN RETURN NULL; END IF;
$text$);
 IF position('  -- Which of the facility''s shifts this clock-in belongs to.' IN src)=0 OR position('  INSERT INTO public.med_tech_shifts (' IN src)=0 THEN RAISE EXCEPTION 'Med-Tech work lookup anchor changed'; END IF;
 needle:=substring(src FROM position('  -- Which of the facility''s shifts this clock-in belongs to.' IN src) FOR position('  INSERT INTO public.med_tech_shifts (' IN src)-position('  -- Which of the facility''s shifts this clock-in belongs to.' IN src));
 replacement:=$text$  -- Recorded published work wins. Drafts and legacy enum labels cannot
  -- choose a person's work interval or resident/unit plan.
  SELECT a.* INTO v_assignment FROM public.schedule_assignment_intervals(p_facility_id,p_at,p_at+interval '1 microsecond',p_staff_id) i JOIN public.shift_assignments a ON a.id=i.assignment_id
  ORDER BY (a.id=p_shift_assignment_id) DESC NULLS LAST,i.starts_at DESC,a.id LIMIT 1;
  IF v_assignment.id IS NOT NULL THEN
   SELECT i.starts_at,i.ends_at INTO v_start,v_end FROM public.schedule_assignment_intervals(p_facility_id,p_at,p_at+interval '1 microsecond',p_staff_id) i WHERE i.assignment_id=v_assignment.id;
  ELSE
   -- An actually clocked-in but unscheduled authorized med-tech retains the
   -- existing clinical-window fallback, without inventing a work assignment.
   SELECT w.starts_at,w.ends_at INTO v_start,v_end FROM(
    SELECT d.sort_order,((day.d+d.starts_at_local) AT TIME ZONE v_tz) starts_at,((day.d+CASE WHEN d.ends_at_local<=d.starts_at_local THEN 1 ELSE 0 END+d.ends_at_local) AT TIME ZONE v_tz) ends_at
    FROM public.facility_shift_definitions d CROSS JOIN LATERAL(SELECT (p_at AT TIME ZONE v_tz)::date+o d FROM generate_series(-1,1) o) day WHERE d.facility_id=p_facility_id AND d.active AND d.deleted_at IS NULL
   ) w ORDER BY abs(extract(epoch FROM p_at-w.starts_at)),w.sort_order LIMIT 1;
  END IF;
  v_start:=coalesce(v_start,p_at);

$text$;
 EXECUTE replace(src,needle,replacement);
 SELECT pg_get_functiondef('public.care_event_sync_witness_tasks(uuid)'::regprocedure) INTO src;
 needle:=$text$      -- The shift's own service date: at 1 AM the night shift's roster is dated the
      -- evening it began, not the calendar day (COL-685).
      AND sa.shift_date = COALESCE(
        (SELECT w.shift_service_date FROM public.facility_shift_window_at(v_event.facility_id, v_event.occurred_at) w),
        (v_event.occurred_at AT TIME ZONE v_tz)::date)
      AND sa.shift_type = v_event.shift$text$;
 replacement:=$text$      AND EXISTS(SELECT 1 FROM public.schedules sw WHERE sw.id=sa.schedule_id AND sw.status='published' AND sw.deleted_at IS NULL)
      AND v_event.occurred_at>=coalesce(sa.schedule_starts_at,(sa.shift_date+sa.custom_start_time) AT TIME ZONE coalesce(sa.schedule_time_zone,v_tz))
      AND v_event.occurred_at<coalesce(sa.schedule_ends_at,(sa.shift_date+CASE WHEN sa.custom_end_time<sa.custom_start_time THEN 1 ELSE 0 END+sa.custom_end_time) AT TIME ZONE coalesce(sa.schedule_time_zone,v_tz))$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Witness assignment integration anchor changed'; END IF;EXECUTE replace(src,needle,replacement);
 SELECT pg_get_functiondef('public.home_cover_shift(uuid,uuid,uuid)'::regprocedure) INTO src;
 needle:=$text$  IF EXISTS (SELECT 1 FROM public.shift_assignments x WHERE x.staff_id = p_staff_id AND x.shift_date = v_gap.shift_date
             AND x.shift_type = v_gap.shift_type AND x.deleted_at IS NULL AND x.status NOT IN ('called_out', 'no_show')) THEN$text$;
 replacement:=$text$  IF EXISTS (SELECT 1 FROM public.shift_assignments x JOIN public.schedules sw ON sw.id=x.schedule_id AND sw.deleted_at IS NULL AND sw.status<>'archived' WHERE x.staff_id=p_staff_id AND x.deleted_at IS NULL AND x.status NOT IN('called_out','no_show')
   AND tsrange(x.shift_date+x.custom_start_time,x.shift_date+CASE WHEN x.custom_end_time<x.custom_start_time THEN 1 ELSE 0 END+x.custom_end_time,'[)') && tsrange(v_gap.shift_date+v_gap.custom_start_time,v_gap.shift_date+CASE WHEN v_gap.custom_end_time<v_gap.custom_start_time THEN 1 ELSE 0 END+v_gap.custom_end_time,'[)')) THEN$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Callout overlap integration anchor changed'; END IF;src:=replace(src,needle,replacement);
 src:=replace(src,'created_by, updated_by)'||chr(10)||'  VALUES (p_id,','schedule_preset_id,schedule_preset_name,schedule_preset_color,schedule_preset_version,schedule_rounding_coverage,schedule_role_snapshot,schedule_time_zone,schedule_group_id,schedule_block_index,schedule_block_count,created_by, updated_by)'||chr(10)||'  VALUES (p_id,');
 src:=replace(src,'NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_staff_id AND s.facility_id = v_gap.facility_id'||chr(10)||'                 AND s.deleted_at IS NULL AND s.employment_status::text = ''active'')','haven.schedule_staff_role(p_staff_id,v_gap.facility_id,v_gap.shift_date,v_gap.shift_date+CASE WHEN v_gap.custom_end_time<v_gap.custom_start_time AND v_gap.custom_end_time>''00:00''::time THEN 1 ELSE 0 END) IS NULL');
 src:=replace(src,'custom_start_time, custom_end_time, unit_id, status, notes, covers_assignment_id,','custom_start_time, custom_end_time, unit_id,assigned_resident_ids,shift_classification,status,notes,covers_assignment_id,');
 src:=replace(src,'v_gap.custom_start_time, v_gap.custom_end_time, v_gap.unit_id, ''assigned'', ''Covering a call-out (Home)'',','v_gap.custom_start_time,v_gap.custom_end_time,v_gap.unit_id,v_gap.assigned_resident_ids,v_gap.shift_classification,''assigned'',concat_ws(E''\n'',v_gap.notes,''Covering a call-out (Home)''),');
 src:=replace(src,'v_gap.id, a.actor_user_id, a.actor_user_id)','v_gap.id,v_gap.schedule_preset_id,v_gap.schedule_preset_name,v_gap.schedule_preset_color,v_gap.schedule_preset_version,v_gap.schedule_rounding_coverage,NULL::public.staff_role,v_gap.schedule_time_zone,CASE WHEN v_gap.schedule_group_id IS NOT NULL THEN gen_random_uuid() END,CASE WHEN v_gap.schedule_group_id IS NOT NULL THEN 0 END,CASE WHEN v_gap.schedule_group_id IS NOT NULL THEN 1 END,a.actor_user_id,a.actor_user_id)');EXECUTE src;
 SELECT pg_get_functiondef('public.home_on_tap(uuid,timestamptz)'::regprocedure) INTO src;
 needle:='sa.facility_id = p_facility_id AND sa.shift_date = v_local_date AND sa.deleted_at IS NULL';
 replacement:='sa.facility_id = p_facility_id AND sa.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(p_facility_id,p_as_of,p_as_of+interval ''1 microsecond'',sa.staff_id) i WHERE i.assignment_id=sa.id)';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Home operator work integration anchor changed'; END IF;EXECUTE replace(src,needle,replacement);
 SELECT pg_get_functiondef('public.home_shifts_today(uuid,timestamptz)'::regprocedure) INTO src;
 needle:=$text$'customStart', sa.custom_start_time, 'customEnd', sa.custom_end_time,$text$;
 replacement:=needle||$text$
          'shiftDate',sa.shift_date,'presetName',sa.schedule_preset_name,'presetColor',sa.schedule_preset_color,'groupId',sa.schedule_group_id,'blockIndex',sa.schedule_block_index,'blockCount',sa.schedule_block_count,'startsAt',coalesce(sa.schedule_starts_at,(sa.shift_date+sa.custom_start_time) AT TIME ZONE coalesce(sa.schedule_time_zone,(SELECT timezone FROM public.facilities WHERE id=sa.facility_id))),'endsAt',coalesce(sa.schedule_ends_at,(sa.shift_date+CASE WHEN sa.custom_end_time<sa.custom_start_time THEN 1 ELSE 0 END+sa.custom_end_time) AT TIME ZONE coalesce(sa.schedule_time_zone,(SELECT timezone FROM public.facilities WHERE id=sa.facility_id))),'timeZone',coalesce(sa.schedule_time_zone,(SELECT timezone FROM public.facilities WHERE id=sa.facility_id)),$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Home coverage snapshot integration anchor changed'; END IF;src:=replace(src,needle,replacement);
 src:=replace(src,'s.facility_id = p_facility_id AND s.deleted_at IS NULL AND s.employment_status::text = ''active''','haven.schedule_staff_role(s.id,p_facility_id,v_local,v_local) IS NOT NULL AND s.deleted_at IS NULL AND s.employment_status::text = ''active''');
 src:=replace(src,'sa.shift_date = v_local AND sa.deleted_at IS NULL', 'sa.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.schedules sw WHERE sw.id=sa.schedule_id AND sw.status=''published'' AND sw.deleted_at IS NULL) AND (sa.shift_date=v_local OR (sa.shift_date=v_local-1 AND sa.custom_end_time<sa.custom_start_time))');EXECUTE src;
 SELECT pg_get_functiondef('public.timeclock_identify(text,text,text,text)'::regprocedure) INTO src;
 needle:=$text$    'first_name', v_r->>'first_name',$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Kiosk trusted identity integration anchor changed'; END IF;
 EXECUTE replace(src,needle,$text$    'staff_id',v_staff,'facility_id',(v_r->>'facility_id')::uuid,
$text$||needle);
END $patch$;

ALTER TABLE public.shift_handoff_notes ADD COLUMN schedule_assignment_id uuid REFERENCES public.shift_assignments(id),ADD COLUMN schedule_preset_name text,ADD COLUMN schedule_group_id uuid,ADD COLUMN schedule_starts_at timestamptz,ADD COLUMN schedule_ends_at timestamptz,ADD COLUMN schedule_time_zone text;
CREATE FUNCTION haven.stamp_handoff_work_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; staff_user uuid; counts integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.schedule_assignment_id,NEW.schedule_preset_name,NEW.schedule_group_id,NEW.schedule_starts_at,NEW.schedule_ends_at,NEW.schedule_time_zone) IS DISTINCT FROM (OLD.schedule_assignment_id,OLD.schedule_preset_name,OLD.schedule_group_id,OLD.schedule_starts_at,OLD.schedule_ends_at,OLD.schedule_time_zone) THEN RAISE EXCEPTION 'Handoff work context is immutable'; END IF;RETURN NEW;
 END IF;
 IF auth.uid() IS NULL OR NEW.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.has_facility_access(NEW.facility_id) THEN RAISE EXCEPTION 'Handoff facility access required' USING ERRCODE='42501'; END IF;
 IF NEW.created_by IS NOT NULL AND NEW.created_by<>auth.uid() THEN RAISE EXCEPTION 'Handoff author must be current actor' USING ERRCODE='42501'; END IF;
 NEW.created_by:=auth.uid();
 SELECT * INTO candidate FROM public.schedule_assignment_intervals(NEW.facility_id,now(),now(),NULL) LIMIT 1;
 SELECT count(*),min(s.id::text)::uuid INTO counts,staff_user FROM public.staff s WHERE s.user_id=auth.uid() AND haven.schedule_staff_role(s.id,NEW.facility_id,(now() AT TIME ZONE haven.timeclock_facility_timezone(NEW.facility_id))::date,(now() AT TIME ZONE haven.timeclock_facility_timezone(NEW.facility_id))::date) IS NOT NULL AND s.organization_id=NEW.organization_id AND s.employment_status='active' AND s.deleted_at IS NULL;
 IF counts=1 THEN
  SELECT count(*) INTO counts FROM public.schedule_assignment_intervals(NEW.facility_id,now(),now()+interval '1 microsecond',staff_user);
  IF counts=1 THEN SELECT * INTO candidate FROM public.schedule_assignment_intervals(NEW.facility_id,now(),now()+interval '1 microsecond',staff_user); END IF;
 END IF;
 IF NEW.schedule_assignment_id IS NOT NULL AND (counts<>1 OR NEW.schedule_assignment_id IS DISTINCT FROM candidate.assignment_id) THEN RAISE EXCEPTION 'Handoff assignment does not match current work'; END IF;
 NEW.schedule_assignment_id:=NULL;NEW.schedule_preset_name:=NULL;NEW.schedule_group_id:=NULL;NEW.schedule_starts_at:=NULL;NEW.schedule_ends_at:=NULL;NEW.schedule_time_zone:=NULL;
 IF counts=1 AND candidate.assignment_id IS NOT NULL THEN NEW.schedule_assignment_id:=candidate.assignment_id;NEW.schedule_preset_name:=candidate.label;NEW.schedule_group_id:=candidate.group_id;NEW.schedule_starts_at:=candidate.starts_at;NEW.schedule_ends_at:=candidate.ends_at;NEW.schedule_time_zone:=candidate.time_zone;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.stamp_handoff_work_context() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER handoff_work_context BEFORE INSERT OR UPDATE ON public.shift_handoff_notes FOR EACH ROW EXECUTE FUNCTION haven.stamp_handoff_work_context();
-- Group-aware consent is explicit. Legacy clients cannot accidentally move one
-- block out of a split group or confirm a group they have not reviewed.
ALTER TABLE public.shift_swap_requests
 ADD COLUMN swap_scope text NOT NULL DEFAULT 'assignment' CHECK(swap_scope IN('assignment','group')),
 ADD COLUMN requesting_group_snapshot jsonb,ADD COLUMN covering_group_snapshot jsonb,
 ADD COLUMN group_context_hash text,ADD COLUMN requesting_context_hash text,ADD COLUMN covering_context_hash text,ADD COLUMN reviewed_context_hash text;
CREATE FUNCTION haven.schedule_swap_blocks(p_anchor uuid,p_staff uuid,p_facility uuid,p_org uuid,p_scope text,p_future boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE anchor public.shift_assignments; row record; result jsonb:='[]'; expected integer; resolved_job_role public.staff_role; starts timestamptz; ends timestamptz; tz text; index_no integer:=0;
BEGIN
 IF p_anchor IS NULL THEN RETURN result; END IF;
 SELECT a.* INTO anchor FROM public.shift_assignments a JOIN public.schedules w ON w.id=a.schedule_id AND w.status='published' AND w.deleted_at IS NULL WHERE a.id=p_anchor AND a.staff_id=p_staff AND a.facility_id=p_facility AND a.organization_id=p_org AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed');
 IF anchor.id IS NULL THEN RAISE EXCEPTION 'Published work group changed or unavailable'; END IF;
 IF p_scope='assignment' AND coalesce(anchor.schedule_block_count,1)>1 THEN RAISE EXCEPTION 'Review and request the whole split group, not a single block'; END IF;
 expected:=CASE WHEN p_scope='group' THEN coalesce(anchor.schedule_block_count,1) ELSE 1 END;
 FOR row IN SELECT a.*,s.first_name,s.last_name FROM public.shift_assignments a JOIN public.staff s ON s.id=a.staff_id AND s.organization_id=p_org AND s.deleted_at IS NULL AND s.employment_status='active'
 WHERE a.schedule_id=anchor.schedule_id AND a.staff_id=p_staff AND a.facility_id=p_facility AND a.organization_id=p_org AND a.shift_date=anchor.shift_date AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed')
 AND (CASE WHEN p_scope='group' AND anchor.schedule_group_id IS NOT NULL THEN a.schedule_group_id=anchor.schedule_group_id ELSE a.id=anchor.id END)
 ORDER BY coalesce(a.schedule_block_index,0),a.id LOOP
  IF expected>1 AND (row.schedule_block_index IS DISTINCT FROM index_no OR row.schedule_block_count IS DISTINCT FROM expected OR row.schedule_group_id IS DISTINCT FROM anchor.schedule_group_id) THEN RAISE EXCEPTION 'Complete consistent work group required'; END IF;
  SELECT coalesce(row.schedule_time_zone,f.timezone) INTO tz FROM public.facilities f WHERE f.id=p_facility;
  starts:=coalesce(row.schedule_starts_at,(row.shift_date+row.custom_start_time) AT TIME ZONE tz);ends:=coalesce(row.schedule_ends_at,(row.shift_date+CASE WHEN row.custom_end_time<row.custom_start_time THEN 1 ELSE 0 END+row.custom_end_time) AT TIME ZONE tz);
  IF starts IS NULL OR ends IS NULL OR ends<=starts OR (p_future AND starts<=clock_timestamp()) THEN RAISE EXCEPTION 'A complete not-started work group is required'; END IF;
  resolved_job_role:=haven.schedule_staff_role_internal(p_staff,p_facility,row.shift_date,((ends-interval '1 microsecond') AT TIME ZONE tz)::date);
  IF resolved_job_role IS NULL OR (row.schedule_role_snapshot IS NOT NULL AND row.schedule_role_snapshot<>resolved_job_role) THEN RAISE EXCEPTION 'Work group facility membership or role changed'; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('assignment_id',row.id,'staff_id',p_staff,'staff_name',concat_ws(' ',row.first_name,row.last_name),'group_id',row.schedule_group_id,'block_index',index_no,'block_count',expected,'service_date',to_char(row.shift_date,'YYYY-MM-DD'),'starts_at',to_char(starts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'ends_at',to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'label',coalesce(row.schedule_preset_name,initcap(row.shift_type::text)),'color',coalesce(row.schedule_preset_color,'#64748B'),'time_zone',tz,'staff_role',resolved_job_role,'rounding_coverage',row.schedule_rounding_coverage));
  index_no:=index_no+1;
 END LOOP;
 IF index_no<>expected THEN RAISE EXCEPTION 'Complete consistent work group required'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.schedule_swap_blocks(uuid,uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION haven.schedule_cover_eligible(p_staff uuid,p_facility uuid,p_blocks jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE person record; b jsonb; role_at_day public.staff_role; last_day date;
BEGIN
 SELECT s.organization_id,s.user_id,p.app_role INTO person FROM public.staff s JOIN public.facilities f ON f.id=p_facility AND f.organization_id=s.organization_id AND f.deleted_at IS NULL JOIN public.user_profiles p ON p.id=s.user_id AND p.organization_id=s.organization_id AND p.is_active AND p.deleted_at IS NULL JOIN auth.users u ON u.id=p.id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) WHERE s.id=p_staff AND s.deleted_at IS NULL AND s.employment_status='active';
 IF person.user_id IS NULL THEN RETURN false; END IF;
 IF person.app_role NOT IN('owner','org_admin') AND NOT EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=person.user_id AND g.organization_id=person.organization_id AND g.facility_id=p_facility AND g.revoked_at IS NULL) THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  last_day:=(((b->>'ends_at')::timestamptz-interval '1 microsecond') AT TIME ZONE (b->>'time_zone'))::date;
  role_at_day:=haven.schedule_staff_role_internal(p_staff,p_facility,(b->>'service_date')::date,last_day);
  IF role_at_day IS NULL OR role_at_day::text IS DISTINCT FROM b->>'staff_role' THEN RETURN false; END IF;
  IF b->'rounding_coverage'='true'::jsonb AND NOT person.app_role::text=ANY(coalesce((SELECT rounding_owner_roles FROM public.timeclock_facility_settings WHERE facility_id=p_facility AND organization_id=person.organization_id),ARRAY['med_tech'])) THEN RETURN false; END IF;
 END LOOP;RETURN true;
END $$;
REVOKE ALL ON FUNCTION haven.schedule_cover_eligible(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.schedule_swap_candidates(p_assignment_id uuid)
RETURNS TABLE(staff_id uuid,staff_name text,staff_role text,blocks jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE anchor public.shift_assignments; week public.schedules; wanted jsonb; employee record; candidate record; part jsonb; is_manager boolean;
BEGIN
 SELECT * INTO anchor FROM public.shift_assignments WHERE id=p_assignment_id AND organization_id=haven.organization_id() AND deleted_at IS NULL;
 is_manager:=haven.app_role() IN('owner','org_admin','facility_admin','manager');
 IF auth.uid() IS NULL OR anchor.id IS NULL OR NOT haven.has_facility_access(anchor.facility_id) OR (NOT is_manager AND NOT EXISTS(SELECT 1 FROM public.staff WHERE id=anchor.staff_id AND user_id=auth.uid() AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Work group access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO week FROM public.schedules WHERE id=anchor.schedule_id;
 wanted:=haven.schedule_swap_blocks(anchor.id,anchor.staff_id,anchor.facility_id,anchor.organization_id,'group',true);
 FOR employee IN SELECT s.* FROM public.staff s WHERE s.organization_id=anchor.organization_id AND s.id<>anchor.staff_id AND s.deleted_at IS NULL AND s.employment_status='active' AND s.user_id IS NOT NULL AND s.user_id IS DISTINCT FROM (SELECT user_id FROM public.staff WHERE id=anchor.staff_id) ORDER BY s.last_name,s.first_name,s.id LOOP
  IF NOT haven.schedule_cover_eligible(employee.id,anchor.facility_id,wanted) THEN CONTINUE; END IF;
  blocks:='[]';
  FOR candidate IN SELECT a.id FROM public.shift_assignments a JOIN public.schedules w ON w.id=a.schedule_id AND w.status='published' AND w.deleted_at IS NULL WHERE a.staff_id=employee.id AND a.facility_id=anchor.facility_id AND a.organization_id=anchor.organization_id AND a.shift_date BETWEEN week.week_start_date AND week.week_start_date+6 AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed') AND (a.schedule_group_id IS NULL OR a.schedule_block_index=0) ORDER BY a.shift_date,a.custom_start_time,a.id LOOP
   BEGIN
    part:=haven.schedule_swap_blocks(candidate.id,employee.id,anchor.facility_id,anchor.organization_id,'group',true);
    IF haven.schedule_cover_eligible(anchor.staff_id,anchor.facility_id,part) THEN blocks:=blocks||part; END IF;
   EXCEPTION WHEN raise_exception THEN CONTINUE;
   END;
  END LOOP;
  staff_id:=employee.id;staff_name:=concat_ws(' ',employee.first_name,employee.last_name);staff_role:=wanted->0->>'staff_role';RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.schedule_swap_candidates(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_swap_candidates(uuid) TO authenticated;
CREATE FUNCTION haven.guard_shift_swap_group() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE requested jsonb; offered jsonb; context_hash text; req_user uuid; cov_user uuid; changed boolean; manager boolean; ids uuid[]; block jsonb; target_staff uuid; role_now public.staff_role; saved record;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Swap history cannot be deleted'; END IF;
 IF auth.uid() IS NULL OR NEW.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.has_facility_access(NEW.facility_id) THEN RAISE EXCEPTION 'Swap facility access required' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') AND NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW.requesting_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Create requests only for your own work'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='approved' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved coverage is immutable'; END IF;RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.swap_scope='group' AND OLD.status IN('cancelled','denied') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Closed group request cannot reopen. Create a fresh request.'; END IF;
 IF TG_OP='UPDATE' AND NEW.swap_scope IS DISTINCT FROM OLD.swap_scope THEN RAISE EXCEPTION 'Swap scope is immutable. Create a fresh request.'; END IF;
 IF NEW.swap_scope='assignment' THEN
  IF NEW.status NOT IN('denied','cancelled') AND EXISTS(SELECT 1 FROM public.shift_assignments WHERE id IN(NEW.requesting_assignment_id,NEW.covering_assignment_id) AND deleted_at IS NULL AND coalesce(schedule_block_count,1)>1) THEN RAISE EXCEPTION 'Review and request the whole split group, not a single block'; END IF;
  IF TG_OP='INSERT' THEN
   NEW.requesting_group_snapshot:=NULL;NEW.covering_group_snapshot:=NULL;NEW.group_context_hash:=NULL;NEW.requesting_context_hash:=NULL;NEW.covering_context_hash:=NULL;NEW.reviewed_context_hash:=NULL;
   IF EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.schedules w ON w.id=a.schedule_id AND w.status='published' WHERE a.id=NEW.requesting_assignment_id AND a.staff_id=NEW.requesting_staff_id AND a.facility_id=NEW.facility_id AND a.organization_id=NEW.organization_id AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed')) THEN
    NEW.requesting_group_snapshot:=haven.schedule_swap_blocks(NEW.requesting_assignment_id,NEW.requesting_staff_id,NEW.facility_id,NEW.organization_id,'assignment',false);
    IF NEW.covering_assignment_id IS NOT NULL THEN NEW.covering_group_snapshot:=haven.schedule_swap_blocks(NEW.covering_assignment_id,NEW.covering_staff_id,NEW.facility_id,NEW.organization_id,'assignment',false); ELSE NEW.covering_group_snapshot:='[]'; END IF;
   END IF;
  ELSIF (NEW.requesting_group_snapshot,NEW.covering_group_snapshot,NEW.group_context_hash,NEW.requesting_context_hash,NEW.covering_context_hash,NEW.reviewed_context_hash) IS DISTINCT FROM (OLD.requesting_group_snapshot,OLD.covering_group_snapshot,OLD.group_context_hash,OLD.requesting_context_hash,OLD.covering_context_hash,OLD.reviewed_context_hash) THEN RAISE EXCEPTION 'Swap context is server derived'; END IF;
  RETURN NEW;
 END IF;
 manager:=haven.app_role() IN('owner','org_admin','facility_admin','manager');
 IF auth.uid() IS NULL OR NEW.organization_id IS DISTINCT FROM haven.organization_id() OR NOT haven.has_facility_access(NEW.facility_id) THEN RAISE EXCEPTION 'Swap facility access required' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO req_user FROM public.staff WHERE id=NEW.requesting_staff_id AND organization_id=NEW.organization_id AND deleted_at IS NULL;
 SELECT user_id INTO cov_user FROM public.staff WHERE id=NEW.covering_staff_id AND organization_id=NEW.organization_id AND deleted_at IS NULL;
 IF req_user IS NULL OR cov_user IS NULL OR req_user=cov_user THEN RAISE EXCEPTION 'Two distinct employees with active accounts must confirm'; END IF;
 IF NOT manager AND auth.uid() NOT IN(req_user,cov_user) THEN RAISE EXCEPTION 'Only a participant may change this group request' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' AND auth.uid()<>req_user THEN RAISE EXCEPTION 'Create requests only for your own work'; END IF;
 IF NEW.status IN('approved','denied') AND NOT manager THEN RAISE EXCEPTION 'Scheduling manager approval required'; END IF;
 IF NEW.swap_type NOT IN('swap','cover') OR (NEW.swap_type='swap') IS DISTINCT FROM (NEW.covering_assignment_id IS NOT NULL) THEN RAISE EXCEPTION 'Group type must match exchange or cover without a counterpart'; END IF;
 IF TG_OP='INSERT' AND NEW.status<>'pending' THEN RAISE EXCEPTION 'Create a pending group request before confirmation'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.facility_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id) THEN RAISE EXCEPTION 'Swap identity and facility are immutable'; END IF;
 changed:=TG_OP='INSERT' OR (NEW.swap_scope,NEW.swap_type,NEW.requesting_staff_id,NEW.covering_staff_id,NEW.requesting_assignment_id,NEW.covering_assignment_id) IS DISTINCT FROM (OLD.swap_scope,OLD.swap_type,OLD.requesting_staff_id,OLD.covering_staff_id,OLD.requesting_assignment_id,OLD.covering_assignment_id);
 IF changed AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Group proposal is immutable. Cancel and create a fresh request.'; END IF;
 IF TG_OP='UPDATE' AND NEW.status IN('cancelled','denied') THEN
  IF (NEW.requesting_group_snapshot,NEW.covering_group_snapshot,NEW.group_context_hash,NEW.requesting_context_hash,NEW.covering_context_hash,NEW.requesting_confirmed_at,NEW.covering_confirmed_at,NEW.eligibility_reviewed_at,NEW.eligibility_reviewed_by,NEW.reviewed_context_hash) IS DISTINCT FROM (OLD.requesting_group_snapshot,OLD.covering_group_snapshot,OLD.group_context_hash,OLD.requesting_context_hash,OLD.covering_context_hash,OLD.requesting_confirmed_at,OLD.covering_confirmed_at,OLD.eligibility_reviewed_at,OLD.eligibility_reviewed_by,OLD.reviewed_context_hash) THEN RAISE EXCEPTION 'Closing a request cannot rewrite its consent history'; END IF;
  NEW.approved_by:=NULL;NEW.approved_at:=NULL;RETURN NEW;
 END IF;
 IF NEW.status NOT IN('pending','claimed','approved') THEN RAISE EXCEPTION 'Pending group request required'; END IF;
 IF NEW.status<>'approved' THEN NEW.approved_by:=NULL;NEW.approved_at:=NULL;END IF;

 IF changed AND TG_OP='UPDATE' AND NOT manager AND auth.uid() IS DISTINCT FROM (SELECT user_id FROM public.staff WHERE id=OLD.requesting_staff_id) THEN RAISE EXCEPTION 'Only the requester may change the proposal'; END IF;
 -- Lock all involved parent weeks, people and rows in the existing global order.
 PERFORM w.id FROM public.schedules w WHERE w.id IN(SELECT schedule_id FROM public.shift_assignments WHERE id IN(NEW.requesting_assignment_id,NEW.covering_assignment_id)) ORDER BY w.id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(hashtextextended(x.id::text,0)) FROM(SELECT NEW.requesting_staff_id id UNION SELECT NEW.covering_staff_id) x ORDER BY x.id;
 requested:=haven.schedule_swap_blocks(NEW.requesting_assignment_id,NEW.requesting_staff_id,NEW.facility_id,NEW.organization_id,'group',true);
 offered:=haven.schedule_swap_blocks(NEW.covering_assignment_id,NEW.covering_staff_id,NEW.facility_id,NEW.organization_id,'group',true);
 SELECT array_agg((v->>'assignment_id')::uuid) INTO ids FROM jsonb_array_elements(requested||offered) v;
 PERFORM id FROM public.shift_assignments WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 IF NOT haven.schedule_cover_eligible(NEW.requesting_staff_id,NEW.facility_id,requested) OR NOT haven.schedule_cover_eligible(NEW.covering_staff_id,NEW.facility_id,requested) OR (jsonb_array_length(offered)>0 AND NOT haven.schedule_cover_eligible(NEW.requesting_staff_id,NEW.facility_id,offered)) THEN RAISE EXCEPTION 'Group coverage requires matching facility roles and current permissions'; END IF;
 context_hash:=haven.timeclock_sha256(jsonb_build_object('requestId',NEW.id,'organizationId',NEW.organization_id,'facilityId',NEW.facility_id,'swapScope',NEW.swap_scope,'swapType',NEW.swap_type,'requestingStaffId',NEW.requesting_staff_id,'requestingUserId',req_user,'coveringStaffId',NEW.covering_staff_id,'coveringUserId',cov_user,'requested',requested,'offered',offered)::text);
 IF changed THEN
  NEW.requesting_group_snapshot:=requested;NEW.covering_group_snapshot:=offered;NEW.group_context_hash:=context_hash;NEW.requesting_context_hash:=NULL;NEW.covering_context_hash:=NULL;NEW.reviewed_context_hash:=NULL;NEW.requesting_confirmed_at:=NULL;NEW.covering_confirmed_at:=NULL;NEW.status:='pending';NEW.eligibility_reviewed_at:=NULL;NEW.eligibility_reviewed_by:=NULL;
 ELSE
  IF (NEW.requesting_group_snapshot,NEW.covering_group_snapshot,NEW.group_context_hash) IS DISTINCT FROM (OLD.requesting_group_snapshot,OLD.covering_group_snapshot,OLD.group_context_hash) THEN RAISE EXCEPTION 'Group context is server derived'; END IF;
  IF context_hash IS DISTINCT FROM OLD.group_context_hash THEN RAISE EXCEPTION 'Work group context changed. Create a fresh request for review.'; END IF;
  IF NEW.requesting_context_hash IS DISTINCT FROM OLD.requesting_context_hash AND auth.uid()<>req_user THEN RAISE EXCEPTION 'Only the requesting employee may confirm'; END IF;
  IF NEW.covering_context_hash IS DISTINCT FROM OLD.covering_context_hash AND auth.uid()<>cov_user THEN RAISE EXCEPTION 'Only the covering employee may confirm'; END IF;
  IF NEW.requesting_confirmed_at IS DISTINCT FROM OLD.requesting_confirmed_at THEN
   IF auth.uid()<>req_user OR NEW.requesting_context_hash IS DISTINCT FROM context_hash THEN RAISE EXCEPTION 'Review and confirm all requesting work blocks'; END IF;NEW.requesting_confirmed_at:=clock_timestamp();
  END IF;
  IF NEW.covering_confirmed_at IS DISTINCT FROM OLD.covering_confirmed_at THEN
   IF auth.uid()<>cov_user OR NEW.covering_context_hash IS DISTINCT FROM context_hash THEN RAISE EXCEPTION 'Review and confirm all covering work blocks'; END IF;NEW.covering_confirmed_at:=clock_timestamp();
  END IF;
 END IF;
 IF NEW.status<>'approved' AND NEW.reviewed_context_hash IS NOT NULL THEN RAISE EXCEPTION 'Manager context acknowledgement must accompany approval'; END IF;
 IF NOT changed AND NEW.reviewed_context_hash IS DISTINCT FROM OLD.reviewed_context_hash THEN
  IF NOT manager OR NEW.reviewed_context_hash IS DISTINCT FROM context_hash THEN RAISE EXCEPTION 'Manager must review the exact whole group context'; END IF;
 END IF;
 IF NOT changed AND (NEW.eligibility_reviewed_at,NEW.eligibility_reviewed_by) IS DISTINCT FROM (OLD.eligibility_reviewed_at,OLD.eligibility_reviewed_by) THEN
  IF NOT manager THEN RAISE EXCEPTION 'Scheduling manager review required'; END IF;NEW.eligibility_reviewed_at:=clock_timestamp();NEW.eligibility_reviewed_by:=auth.uid();
 END IF;
 IF NEW.status='approved' THEN
  IF NEW.requesting_confirmed_at IS NULL OR NEW.covering_confirmed_at IS NULL OR NEW.requesting_context_hash IS DISTINCT FROM context_hash OR NEW.covering_context_hash IS DISTINCT FROM context_hash THEN RAISE EXCEPTION 'Both employees must confirm the exact whole group'; END IF;
  IF NEW.reviewed_context_hash IS DISTINCT FROM context_hash THEN RAISE EXCEPTION 'Manager must review the exact whole group context'; END IF;
  IF NEW.eligibility_reviewed_by IS DISTINCT FROM auth.uid() OR NEW.eligibility_reviewed_at IS NULL OR NEW.eligibility_reviewed_at<clock_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Review required credentials, weekly hours and rest before applying coverage'; END IF;
  FOR block IN SELECT value FROM jsonb_array_elements(requested||offered) LOOP
   target_staff:=CASE WHEN (block->>'staff_id')::uuid=NEW.requesting_staff_id THEN NEW.covering_staff_id ELSE NEW.requesting_staff_id END;
   IF NOT haven.schedule_credentials_current(target_staff,NEW.facility_id,(block->>'service_date')::date) THEN RAISE EXCEPTION 'Review missing or expired covering employee credentials'; END IF;
   IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE staff_id=target_staff AND deleted_at IS NULL AND status NOT IN('called_out','no_show') AND NOT id=ANY(ids) AND shift_date BETWEEN (block->>'service_date')::date-1 AND (block->>'service_date')::date+1) THEN RAISE EXCEPTION 'Employee has adjacent assignments; review rest and overlap before coverage'; END IF;
  END LOOP;
  NEW.approved_by:=auth.uid();NEW.approved_at:=clock_timestamp();NEW.denied_reason:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_shift_swap_group() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_shift_swap_group_context BEFORE INSERT OR UPDATE OR DELETE ON public.shift_swap_requests FOR EACH ROW EXECUTE FUNCTION haven.guard_shift_swap_group();
CREATE FUNCTION public.confirm_shift_swap_group(p_id uuid,p_expected_context_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE request public.shift_swap_requests;
BEGIN
 SELECT * INTO request FROM public.shift_swap_requests WHERE id=p_id AND swap_scope='group' AND status IN('pending','claimed') AND deleted_at IS NULL FOR UPDATE;
 IF request.id IS NULL OR request.group_context_hash IS DISTINCT FROM p_expected_context_hash THEN RAISE EXCEPTION 'Group request changed. Reload all blocks before confirming.'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff WHERE id=request.requesting_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN
  UPDATE public.shift_swap_requests SET requesting_context_hash=p_expected_context_hash,requesting_confirmed_at=clock_timestamp() WHERE id=p_id;
 ELSIF EXISTS(SELECT 1 FROM public.staff WHERE id=request.covering_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN
  UPDATE public.shift_swap_requests SET covering_context_hash=p_expected_context_hash,covering_confirmed_at=clock_timestamp() WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Only a participant can confirm this group'; END IF;RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_shift_swap_group(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.confirm_shift_swap_group(uuid,text) TO authenticated;
DO $group_paths$ DECLARE src text; needle text; BEGIN
 SELECT pg_get_functiondef('public.confirm_shift_swap(uuid)'::regprocedure) INTO src;
 needle:='  IF NOT FOUND THEN RAISE EXCEPTION ''Pending swap unavailable''; END IF;';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Legacy confirmation anchor changed'; END IF;
 EXECUTE replace(src,needle,needle||' IF v_swap.swap_scope=''group'' THEN RAISE EXCEPTION ''Review and confirm all work blocks with their current context''; END IF;');
 SELECT pg_get_functiondef('public.haven_apply_approved_shift_swap()'::regprocedure) INTO src;
 EXECUTE replace(src,'BEGIN'||chr(10),'BEGIN'||chr(10)||'  IF NEW.swap_scope=''group'' THEN RETURN NEW; END IF;'||chr(10));
 SELECT pg_get_functiondef('haven.guard_schedule_assignment()'::regprocedure) INTO src;
 needle:='((r.requesting_assignment_id=NEW.id AND r.requesting_staff_id=OLD.staff_id AND r.covering_staff_id=NEW.staff_id)'||chr(10)||'          OR (r.covering_assignment_id=NEW.id AND r.covering_staff_id=OLD.staff_id AND r.requesting_staff_id=NEW.staff_id))';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Published swap authorization anchor changed'; END IF;
 EXECUTE replace(src,needle,$text$(((r.requesting_assignment_id=NEW.id OR (r.swap_scope='group' AND r.requesting_group_snapshot @> jsonb_build_array(jsonb_build_object('assignment_id',NEW.id)))) AND r.requesting_staff_id=OLD.staff_id AND r.covering_staff_id=NEW.staff_id)
          OR ((r.covering_assignment_id=NEW.id OR (r.swap_scope='group' AND r.covering_group_snapshot @> jsonb_build_array(jsonb_build_object('assignment_id',NEW.id)))) AND r.covering_staff_id=OLD.staff_id AND r.requesting_staff_id=NEW.staff_id))$text$);
END $group_paths$;
CREATE OR REPLACE FUNCTION haven.apply_reviewed_shift_swap() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE expected integer; changed integer; requested uuid[]; offered uuid[];
BEGIN
 IF NEW.status='approved' AND OLD.status<>'approved' THEN
  IF NEW.swap_scope='group' THEN
   SELECT array_agg((v->>'assignment_id')::uuid) INTO requested FROM jsonb_array_elements(NEW.requesting_group_snapshot) v;
   SELECT coalesce(array_agg((v->>'assignment_id')::uuid),'{}'::uuid[]) INTO offered FROM jsonb_array_elements(NEW.covering_group_snapshot) v;
  ELSE requested:=ARRAY[NEW.requesting_assignment_id];offered:=CASE WHEN NEW.covering_assignment_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.covering_assignment_id] END;END IF;
  expected:=cardinality(requested)+cardinality(offered);
  UPDATE public.shift_assignments SET staff_id=CASE WHEN id=ANY(requested) THEN NEW.covering_staff_id ELSE NEW.requesting_staff_id END,updated_by=auth.uid()
   WHERE (id=ANY(requested) AND staff_id=NEW.requesting_staff_id) OR (id=ANY(offered) AND staff_id=NEW.covering_staff_id);
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>expected THEN
   IF NEW.swap_scope='group' THEN RAISE EXCEPTION 'Every confirmed work block must move atomically'; END IF;
   RAISE EXCEPTION 'Requesting assignment update was not applied in full';
  END IF;
 END IF;RETURN NEW;
END $$;

COMMENT ON FUNCTION public.schedule_people_for_week(uuid) IS 'COL-37 ruling: definer required to project visiting employees without widening salary-bearing staff table RLS. Verifies current schedule-manager role, organization and facility access; returns only employee IDs, names, job/status and dated role memberships for the selected week. No pay, contacts or patient data.';
COMMENT ON FUNCTION public.schedule_swap_candidates(uuid) IS 'COL-37 ruling: definer required for a bounded coworker work-context projection while staff-table and assignment RLS remain private. Verifies the current actor owns the anchor or manages its authorized facility, then returns same-organization/facility role-compatible candidates and intact future published blocks in that week. No payroll, contacts, credentials or resident lists; this read grants no coverage or clinical permission.';
COMMIT;
