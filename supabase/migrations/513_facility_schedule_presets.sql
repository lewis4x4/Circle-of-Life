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
CREATE TABLE public.facility_schedule_presets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organizations(id),facility_id uuid NOT NULL REFERENCES public.facilities(id),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 60),color text NOT NULL CHECK(color~'^#[0-9A-Fa-f]{6}$'),
 allowed_staff_roles public.staff_role[] NOT NULL CHECK(cardinality(allowed_staff_roles)>0 AND array_position(allowed_staff_roles,NULL) IS NULL),
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
INSERT INTO public.facility_schedule_presets(organization_id,facility_id,label,color,allowed_staff_roles,sort_order,active,blocks,roster_shift_type,source_shift_definition_id,created_by,updated_by)
 SELECT organization_id,facility_id,label,'#64748B',enum_range(NULL::public.staff_role),sort_order,active,jsonb_build_array(jsonb_build_object('start',to_char(starts_at_local,'HH24:MI'),'end',to_char(ends_at_local,'HH24:MI'))),roster_shift_type,id,created_by,updated_by
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
CREATE FUNCTION public.schedule_preset_save(p_facility_id uuid,p_preset_id uuid,p_expected_version integer,p_label text,p_color text,p_sort_order integer,p_blocks jsonb,p_allowed_staff_roles public.staff_role[],p_active boolean DEFAULT true,p_deleted boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.facility_schedule_presets;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') OR NOT haven.has_facility_access(p_facility_id) THEN RAISE EXCEPTION 'Schedule manager access required' USING ERRCODE='42501'; END IF;
 IF p_active IS NULL OR p_deleted IS NULL THEN RAISE EXCEPTION 'Shift option state required'; END IF;
 IF p_preset_id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 OR p_deleted THEN RAISE EXCEPTION 'New shift option requires version zero'; END IF;
  INSERT INTO public.facility_schedule_presets(organization_id,facility_id,label,color,sort_order,blocks,allowed_staff_roles,active) VALUES(haven.organization_id(),p_facility_id,p_label,p_color,p_sort_order,p_blocks,p_allowed_staff_roles,p_active) RETURNING * INTO p;
 ELSE
  UPDATE public.facility_schedule_presets SET label=p_label,color=p_color,sort_order=p_sort_order,blocks=p_blocks,allowed_staff_roles=p_allowed_staff_roles,active=p_active,deleted_at=CASE WHEN p_deleted THEN clock_timestamp() END,version=version+1 WHERE id=p_preset_id AND facility_id=p_facility_id AND deleted_at IS NULL AND version=p_expected_version RETURNING * INTO p;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Shift option changed or unavailable. Reload before saving.' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.schedule_preset_save(uuid,uuid,integer,text,text,integer,jsonb,public.staff_role[],boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_preset_save(uuid,uuid,integer,text,text,integer,jsonb,public.staff_role[],boolean,boolean) TO authenticated;

ALTER TABLE public.shift_assignments
 ADD COLUMN schedule_preset_id uuid REFERENCES public.facility_schedule_presets(id),ADD COLUMN schedule_preset_name text,ADD COLUMN schedule_preset_color text,
 ADD COLUMN schedule_preset_version integer,ADD COLUMN schedule_role_snapshot public.staff_role,ADD COLUMN schedule_time_zone text,
 ADD COLUMN schedule_starts_at timestamptz,ADD COLUMN schedule_ends_at timestamptz,ADD COLUMN schedule_group_id uuid,
 ADD COLUMN schedule_block_index integer,ADD COLUMN schedule_block_count integer,
 ADD CONSTRAINT schedule_snapshot_shape CHECK((schedule_group_id IS NULL AND schedule_preset_id IS NULL AND schedule_preset_name IS NULL AND schedule_preset_color IS NULL AND schedule_preset_version IS NULL AND schedule_block_index IS NULL AND schedule_block_count IS NULL) OR
 (schedule_group_id IS NOT NULL AND ((schedule_preset_id IS NOT NULL AND schedule_preset_version>0) OR (schedule_preset_id IS NULL AND schedule_preset_version IS NULL AND schedule_preset_name='Custom')) AND length(schedule_preset_name) BETWEEN 1 AND 60 AND schedule_preset_color~'^#[0-9A-Fa-f]{6}$' AND schedule_block_count BETWEEN 1 AND 8 AND schedule_block_index>=0 AND schedule_block_index<schedule_block_count)),
 ADD CONSTRAINT schedule_interval_shape CHECK((schedule_starts_at IS NULL AND schedule_ends_at IS NULL) OR (schedule_time_zone IS NOT NULL AND schedule_starts_at IS NOT NULL AND schedule_ends_at IS NOT NULL AND schedule_ends_at>schedule_starts_at));
CREATE INDEX idx_schedule_assignment_interval ON public.shift_assignments(facility_id,schedule_starts_at,schedule_ends_at) WHERE deleted_at IS NULL;
CREATE FUNCTION haven.stamp_schedule_assignment_interval() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tz text; job public.staff_role; phase public.schedule_status;
BEGIN
 SELECT status INTO phase FROM public.schedules WHERE id=NEW.schedule_id;
 IF TG_OP='UPDATE' AND phase<>'draft' AND (NEW.schedule_preset_id,NEW.schedule_preset_name,NEW.schedule_preset_color,NEW.schedule_preset_version,NEW.schedule_role_snapshot,NEW.schedule_time_zone,NEW.schedule_starts_at,NEW.schedule_ends_at,NEW.schedule_group_id,NEW.schedule_block_index,NEW.schedule_block_count) IS DISTINCT FROM (OLD.schedule_preset_id,OLD.schedule_preset_name,OLD.schedule_preset_color,OLD.schedule_preset_version,OLD.schedule_role_snapshot,OLD.schedule_time_zone,OLD.schedule_starts_at,OLD.schedule_ends_at,OLD.schedule_group_id,OLD.schedule_block_index,OLD.schedule_block_count) THEN RAISE EXCEPTION 'Published assignment snapshots are immutable'; END IF;
 IF TG_OP='UPDATE' AND phase<>'draft' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR (NEW.shift_date,NEW.custom_start_time,NEW.custom_end_time,NEW.schedule_time_zone,NEW.schedule_starts_at,NEW.schedule_ends_at) IS DISTINCT FROM (OLD.shift_date,OLD.custom_start_time,OLD.custom_end_time,OLD.schedule_time_zone,OLD.schedule_starts_at,OLD.schedule_ends_at) THEN
  SELECT timezone INTO tz FROM public.facilities WHERE id=NEW.facility_id;
  tz:=coalesce(NEW.schedule_time_zone,tz);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN RAISE EXCEPTION 'Valid facility timezone required'; END IF;
  IF NEW.custom_start_time IS NOT NULL AND NEW.custom_end_time IS NOT NULL AND NEW.custom_start_time<>NEW.custom_end_time THEN
   NEW.schedule_time_zone:=tz;NEW.schedule_starts_at:=(NEW.shift_date+NEW.custom_start_time) AT TIME ZONE tz;
   NEW.schedule_ends_at:=(NEW.shift_date+CASE WHEN NEW.custom_end_time<NEW.custom_start_time THEN 1 ELSE 0 END+NEW.custom_end_time) AT TIME ZONE tz;
   IF (NEW.schedule_starts_at AT TIME ZONE tz) IS DISTINCT FROM (NEW.shift_date+NEW.custom_start_time) OR (NEW.schedule_ends_at AT TIME ZONE tz) IS DISTINCT FROM (NEW.shift_date+CASE WHEN NEW.custom_end_time<NEW.custom_start_time THEN 1 ELSE 0 END+NEW.custom_end_time) THEN RAISE EXCEPTION 'Shift time does not exist in the facility timezone'; END IF;
  END IF;
 END IF;
 IF NEW.schedule_role_snapshot IS NULL THEN SELECT staff_role INTO job FROM public.staff WHERE id=NEW.staff_id;NEW.schedule_role_snapshot:=job; END IF;
 IF NEW.schedule_preset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.facility_schedule_presets p WHERE p.id=NEW.schedule_preset_id AND p.facility_id=NEW.facility_id AND p.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Shift option must belong to schedule facility'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_stamp_assignment_interval BEFORE INSERT OR UPDATE ON public.shift_assignments FOR EACH ROW EXECUTE FUNCTION haven.stamp_schedule_assignment_interval();
REVOKE ALL ON FUNCTION haven.stamp_schedule_assignment_interval() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.schedule_assignment_intervals(p_facility_id uuid,p_from timestamptz,p_to timestamptz,p_staff_id uuid DEFAULT NULL)
RETURNS TABLE(assignment_id uuid,schedule_id uuid,staff_id uuid,facility_id uuid,service_date date,starts_at timestamptz,ends_at timestamptz,time_zone text,preset_id uuid,preset_version integer,label text,color text,staff_role public.staff_role,group_id uuid,block_index integer,block_count integer,legacy_shift_type public.shift_type,status public.shift_assignment_status,is_legacy boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT a.id,a.schedule_id,a.staff_id,a.facility_id,a.shift_date,t.starts_at,t.ends_at,t.tz,a.schedule_preset_id,a.schedule_preset_version,
 coalesce(a.schedule_preset_name,CASE WHEN a.shift_type='custom' THEN 'Custom' ELSE initcap(a.shift_type::text) END),coalesce(a.schedule_preset_color,'#64748B'),coalesce(a.schedule_role_snapshot,s.staff_role),a.schedule_group_id,a.schedule_block_index,a.schedule_block_count,a.shift_type,a.status,a.schedule_starts_at IS NULL
 FROM public.shift_assignments a JOIN public.schedules w ON w.id=a.schedule_id AND w.status='published' AND w.deleted_at IS NULL
 JOIN public.facilities f ON f.id=a.facility_id AND f.organization_id=a.organization_id AND f.deleted_at IS NULL
 JOIN public.staff s ON s.id=a.staff_id AND s.organization_id=a.organization_id AND s.deleted_at IS NULL AND s.employment_status='active'
 CROSS JOIN LATERAL(SELECT coalesce(a.schedule_time_zone,f.timezone) tz) z
 CROSS JOIN LATERAL(SELECT coalesce(a.schedule_starts_at,(a.shift_date+a.custom_start_time) AT TIME ZONE z.tz) starts_at,coalesce(a.schedule_ends_at,(a.shift_date+CASE WHEN a.custom_end_time<a.custom_start_time THEN 1 ELSE 0 END+a.custom_end_time) AT TIME ZONE z.tz) ends_at,z.tz) t
 WHERE (a.facility_id=p_facility_id OR (p_facility_id IS NULL AND p_staff_id IS NOT NULL)) AND (p_staff_id IS NULL OR a.staff_id=p_staff_id) AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed') AND p_to>p_from AND t.starts_at<p_to AND t.ends_at>p_from AND t.ends_at>t.starts_at
 ORDER BY t.starts_at,a.staff_id,a.id;
$$;
REVOKE ALL ON FUNCTION public.schedule_assignment_intervals(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.schedule_assignment_intervals(uuid,timestamptz,timestamptz,uuid) TO authenticated,service_role;

-- Complete managed groups can be edited; unrelated legacy rows remain explicit.
CREATE FUNCTION haven.schedule_cell_intact(p_schedule uuid,p_staff uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT count(*)<=1 AND (count(schedule_group_id)=0 OR (min(schedule_block_index)=0 AND min(schedule_block_count)=1)) OR
 (count(*)>1 AND count(schedule_group_id)=count(*) AND count(DISTINCT schedule_group_id)=1 AND (count(schedule_preset_id)=0 OR (count(schedule_preset_id)=count(*) AND count(DISTINCT schedule_preset_id)=1)) AND (count(schedule_preset_version)=0 OR (count(schedule_preset_version)=count(*) AND count(DISTINCT schedule_preset_version)=1)) AND count(DISTINCT schedule_preset_name)=1 AND count(DISTINCT schedule_preset_color)=1 AND count(DISTINCT schedule_block_count)=1 AND min(schedule_block_count)=count(*) AND count(DISTINCT schedule_block_index)=count(*) AND min(schedule_block_index)=0 AND max(schedule_block_index)=count(*)-1)
 FROM public.shift_assignments WHERE schedule_id=p_schedule AND staff_id=p_staff AND shift_date=p_date AND deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION haven.schedule_cell_intact(uuid,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_cell_intact(uuid,uuid,date) TO authenticated;
CREATE OR REPLACE FUNCTION public.schedule_bulk_upsert(p_schedule_id uuid,p_expected_updated_at timestamptz,p_cells jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules; c record; p public.facility_schedule_presets; d public.facility_shift_definitions; s public.staff; b jsonb; blocks jsonb; plan jsonb:='[]'; entry jsonb; originals jsonb; group_key uuid; index_no integer; existing_id uuid; prior jsonb; classification public.shift_type; tz text;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
 SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
 IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before saving.'; END IF;
 IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Provide 1 to 1000 cell changes'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) GROUP BY staff_id,shift_date HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate employee/date cells'; END IF;
 SELECT timezone INTO tz FROM public.facilities WHERE id=w.facility_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(st.id::text,0)) FROM public.staff st WHERE st.id IN(SELECT x.staff_id FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid)) ORDER BY st.id;
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO originals FROM public.shift_assignments a JOIN jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) ON x.staff_id=a.staff_id AND x.shift_date=a.shift_date WHERE a.schedule_id=w.id AND a.deleted_at IS NULL;
 FOR c IN SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid,custom_start_time text,custom_end_time text,preset_id uuid,expected_preset_version integer,custom_blocks jsonb) ORDER BY staff_id,shift_date LOOP
  IF c.shift_date IS NULL OR c.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6 THEN RAISE EXCEPTION 'Shift date must be inside this schedule week'; END IF;
  SELECT * INTO s FROM public.staff WHERE id=c.staff_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND employment_status='active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
  IF NOT haven.schedule_cell_intact(w.id,c.staff_id,c.shift_date) THEN RAISE EXCEPTION 'Multiple assignments in this cell. Review assignment details first.'; END IF;
  IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND staff_id=c.staff_id AND shift_date=c.shift_date AND deleted_at IS NULL AND (status NOT IN('assigned','confirmed') OR covers_assignment_id IS NOT NULL)) THEN RAISE EXCEPTION 'Resolve the assignment status before replacing this cell'; END IF;
  p:=NULL;d:=NULL;blocks:='[]';classification:='custom';group_key:=NULL;
  IF c.preset_id IS NOT NULL THEN
   IF c.shift_definition_id IS NOT NULL OR c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL OR c.custom_blocks IS NOT NULL THEN RAISE EXCEPTION 'Choose one shift option or custom times'; END IF;
   SELECT * INTO p FROM public.facility_schedule_presets WHERE id=c.preset_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND OR p.version IS DISTINCT FROM c.expected_preset_version THEN RAISE EXCEPTION 'Shift option changed or unavailable. Reload before saving.'; END IF;
   IF NOT s.staff_role=ANY(p.allowed_staff_roles) THEN RAISE EXCEPTION 'Shift option is not available for this employee role'; END IF;
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
   SELECT * INTO d FROM public.facility_shift_definitions WHERE id=c.shift_definition_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL FOR SHARE;
   IF NOT FOUND OR d.starts_at_local=d.ends_at_local THEN RAISE EXCEPTION 'Active facility shift definition with distinct times required'; END IF;
   blocks:=jsonb_build_array(jsonb_build_object('start',d.starts_at_local,'end',d.ends_at_local));classification:=d.roster_shift_type;
  END IF;
  index_no:=0;
  FOR b IN SELECT value FROM jsonb_array_elements(blocks) LOOP
   SELECT value INTO prior FROM jsonb_array_elements(originals) WHERE value->>'staff_id'=c.staff_id::text AND value->>'shift_date'=c.shift_date::text AND coalesce((value->>'schedule_block_index')::integer,0)=index_no;
   existing_id:=coalesce((prior->>'id')::uuid,gen_random_uuid());
   IF prior IS NULL THEN SELECT value INTO prior FROM jsonb_array_elements(originals) WHERE value->>'staff_id'=c.staff_id::text AND value->>'shift_date'=c.shift_date::text ORDER BY coalesce((value->>'schedule_block_index')::integer,0) LIMIT 1; END IF;
   plan:=plan||jsonb_build_array(jsonb_build_object('id',existing_id,'staff_id',c.staff_id,'shift_date',c.shift_date,'start',b->>'start','end',b->>'end','shift_type',classification,'definition',d.id,'preset',p.id,'name',CASE WHEN p.id IS NOT NULL THEN p.label WHEN group_key IS NOT NULL THEN 'Custom' END,'color',CASE WHEN p.id IS NOT NULL THEN p.color WHEN group_key IS NOT NULL THEN '#64748B' END,'version',p.version,'role',s.staff_role,'timezone',tz,'group',group_key,'index',CASE WHEN group_key IS NOT NULL THEN index_no END,'count',CASE WHEN group_key IS NOT NULL THEN jsonb_array_length(blocks) END,'prior',prior));
   index_no:=index_no+1;
  END LOOP;
 END LOOP;
 -- Temporarily retire all touched blocks in this transaction. Their IDs and
 -- metadata are restored by block index; overlap checks see only final plans.
 UPDATE public.shift_assignments a SET deleted_at=clock_timestamp(),updated_by=auth.uid() FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) WHERE a.schedule_id=w.id AND a.staff_id=x.staff_id AND a.shift_date=x.shift_date AND a.deleted_at IS NULL;
 FOR entry IN SELECT value FROM jsonb_array_elements(plan) LOOP
  UPDATE public.shift_assignments SET deleted_at=NULL,shift_type=(entry->>'shift_type')::public.shift_type,custom_start_time=(entry->>'start')::time,custom_end_time=(entry->>'end')::time,shift_definition_id=(entry->>'definition')::uuid,
   schedule_preset_id=(entry->>'preset')::uuid,schedule_preset_name=entry->>'name',schedule_preset_color=entry->>'color',schedule_preset_version=(entry->>'version')::integer,schedule_role_snapshot=(entry->>'role')::public.staff_role,schedule_time_zone=entry->>'timezone',schedule_group_id=(entry->>'group')::uuid,schedule_block_index=(entry->>'index')::integer,schedule_block_count=(entry->>'count')::integer,updated_by=auth.uid()
   WHERE id=(entry->>'id')::uuid AND schedule_id=w.id;
  IF NOT FOUND THEN
   INSERT INTO public.shift_assignments(id,schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time,shift_definition_id,schedule_preset_id,schedule_preset_name,schedule_preset_color,schedule_preset_version,schedule_role_snapshot,schedule_time_zone,schedule_group_id,schedule_block_index,schedule_block_count,unit_id,assigned_resident_ids,shift_classification,notes,created_by,updated_by)
    VALUES((entry->>'id')::uuid,w.id,(entry->>'staff_id')::uuid,w.facility_id,w.organization_id,(entry->>'shift_date')::date,(entry->>'shift_type')::public.shift_type,(entry->>'start')::time,(entry->>'end')::time,(entry->>'definition')::uuid,(entry->>'preset')::uuid,entry->>'name',entry->>'color',(entry->>'version')::integer,(entry->>'role')::public.staff_role,entry->>'timezone',(entry->>'group')::uuid,(entry->>'index')::integer,(entry->>'count')::integer,(entry->'prior'->>'unit_id')::uuid,CASE WHEN jsonb_typeof(entry->'prior'->'assigned_resident_ids')='array' THEN ARRAY(SELECT jsonb_array_elements_text(entry->'prior'->'assigned_resident_ids'))::uuid[] END,coalesce((entry->'prior'->>'shift_classification')::public.shift_classification,'regular'::public.shift_classification),entry->'prior'->>'notes',auth.uid(),auth.uid());
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
 IF EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND (NOT haven.schedule_cell_intact(source_week.id,a.staff_id,a.shift_date) OR a.custom_start_time IS NULL OR a.custom_end_time IS NULL OR a.custom_start_time=a.custom_end_time)) THEN RAISE EXCEPTION 'Previous week contains incomplete groups or unrecorded times. Review assignments first.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN(SELECT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL) ORDER BY s.id;
 IF EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.staff s ON s.id=a.staff_id WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND (s.deleted_at IS NOT NULL OR s.employment_status<>'active' OR s.facility_id<>w.facility_id)) THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
 SELECT count(*) INTO count_before FROM public.shift_assignments WHERE schedule_id=source_week.id AND deleted_at IS NULL AND covers_assignment_id IS NULL;
 IF count_before=0 THEN RAISE EXCEPTION 'Previous week has no assignments to copy'; END IF;
 WITH groups AS MATERIALIZED(SELECT g.schedule_group_id,gen_random_uuid() id FROM(SELECT DISTINCT schedule_group_id FROM public.shift_assignments WHERE schedule_id=source_week.id AND deleted_at IS NULL AND schedule_group_id IS NOT NULL)g)
 INSERT INTO public.shift_assignments(schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time,shift_definition_id,unit_id,assigned_resident_ids,shift_classification,notes,schedule_preset_id,schedule_preset_name,schedule_preset_color,schedule_preset_version,schedule_role_snapshot,schedule_time_zone,schedule_group_id,schedule_block_index,schedule_block_count,created_by,updated_by)
 SELECT w.id,a.staff_id,w.facility_id,w.organization_id,a.shift_date+7,a.shift_type,a.custom_start_time,a.custom_end_time,a.shift_definition_id,a.unit_id,a.assigned_resident_ids,a.shift_classification,a.notes,a.schedule_preset_id,a.schedule_preset_name,a.schedule_preset_color,a.schedule_preset_version,a.schedule_role_snapshot,a.schedule_time_zone,g.id,a.schedule_block_index,a.schedule_block_count,auth.uid(),auth.uid()
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
  JOIN public.shift_assignments a ON a.id=i.assignment_id JOIN public.staff s ON s.id=i.staff_id AND s.facility_id=p_facility
  JOIN public.user_profiles p ON p.id=s.user_id AND p.organization_id=s.organization_id AND p.is_active AND p.deleted_at IS NULL
  JOIN auth.users u ON u.id=p.id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=p_now)
  WHERE p.app_role::text=ANY(coalesce((SELECT t.rounding_owner_roles FROM public.timeclock_facility_settings t WHERE t.facility_id=p_facility AND t.organization_id=s.organization_id),ARRAY['med_tech']))
  AND (p.app_role IN('owner','org_admin') OR EXISTS(SELECT 1 FROM public.user_facility_access g WHERE g.user_id=p.id AND g.facility_id=p_facility AND g.organization_id=p.organization_id AND g.revoked_at IS NULL))
 ), splits AS(SELECT DISTINCT ON(r.id) r.id resident_id,s.id,s.staff_id FROM unnest(p_residents) r(id) JOIN scheduled s ON r.id=ANY(s.assigned_resident_ids) ORDER BY r.id,s.id),
 ring AS(SELECT id,staff_id,row_number() OVER(ORDER BY staff_id,id)-1 position,count(*) OVER() size FROM scheduled),
 phase AS(SELECT w.starts_at_utc,w.ends_at_utc,EXISTS(SELECT 1 FROM public.timeclock_facility_settings WHERE facility_id=p_facility AND timeclock_enabled) uses_clock FROM (SELECT 1) seed LEFT JOIN LATERAL public.facility_shift_window_at(p_facility,p_now) w ON true),
 clock_staff AS(SELECT c.staff_id FROM phase ph CROSS JOIN LATERAL haven.observation_shift_owner_staff(p_facility,p_now,ph.starts_at_utc) c WHERE NOT EXISTS(SELECT 1 FROM scheduled) AND p_at>=ph.starts_at_utc AND p_at<ph.ends_at_utc
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
 SELECT pg_get_functiondef('haven.med_tech_shift_open_from_clock(uuid,uuid,timestamptz,uuid,text,uuid,uuid)'::regprocedure) INTO src;
 needle:='  INSERT INTO public.med_tech_shifts (';
 replacement:=$text$  -- A published actual work block wins over the clinical window fallback.
  SELECT a.* INTO v_assignment FROM public.schedule_assignment_intervals(p_facility_id,p_at,p_at+interval '1 microsecond',p_staff_id) i JOIN public.shift_assignments a ON a.id=i.assignment_id
  ORDER BY (a.id=p_shift_assignment_id) DESC NULLS LAST,i.starts_at DESC,a.id LIMIT 1;
  IF v_assignment.id IS NOT NULL THEN
   SELECT i.starts_at,i.ends_at INTO v_start,v_end FROM public.schedule_assignment_intervals(p_facility_id,p_at,p_at+interval '1 microsecond',p_staff_id) i WHERE i.assignment_id=v_assignment.id;
  END IF;
  INSERT INTO public.med_tech_shifts ($text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Med-Tech assignment integration anchor changed'; END IF;EXECUTE replace(src,needle,replacement);
 SELECT pg_get_functiondef('public.care_event_sync_witness_tasks(uuid)'::regprocedure) INTO src;
 needle:=$text$      -- The shift's own service date: at 1 AM the night shift's roster is dated the
      -- evening it began, not the calendar day (COL-685).
      AND sa.shift_date = COALESCE(
        (SELECT w.shift_service_date FROM public.facility_shift_window_at(v_event.facility_id, v_event.occurred_at) w),
        (v_event.occurred_at AT TIME ZONE v_tz)::date)
      AND sa.shift_type = v_event.shift$text$;
 replacement:=$text$      AND EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(v_event.facility_id,v_event.occurred_at,v_event.occurred_at+interval '1 microsecond',sa.staff_id) i WHERE i.assignment_id=sa.id)$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Witness assignment integration anchor changed'; END IF;EXECUTE replace(src,needle,replacement);
 SELECT pg_get_functiondef('public.home_cover_shift(uuid,uuid,uuid)'::regprocedure) INTO src;
 needle:=$text$  IF EXISTS (SELECT 1 FROM public.shift_assignments x WHERE x.staff_id = p_staff_id AND x.shift_date = v_gap.shift_date
             AND x.shift_type = v_gap.shift_type AND x.deleted_at IS NULL AND x.status NOT IN ('called_out', 'no_show')) THEN$text$;
 replacement:=$text$  IF EXISTS (SELECT 1 FROM public.shift_assignments x JOIN public.schedules sw ON sw.id=x.schedule_id AND sw.deleted_at IS NULL AND sw.status<>'archived' WHERE x.staff_id=p_staff_id AND x.deleted_at IS NULL AND x.status NOT IN('called_out','no_show')
   AND tsrange(x.shift_date+x.custom_start_time,x.shift_date+CASE WHEN x.custom_end_time<x.custom_start_time THEN 1 ELSE 0 END+x.custom_end_time,'[)') && tsrange(v_gap.shift_date+v_gap.custom_start_time,v_gap.shift_date+CASE WHEN v_gap.custom_end_time<v_gap.custom_start_time THEN 1 ELSE 0 END+v_gap.custom_end_time,'[)')) THEN$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Callout overlap integration anchor changed'; END IF;src:=replace(src,needle,replacement);
 src:=replace(src,'created_by, updated_by)'||chr(10)||'  VALUES (p_id,','schedule_preset_id,schedule_preset_name,schedule_preset_color,schedule_preset_version,schedule_role_snapshot,schedule_time_zone,schedule_group_id,schedule_block_index,schedule_block_count,created_by, updated_by)'||chr(10)||'  VALUES (p_id,');
 src:=replace(src,'v_gap.id, a.actor_user_id, a.actor_user_id)','v_gap.id,v_gap.schedule_preset_id,v_gap.schedule_preset_name,v_gap.schedule_preset_color,v_gap.schedule_preset_version,(SELECT staff_role FROM public.staff WHERE id=p_staff_id),v_gap.schedule_time_zone,CASE WHEN v_gap.schedule_group_id IS NOT NULL THEN gen_random_uuid() END,CASE WHEN v_gap.schedule_group_id IS NOT NULL THEN 0 END,CASE WHEN v_gap.schedule_group_id IS NOT NULL THEN 1 END,a.actor_user_id,a.actor_user_id)');EXECUTE src;
 SELECT pg_get_functiondef('public.home_on_tap(uuid,timestamptz)'::regprocedure) INTO src;
 needle:='sa.facility_id = p_facility_id AND sa.shift_date = v_local_date AND sa.deleted_at IS NULL';
 replacement:='sa.facility_id = p_facility_id AND sa.deleted_at IS NULL AND EXISTS(SELECT 1 FROM public.schedule_assignment_intervals(p_facility_id,p_as_of,p_as_of+interval ''1 microsecond'',sa.staff_id) i WHERE i.assignment_id=sa.id)';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Home operator work integration anchor changed'; END IF;EXECUTE replace(src,needle,replacement);
 SELECT pg_get_functiondef('public.home_shifts_today(uuid,timestamptz)'::regprocedure) INTO src;
 needle:=$text$'customStart', sa.custom_start_time, 'customEnd', sa.custom_end_time,$text$;
 replacement:=needle||$text$
          'presetName',sa.schedule_preset_name,'presetColor',sa.schedule_preset_color,'groupId',sa.schedule_group_id,'blockIndex',sa.schedule_block_index,'blockCount',sa.schedule_block_count,'startsAt',sa.schedule_starts_at,'endsAt',sa.schedule_ends_at,'timeZone',sa.schedule_time_zone,$text$;
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Home coverage snapshot integration anchor changed'; END IF;src:=replace(src,needle,replacement);
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
 SELECT count(*),min(s.id::text)::uuid INTO counts,staff_user FROM public.staff s WHERE s.user_id=auth.uid() AND s.facility_id=NEW.facility_id AND s.organization_id=NEW.organization_id AND s.employment_status='active' AND s.deleted_at IS NULL;
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
COMMIT;
