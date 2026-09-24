-- COL-804: preserve 514's history while restoring the configurable, role-aware
-- writers installed by513. Cached514 clients retain their explicit time values;
-- legacy unnamed pairs are never guessed to be managed groups.
BEGIN;
DO $$ BEGIN IF to_regclass('public.facility_schedule_presets') IS NULL OR to_regprocedure('haven.schedule_cell_intact(uuid,uuid,date)') IS NULL THEN RAISE EXCEPTION 'Configurable schedule foundation513 required'; END IF;END $$;
CREATE FUNCTION haven.schedule_custom_blocks_valid(p_blocks jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b jsonb; starts numeric; ends numeric; previous_end numeric:=-1;
BEGIN
 IF p_blocks IS NULL OR jsonb_typeof(p_blocks)<>'array' OR jsonb_array_length(p_blocks) NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  IF jsonb_typeof(b)<>'object' OR NOT b ?& ARRAY['start','end'] OR (SELECT count(*) FROM jsonb_object_keys(b))<>2
   OR coalesce(b->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' OR coalesce(b->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' THEN RETURN false; END IF;
  starts:=extract(epoch FROM (b->>'start')::time);ends:=extract(epoch FROM (b->>'end')::time);
  IF starts=ends OR starts<previous_end THEN RETURN false; END IF;
  IF ends<starts THEN ends:=ends+86400; END IF;previous_end:=ends;
 END LOOP;RETURN true;
END $$;
REVOKE ALL ON FUNCTION haven.schedule_custom_blocks_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.schedule_custom_blocks_valid(jsonb) TO authenticated;
CREATE FUNCTION haven.normalize_schedule_cells(p_cells jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE c jsonb; b jsonb; original jsonb; normalized jsonb; result jsonb:='[]'; legacy boolean; previous_end time;
BEGIN
 IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Provide cell changes as an array'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_cells) LOOP
  IF jsonb_typeof(c)<>'object' THEN RAISE EXCEPTION 'Each cell must be an object'; END IF;
  original:=c->'custom_blocks';
  IF original IS NULL OR jsonb_typeof(original)='null' THEN result:=result||jsonb_build_array(c-'custom_blocks');CONTINUE; END IF;
  IF jsonb_typeof(original)<>'array' THEN RAISE EXCEPTION 'Split shifts require exactly two time blocks in legacy format, or an ordered custom block array'; END IF;
  legacy:=coalesce(original->0 ?| ARRAY['start_time','end_time'],false);
  IF legacy THEN
   IF jsonb_array_length(original)<>2 THEN RAISE EXCEPTION 'Split shifts require exactly two time blocks'; END IF;
   IF c->>'preset_id' IS NOT NULL OR c->>'shift_definition_id' IS NOT NULL OR c->>'custom_start_time' IS NOT NULL OR c->>'custom_end_time' IS NOT NULL THEN RAISE EXCEPTION 'Choose a facility shift, custom times or a split shift, not more than one'; END IF;
   FOR b IN SELECT value FROM jsonb_array_elements(original) LOOP
    IF jsonb_typeof(b)<>'object' OR NOT b ?& ARRAY['start_time','end_time'] OR (SELECT count(*) FROM jsonb_object_keys(b))<>2 OR coalesce(b->>'start_time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' OR coalesce(b->>'end_time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' THEN RAISE EXCEPTION 'Split shifts require valid start and finish times, without mixed or extra fields'; END IF;
    IF (b->>'end_time')::time<=(b->>'start_time')::time THEN RAISE EXCEPTION 'Each legacy split block must finish after it starts on the same day'; END IF;
   END LOOP;
   SELECT jsonb_agg(jsonb_build_object('start',value->>'start_time','end',value->>'end_time') ORDER BY (value->>'start_time')::time) INTO normalized FROM jsonb_array_elements(original);
   IF NOT haven.schedule_custom_blocks_valid(normalized) THEN RAISE EXCEPTION 'An employee has overlapping shifts. Review adjacent days before saving.'; END IF;
   c:=jsonb_set(c,'{custom_blocks}',normalized);
  ELSE
   IF NOT haven.schedule_custom_blocks_valid(original) THEN RAISE EXCEPTION 'Custom blocks require ordered nonoverlapping start and finish times'; END IF;
  END IF;
  result:=result||jsonb_build_array(c);
 END LOOP;RETURN result;
END $$;
REVOKE ALL ON FUNCTION haven.normalize_schedule_cells(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION haven.normalize_schedule_cells(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.schedule_bulk_upsert(p_schedule_id uuid,p_expected_updated_at timestamptz,p_cells jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules; c record; p public.facility_schedule_presets; d public.facility_shift_definitions; s public.staff; b jsonb; blocks jsonb; plan jsonb:='[]'; entry jsonb; originals jsonb; group_key uuid; index_no integer; existing_id uuid; prior jsonb; classification public.shift_type; tz text; effective_role public.staff_role; block_last_date date;
BEGIN
 IF auth.uid() IS NULL OR haven.app_role() NOT IN('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
 SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
 IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before saving.'; END IF;
 IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Provide 1 to 1000 cell changes'; END IF;
 p_cells:=haven.normalize_schedule_cells(p_cells);
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
   IF c.shift_definition_id IS NOT NULL OR c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL OR NOT haven.schedule_custom_blocks_valid(c.custom_blocks) THEN RAISE EXCEPTION 'Custom blocks require ordered nonoverlapping start and finish times'; END IF;
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

-- Public readers retain caller RLS. Trusted clinical writers need the same
-- interval facts for all eligible staff after their own authority checks.
CREATE FUNCTION haven.schedule_assignment_intervals(p_facility_id uuid,p_from timestamptz,p_to timestamptz,p_staff_id uuid DEFAULT NULL)
RETURNS TABLE(assignment_id uuid,schedule_id uuid,staff_id uuid,facility_id uuid,service_date date,starts_at timestamptz,ends_at timestamptz,time_zone text,preset_id uuid,preset_version integer,label text,color text,staff_role public.staff_role,group_id uuid,block_index integer,block_count integer,legacy_shift_type public.shift_type,status public.shift_assignment_status,is_legacy boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id,a.schedule_id,a.staff_id,a.facility_id,a.shift_date,t.starts_at,t.ends_at,t.tz,a.schedule_preset_id,a.schedule_preset_version,
 coalesce(a.schedule_preset_name,CASE WHEN a.shift_type='custom' THEN 'Custom' ELSE initcap(a.shift_type::text) END),coalesce(a.schedule_preset_color,'#64748B'),coalesce(a.schedule_role_snapshot,haven.schedule_staff_role_internal(a.staff_id,a.facility_id,a.shift_date,a.shift_date)),a.schedule_group_id,a.schedule_block_index,a.schedule_block_count,a.shift_type,a.status,a.schedule_starts_at IS NULL
 FROM public.shift_assignments a JOIN public.schedules w ON w.id=a.schedule_id AND w.status='published' AND w.deleted_at IS NULL
 JOIN public.facilities f ON f.id=a.facility_id AND f.organization_id=a.organization_id AND f.deleted_at IS NULL
 CROSS JOIN LATERAL(SELECT coalesce(a.schedule_time_zone,f.timezone) tz) z
 CROSS JOIN LATERAL(SELECT coalesce(a.schedule_starts_at,(a.shift_date+a.custom_start_time) AT TIME ZONE z.tz) starts_at,coalesce(a.schedule_ends_at,(a.shift_date+CASE WHEN a.custom_end_time<a.custom_start_time THEN 1 ELSE 0 END+a.custom_end_time) AT TIME ZONE z.tz) ends_at,z.tz) t
 WHERE a.facility_id=p_facility_id AND (p_staff_id IS NULL OR a.staff_id=p_staff_id) AND a.deleted_at IS NULL AND a.status IN('assigned','confirmed') AND p_to>p_from AND t.starts_at<p_to AND t.ends_at>p_from AND t.ends_at>t.starts_at AND haven.schedule_staff_role_internal(a.staff_id,a.facility_id,a.shift_date,((t.ends_at-interval '1 microsecond') AT TIME ZONE t.tz)::date) IS NOT NULL
 ORDER BY t.starts_at,a.staff_id,a.id;
$$;
REVOKE ALL ON FUNCTION haven.schedule_assignment_intervals(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION haven.schedule_assignment_intervals(uuid,timestamptz,timestamptz,uuid) IS 'Private clinical projection after an outer service/device/actor command has established facility authority. Same saved work interval math as the public invoker reader, with internal membership resolution so an ambient employee JWT cannot hide other eligible clinical staff. No request role can execute this function; public schedule interval RLS and own-staff privacy remain unchanged.';
DO $$ DECLARE src text; BEGIN
 SELECT pg_get_functiondef('haven.resolve_observation_instant(uuid,timestamptz,uuid[],timestamptz)'::regprocedure) INTO src;
 IF position('public.schedule_assignment_intervals(' IN src)=0 THEN RAISE EXCEPTION 'Clinical interval reader anchor changed'; END IF;
 src:=replace(src,'public.schedule_assignment_intervals(','haven.schedule_assignment_intervals(');
 EXECUTE replace(src,'haven.schedule_staff_role(','haven.schedule_staff_role_internal(');
 SELECT pg_get_functiondef('haven.observation_on_clock_staff(uuid,timestamptz)'::regprocedure) INTO src;
 EXECUTE replace(src,'haven.schedule_staff_role(','haven.schedule_staff_role_internal(');
 SELECT pg_get_functiondef('haven.med_tech_shift_open_from_clock(uuid,uuid,timestamptz,uuid,text,uuid,uuid)'::regprocedure) INTO src;
 src:=replace(src,'public.schedule_assignment_intervals(','haven.schedule_assignment_intervals(');
 EXECUTE replace(src,'haven.schedule_staff_role(','haven.schedule_staff_role_internal(');
 SELECT pg_get_functiondef('public.floor_replay_complete_rounding_task(text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure) INTO src;
 EXECUTE replace(src,'haven.schedule_staff_role(','haven.schedule_staff_role_internal(');
END $$;

-- Monitoring Orders keep their own frequency/grace. Only owner lookup changes
-- to the actual task due instant, rather than a single clinical-window owner.
DO $$ DECLARE src text; needle text; BEGIN
 SELECT pg_get_functiondef('public.generate_monitoring_order_tasks(uuid,timestamptz)'::regprocedure) INTO src;
 needle:='public.resolve_observation_task_assignees(v_task.facility_id,v_shift.shift_service_date,v_shift.roster_shift_type::text,ARRAY[v_task.resident_id])';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Monitoring-order ownership anchor changed'; END IF;
 EXECUTE replace(src,needle,'public.resolve_observation_task_assignees_for_instant(v_task.facility_id,v_task.due_at,ARRAY[v_task.resident_id])');
 SELECT pg_get_functiondef('public.reinstate_standard_observation_windows(uuid,timestamptz)'::regprocedure) INTO src;
 needle:='LEFT JOIN public.resolve_observation_task_assignees (v_resident.facility_id, v_shift.shift_service_date, v_shift.roster_shift_type::text, ARRAY[p_resident_id])';
 IF position(needle IN src)=0 THEN RAISE EXCEPTION 'Reinstated cadence ownership anchor changed'; END IF;
 EXECUTE replace(src,needle,'LEFT JOIN LATERAL public.resolve_observation_task_assignees_for_instant(v_resident.facility_id,rw.due_at_utc,ARRAY[p_resident_id])');

END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
