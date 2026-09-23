-- COL-715: Workforce schedule and time-record integrity.
-- Predecessors 483-486 are owned by other PRs; do not bypass the sequence gate.

-- Workforce: legacy staff punches must never confer payroll approval authority.
-- Integrate this fragment into a migration after 478. The separate floor-kiosk
-- cutover adds RESTRICTIVE policies; keep those policies and their ownership.

ALTER POLICY staff_see_own_time_records ON public.time_records TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id()) AND deleted_at IS NULL
    AND (
      staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL)
      OR ((SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
        AND facility_id IN (SELECT haven.accessible_facility_ids()))
    )
  );

ALTER POLICY staff_clock_in_out ON public.time_records TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL AND clock_out IS NULL
    AND NOT approved AND approved_by IS NULL AND approved_at IS NULL
    AND regular_hours IS NULL AND overtime_hours IS NULL
    AND staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL)
  );

ALTER POLICY staff_update_own_open_time_records ON public.time_records TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL AND clock_out IS NULL AND NOT approved
    AND approved_by IS NULL AND approved_at IS NULL
    AND staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL)
  )
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND deleted_at IS NULL AND clock_out IS NOT NULL AND NOT approved
    AND approved_by IS NULL AND approved_at IS NULL
    AND regular_hours IS NULL AND overtime_hours IS NULL
    AND staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL)
  );

CREATE POLICY workforce_payroll_admins_update_time_records ON public.time_records
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id()) AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
  )
  WITH CHECK (
    organization_id = (SELECT haven.organization_id()) AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
  );

CREATE OR REPLACE FUNCTION public.haven_guard_legacy_time_record_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  payroll_admin boolean := coalesce(haven.app_role() IN ('owner', 'org_admin', 'facility_admin'), false);
  employee record;
BEGIN
  -- Trusted maintenance and existing definer paths retain their own contracts.
  -- API request roles must pass both RLS and these column-level constraints.
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF actor IS NULL OR NEW.organization_id IS DISTINCT FROM haven.organization_id()
    OR NOT EXISTS (SELECT 1 FROM haven.accessible_facility_ids() f WHERE f = NEW.facility_id) THEN
    RAISE EXCEPTION 'Time record staff and facility scope is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT s.organization_id, s.facility_id, s.user_id INTO employee
    FROM public.staff s WHERE s.id = NEW.staff_id AND s.deleted_at IS NULL;
  IF NOT FOUND OR employee.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Time record staff and facility scope is not authorized' USING ERRCODE = '42501';
  END IF;
  IF employee.facility_id IS DISTINCT FROM NEW.facility_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.staff_facility_assignments a
      WHERE a.staff_id = NEW.staff_id AND a.organization_id = NEW.organization_id
        AND a.facility_id = NEW.facility_id AND a.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Time record staff and facility scope is not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF payroll_admin THEN RETURN NEW; END IF;
  IF employee.user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Staff may only clock their own time' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.approved OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
      OR NEW.clock_out IS NOT NULL OR NEW.clock_out_method IS NOT NULL
      OR NEW.clock_out_latitude IS NOT NULL OR NEW.clock_out_longitude IS NOT NULL
      OR NEW.actual_hours IS NOT NULL OR NEW.regular_hours IS NOT NULL OR NEW.overtime_hours IS NOT NULL
      OR NEW.scheduled_hours IS NOT NULL OR coalesce(NEW.break_minutes, 0) <> 0
      OR NEW.shift_assignment_id IS NOT NULL OR NEW.deleted_at IS NOT NULL
      OR NEW.payroll_source_revision <> 1
      OR (NEW.created_by IS NOT NULL AND NEW.created_by <> actor)
      OR (NEW.updated_by IS NOT NULL AND NEW.updated_by <> actor) THEN
      RAISE EXCEPTION 'Staff may only create an unapproved open time record' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := actor;
    NEW.created_at := clock_timestamp();
  ELSE
    IF OLD.clock_out IS NOT NULL OR OLD.approved OR OLD.approved_by IS NOT NULL OR OLD.approved_at IS NOT NULL
      OR NEW.clock_out IS NULL
      OR (NEW.updated_by IS NOT NULL AND NEW.updated_by <> actor)
      OR (to_jsonb(NEW) - ARRAY['clock_out', 'clock_out_method', 'clock_out_latitude', 'clock_out_longitude', 'updated_by', 'updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['clock_out', 'clock_out_method', 'clock_out_latitude', 'clock_out_longitude', 'updated_by', 'updated_at']) THEN
      RAISE EXCEPTION 'Staff may only close their own unapproved open time record' USING ERRCODE = '42501';
    END IF;
    NEW.updated_by := actor;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.haven_guard_legacy_time_record_write() FROM PUBLIC, anon, authenticated;
-- Run before calculate_worked_hours and zz_payroll_source_revision: caller-supplied
-- pay fields cannot hide behind those triggers overwriting them during clock-out.
CREATE TRIGGER a_workforce_time_record_write_guard
  BEFORE INSERT OR UPDATE ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION public.haven_guard_legacy_time_record_write();

-- Operational manager reads only. This does not grant corrections, credential
-- management, legacy payroll approval, payroll batches, or payroll exports.
CREATE POLICY workforce_managers_read_punches ON public.time_punches
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) = 'manager');
CREATE POLICY workforce_managers_read_corrections ON public.time_punch_corrections
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) = 'manager');
CREATE POLICY workforce_managers_read_sync_rejections ON public.timeclock_sync_rejections
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) = 'manager');
CREATE POLICY workforce_managers_read_facility_settings ON public.timeclock_facility_settings
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND (SELECT haven.app_role()) = 'manager');
CREATE POLICY workforce_managers_read_period_settings ON public.timeclock_organization_settings
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) = 'manager');

-- Schedule lane: integrate into the next owned numbered migration.
-- Actual shift times are stamped on assignments; configuration changes never rewrite a published week.
ALTER TABLE public.shift_assignments ADD COLUMN IF NOT EXISTS shift_definition_id uuid REFERENCES public.facility_shift_definitions(id);

ALTER POLICY admin_nurse_manage_schedules ON public.schedules
  USING (organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager'))
  WITH CHECK (organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager'));
ALTER POLICY staff_see_published_schedules ON public.schedules
  USING (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (status='published' OR (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager')));
ALTER POLICY admin_nurse_manage_shift_assignments ON public.shift_assignments
  USING (organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager'))
  WITH CHECK (organization_id=(SELECT haven.organization_id()) AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager'));
ALTER POLICY staff_see_shift_assignments ON public.shift_assignments
  USING (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (
    (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager') OR (
      staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM public.schedules w WHERE w.id=shift_assignments.schedule_id AND w.status='published' AND w.deleted_at IS NULL)
    )
  ));
CREATE POLICY workforce_manager_read_staff ON public.staff FOR SELECT TO authenticated
  USING (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role())::text='manager');

-- Optimistic versions advance for every mutation, even within one transaction or after lock waits.
CREATE OR REPLACE FUNCTION haven.schedule_updated_at() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  NEW.updated_by:=auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.schedule_updated_at() FROM PUBLIC,anon,authenticated;
DROP TRIGGER tr_schedules_set_updated_at ON public.schedules;
CREATE TRIGGER tr_schedules_set_updated_at BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION haven.schedule_updated_at();

-- Legacy edits and swap operations must also invalidate an open grid's version.
CREATE OR REPLACE FUNCTION haven.touch_assignment_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  UPDATE public.schedules SET updated_by=auth.uid() WHERE id=COALESCE(NEW.schedule_id,OLD.schedule_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule update was not applied'; END IF;
  IF TG_OP<>'DELETE' AND NEW.deleted_at IS NULL AND NEW.status::text NOT IN ('called_out','no_show') THEN
    IF EXISTS (
      SELECT 1 FROM public.shift_assignments b JOIN public.schedules bw ON bw.id=b.schedule_id AND bw.deleted_at IS NULL AND bw.status<>'archived'
      WHERE b.staff_id=NEW.staff_id AND b.id<>NEW.id AND b.organization_id=NEW.organization_id AND b.deleted_at IS NULL AND b.status::text NOT IN ('called_out','no_show')
      AND b.custom_start_time IS NOT NULL AND b.custom_end_time IS NOT NULL AND NEW.custom_start_time IS NOT NULL AND NEW.custom_end_time IS NOT NULL
      AND tsrange(NEW.shift_date+NEW.custom_start_time,NEW.shift_date+NEW.custom_end_time+CASE WHEN NEW.custom_end_time<=NEW.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
        && tsrange(b.shift_date+b.custom_start_time,b.shift_date+b.custom_end_time+CASE WHEN b.custom_end_time<=b.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
    ) THEN RAISE EXCEPTION 'An employee has overlapping shifts. Review adjacent days before saving.'; END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION haven.touch_assignment_schedule() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_touch_assignment_schedule AFTER INSERT OR UPDATE OR DELETE ON public.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION haven.touch_assignment_schedule();

CREATE OR REPLACE FUNCTION public.schedule_bulk_upsert(p_schedule_id uuid,p_expected_updated_at timestamptz,p_cells jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  w public.schedules%ROWTYPE;
  d public.facility_shift_definitions%ROWTYPE;
  c record;
  assignment_id uuid;
BEGIN
  IF auth.uid() IS NULL OR haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
  SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
  IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before saving.'; END IF;
  IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Provide 1 to 1000 cell changes'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid) GROUP BY staff_id,shift_date HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate employee/date cells'; END IF;

  -- Serialize staff mutations across schedule weeks in consistent order.
  PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (SELECT x.staff_id FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid)) ORDER BY s.id;
  FOR c IN SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid) ORDER BY staff_id,shift_date LOOP
    IF c.shift_date IS NULL OR c.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6 THEN RAISE EXCEPTION 'Shift date must be inside this schedule week'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id=c.staff_id AND s.facility_id=w.facility_id AND s.organization_id=w.organization_id AND s.deleted_at IS NULL AND s.employment_status='active') THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
    IF (SELECT count(*) FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=c.staff_id AND a.shift_date=c.shift_date AND a.deleted_at IS NULL)>1 THEN RAISE EXCEPTION 'Multiple assignments in this cell. Review assignment details first.'; END IF;
    IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=c.staff_id AND a.shift_date=c.shift_date AND a.deleted_at IS NULL AND a.status::text NOT IN ('assigned','confirmed')) THEN RAISE EXCEPTION 'Resolve the assignment status before replacing this cell'; END IF;
    UPDATE public.shift_assignments SET deleted_at=now(),updated_by=auth.uid()
      WHERE schedule_id=w.id AND staff_id=c.staff_id AND shift_date=c.shift_date AND deleted_at IS NULL;
  END LOOP;
  FOR c IN SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid) ORDER BY staff_id,shift_date LOOP
    IF c.shift_definition_id IS NOT NULL THEN
      SELECT * INTO d FROM public.facility_shift_definitions WHERE id=c.shift_definition_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL;
      IF NOT FOUND OR d.starts_at_local=d.ends_at_local THEN RAISE EXCEPTION 'Active facility shift definition with distinct times required'; END IF;
      assignment_id:=gen_random_uuid();
      PERFORM public.edit_draft_schedule(w.id,'add',assignment_id,c.staff_id,c.shift_date,d.starts_at_local,d.ends_at_local);
      UPDATE public.shift_assignments SET shift_type=d.roster_shift_type,shift_definition_id=d.id WHERE id=assignment_id;
    END IF;
  END LOOP;
  -- Evaluate after all cells so moving an overnight shift is independent of input order.
  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a JOIN public.shift_assignments b ON a.staff_id=b.staff_id AND a.id<>b.id AND a.organization_id=b.organization_id
    JOIN public.schedules bw ON bw.id=b.schedule_id AND bw.deleted_at IS NULL AND bw.status<>'archived'
    WHERE a.schedule_id=w.id AND a.deleted_at IS NULL AND b.deleted_at IS NULL
      AND a.status::text NOT IN ('called_out','no_show') AND b.status::text NOT IN ('called_out','no_show')
      AND a.custom_start_time IS NOT NULL AND a.custom_end_time IS NOT NULL AND b.custom_start_time IS NOT NULL AND b.custom_end_time IS NOT NULL
      AND tsrange(a.shift_date+a.custom_start_time,a.shift_date+a.custom_end_time+CASE WHEN a.custom_end_time<=a.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
        && tsrange(b.shift_date+b.custom_start_time,b.shift_date+b.custom_end_time+CASE WHEN b.custom_end_time<=b.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
  ) THEN RAISE EXCEPTION 'An employee has overlapping shifts. Review adjacent days before saving.'; END IF;
  UPDATE public.schedules SET updated_by=auth.uid() WHERE id=w.id;
  RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_bulk_upsert(uuid,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_bulk_upsert(uuid,timestamptz,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_copy_week(p_schedule_id uuid,p_expected_updated_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules%ROWTYPE; source_week public.schedules%ROWTYPE; cells jsonb;
BEGIN
  IF auth.uid() IS NULL OR haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
  SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
  IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before copying.'; END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Copy last week requires an empty draft'; END IF;
  SELECT * INTO source_week FROM public.schedules WHERE facility_id=w.facility_id AND organization_id=w.organization_id AND week_start_date=w.week_start_date-7 AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No schedule exists for the previous week'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time)
  ) THEN RAISE EXCEPTION 'Previous week contains shifts without a matching active definition. Plan those shifts explicitly.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('staff_id',a.staff_id,'shift_date',a.shift_date+7,'shift_definition_id',d.id) ORDER BY a.staff_id,a.shift_date)
    INTO cells FROM public.shift_assignments a CROSS JOIN LATERAL (
      SELECT d.id FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time ORDER BY (d.id=a.shift_definition_id) DESC,d.id LIMIT 1
    ) d WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL;
  IF cells IS NULL THEN RAISE EXCEPTION 'Previous week has no assignments to copy'; END IF;
  RETURN public.schedule_bulk_upsert(w.id,p_expected_updated_at,cells);
END $$;
REVOKE ALL ON FUNCTION public.schedule_copy_week(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_copy_week(uuid,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_publish(p_schedule_id uuid,p_expected_updated_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
  SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
  IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before publishing.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Add at least one shift before publishing'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (SELECT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.deleted_at IS NULL) ORDER BY s.id;
  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a LEFT JOIN public.staff s ON s.id=a.staff_id
    WHERE a.schedule_id=w.id AND a.deleted_at IS NULL AND (
      a.facility_id<>w.facility_id OR a.organization_id<>w.organization_id OR a.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6
      OR a.custom_start_time IS NULL OR a.custom_end_time IS NULL OR a.custom_start_time=a.custom_end_time
      OR s.id IS NULL OR s.deleted_at IS NOT NULL OR s.employment_status<>'active' OR s.facility_id<>w.facility_id OR s.organization_id<>w.organization_id
      OR a.status::text NOT IN ('assigned','confirmed')
    )
  ) THEN RAISE EXCEPTION 'Review assignments: active staff, dates, recorded times and assignment status are required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a JOIN public.shift_assignments b ON a.staff_id=b.staff_id AND a.id<>b.id AND a.organization_id=b.organization_id
    JOIN public.schedules bw ON bw.id=b.schedule_id AND bw.deleted_at IS NULL AND bw.status<>'archived'
    WHERE a.schedule_id=w.id AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND b.status::text NOT IN ('called_out','no_show')
      AND b.custom_start_time IS NOT NULL AND b.custom_end_time IS NOT NULL
      AND tsrange(a.shift_date+a.custom_start_time,a.shift_date+a.custom_end_time+CASE WHEN a.custom_end_time<=a.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
        && tsrange(b.shift_date+b.custom_start_time,b.shift_date+b.custom_end_time+CASE WHEN b.custom_end_time<=b.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
  ) THEN RAISE EXCEPTION 'An employee has overlapping shifts. Resolve them before publishing.'; END IF;
  UPDATE public.schedules SET status='published',published_at=clock_timestamp(),published_by=auth.uid(),updated_by=auth.uid() WHERE id=w.id;
  RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_publish(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_publish(uuid,timestamptz) TO authenticated;
COMMENT ON FUNCTION public.schedule_publish(uuid,timestamptz) IS 'Publishes a reviewed schedule to staff My schedule. Does not certify minimum staffing or credentials and does not send external notifications.';


-- Swap approval must share schedule authority. Participants retain their own request/confirmation visibility.
CREATE POLICY workforce_manager_read_schedule_credentials ON public.staff_certifications FOR SELECT TO authenticated
  USING (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (SELECT haven.app_role())::text='manager');
ALTER POLICY staff_see_shift_swap_requests ON public.shift_swap_requests USING (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (
    (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager')
    OR requesting_staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
    OR covering_staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
  ));
ALTER POLICY staff_update_shift_swap_requests ON public.shift_swap_requests USING (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (
    (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager')
    OR requesting_staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
    OR covering_staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
  )) WITH CHECK (organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL AND facility_id IN (SELECT haven.accessible_facility_ids()) AND (
    (SELECT haven.app_role())::text IN ('owner','org_admin','facility_admin','manager')
    OR requesting_staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
    OR covering_staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id=(SELECT auth.uid()) AND s.deleted_at IS NULL)
  ));

CREATE OR REPLACE FUNCTION public.haven_apply_approved_shift_swap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_request public.shift_assignments%ROWTYPE; v_cover public.shift_assignments%ROWTYPE; v_role text; v_cover_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NEW.status::text IN ('approved','denied') AND haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Scheduling manager approval required'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='approved' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved coverage is immutable'; END IF;
  IF TG_OP='INSERT' THEN
    NEW.requesting_confirmed_at:=NULL; NEW.covering_confirmed_at:=NULL;
    IF NEW.status='approved' THEN RAISE EXCEPTION 'Participants must confirm before manager approval'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.requesting_staff_id IS DISTINCT FROM OLD.requesting_staff_id OR NEW.covering_staff_id IS DISTINCT FROM OLD.covering_staff_id OR NEW.requesting_assignment_id IS DISTINCT FROM OLD.requesting_assignment_id OR NEW.covering_assignment_id IS DISTINCT FROM OLD.covering_assignment_id THEN
    IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved coverage is immutable'; END IF;
    NEW.requesting_confirmed_at:=NULL; NEW.covering_confirmed_at:=NULL;
  ELSE
    IF NEW.requesting_confirmed_at IS DISTINCT FROM OLD.requesting_confirmed_at THEN
      IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW.requesting_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Only the requesting employee may confirm'; END IF;
      NEW.requesting_confirmed_at:=now();
    END IF;
    IF NEW.covering_confirmed_at IS DISTINCT FROM OLD.covering_confirmed_at THEN
      IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW.covering_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Only the covering employee may confirm'; END IF;
      NEW.covering_confirmed_at:=now();
    END IF;
  END IF;
  IF NEW.eligibility_reviewed_at IS DISTINCT FROM OLD.eligibility_reviewed_at OR NEW.eligibility_reviewed_by IS DISTINCT FROM OLD.eligibility_reviewed_by THEN
    IF haven.app_role() NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Scheduling manager review required'; END IF;
    NEW.eligibility_reviewed_at:=clock_timestamp(); NEW.eligibility_reviewed_by:=auth.uid();
  END IF;
  IF NEW.status='approved' AND OLD.status<>'approved' THEN
    IF haven.app_role() NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Scheduling manager approval required'; END IF;
    IF NEW.eligibility_reviewed_by IS DISTINCT FROM auth.uid() OR NEW.eligibility_reviewed_at IS NULL OR NEW.eligibility_reviewed_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Review required credentials, weekly hours and rest before applying coverage'; END IF;
    IF NEW.requesting_confirmed_at IS NULL OR NEW.covering_confirmed_at IS NULL OR NEW.covering_staff_id IS NULL OR NEW.covering_staff_id=NEW.requesting_staff_id THEN RAISE EXCEPTION 'Both distinct employees must confirm the proposed coverage'; END IF;
    -- Every schedule writer locks parent schedules, then participant staff, then assignment rows.
    PERFORM w.id FROM public.schedules w WHERE w.id IN (SELECT a.schedule_id FROM public.shift_assignments a WHERE a.id IN (NEW.requesting_assignment_id,NEW.covering_assignment_id)) ORDER BY w.id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (NEW.requesting_staff_id,NEW.covering_staff_id) ORDER BY s.id;
    -- Lock all involved assignments deterministically, then check the current ownership.
    PERFORM 1 FROM public.shift_assignments WHERE id IN (NEW.requesting_assignment_id,NEW.covering_assignment_id) ORDER BY id FOR UPDATE;
    SELECT * INTO v_request FROM public.shift_assignments WHERE id=NEW.requesting_assignment_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_request.staff_id<>NEW.requesting_staff_id OR v_request.facility_id<>NEW.facility_id OR v_request.organization_id<>NEW.organization_id THEN RAISE EXCEPTION 'Requesting assignment changed or is unavailable'; END IF;
    SELECT staff_role::text INTO v_role FROM public.staff WHERE id=NEW.requesting_staff_id AND deleted_at IS NULL AND employment_status='active';
    SELECT staff_role::text INTO v_cover_role FROM public.staff WHERE id=NEW.covering_staff_id AND deleted_at IS NULL AND employment_status='active' AND facility_id=NEW.facility_id;
    IF v_role IS NULL OR v_cover_role IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'Coverage requires an active employee with the same staffing role'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL AND (status::text IN ('expired','revoked') OR expiration_date<v_request.shift_date)) THEN RAISE EXCEPTION 'Review missing or expired covering employee credentials'; END IF;
    IF NEW.covering_assignment_id IS NOT NULL THEN
      SELECT * INTO v_cover FROM public.shift_assignments WHERE id=NEW.covering_assignment_id AND deleted_at IS NULL;
      IF NOT FOUND OR v_cover.staff_id<>NEW.covering_staff_id OR v_cover.facility_id<>NEW.facility_id OR v_cover.organization_id<>NEW.organization_id THEN RAISE EXCEPTION 'Covering assignment changed or is unavailable'; END IF;
      IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE staff_id=NEW.requesting_staff_id AND deleted_at IS NULL AND status::text NOT IN ('cancelled','no_show') AND id NOT IN(NEW.requesting_assignment_id,NEW.covering_assignment_id) AND shift_date BETWEEN v_cover.shift_date-1 AND v_cover.shift_date+1) THEN RAISE EXCEPTION 'Requesting employee has adjacent assignments; review rest and overlap before coverage'; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL AND status::text NOT IN ('cancelled','no_show') AND id<>NEW.requesting_assignment_id AND id IS DISTINCT FROM NEW.covering_assignment_id AND shift_date BETWEEN v_request.shift_date-1 AND v_request.shift_date+1) THEN RAISE EXCEPTION 'Covering employee has adjacent assignments; review rest and overlap before coverage'; END IF;
    NEW.approved_by:=auth.uid(); NEW.approved_at:=now(); NEW.denied_reason:=NULL;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION haven.apply_reviewed_shift_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE changed integer; expected integer;
BEGIN
  IF NEW.status='approved' AND OLD.status<>'approved' THEN
    expected:=CASE WHEN NEW.covering_assignment_id IS NULL THEN 1 ELSE 2 END;
    UPDATE public.shift_assignments
      SET staff_id=CASE WHEN id=NEW.requesting_assignment_id THEN NEW.covering_staff_id ELSE NEW.requesting_staff_id END,updated_by=auth.uid()
      WHERE (id=NEW.requesting_assignment_id AND staff_id=NEW.requesting_staff_id)
         OR (id=NEW.covering_assignment_id AND staff_id=NEW.covering_staff_id);
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>expected THEN RAISE EXCEPTION 'Requesting assignment update was not applied in full'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.apply_reviewed_shift_swap() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_apply_reviewed_shift_swap AFTER UPDATE ON public.shift_swap_requests
  FOR EACH ROW EXECUTE FUNCTION haven.apply_reviewed_shift_swap();

-- Table boundaries apply equally to direct Data API writes and legacy RPCs.
CREATE OR REPLACE FUNCTION haven.guard_schedule_row() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Published and archived schedules cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id=NEW.facility_id AND f.organization_id=NEW.organization_id AND f.deleted_at IS NULL) THEN RAISE EXCEPTION 'Schedule facility and organization must match'; END IF;
    IF NEW.status<>'draft' THEN RAISE EXCEPTION 'Create a draft before publishing a schedule'; END IF;
    NEW.published_at:=NULL; NEW.published_by:=NULL;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.week_start_date) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.week_start_date) THEN RAISE EXCEPTION 'Schedule identity, facility and week are immutable'; END IF;
  IF OLD.status<>'draft' THEN
    IF NEW.status='draft' OR (OLD.status='archived' AND NEW.status<>'archived') OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN RAISE EXCEPTION 'Published and archived schedules cannot return to draft or be removed'; END IF;
    IF (NEW.published_at,NEW.published_by) IS DISTINCT FROM (OLD.published_at,OLD.published_by) THEN RAISE EXCEPTION 'Publication evidence is immutable'; END IF;
  ELSIF NEW.status='published' THEN
    IF auth.uid() IS NULL OR haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
    IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'A removed schedule cannot be published'; END IF;
    w:=NEW;
    IF NOT EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Add at least one shift before publishing'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (SELECT a.staff_id FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.deleted_at IS NULL) ORDER BY s.id;
    IF EXISTS (
      SELECT 1 FROM public.shift_assignments a LEFT JOIN public.staff s ON s.id=a.staff_id
      WHERE a.schedule_id=w.id AND a.deleted_at IS NULL AND (
        a.facility_id<>w.facility_id OR a.organization_id<>w.organization_id OR a.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6
        OR a.custom_start_time IS NULL OR a.custom_end_time IS NULL OR a.custom_start_time=a.custom_end_time
        OR s.id IS NULL OR s.deleted_at IS NOT NULL OR s.employment_status<>'active' OR s.facility_id<>w.facility_id OR s.organization_id<>w.organization_id
        OR a.status::text NOT IN ('assigned','confirmed')
      )
    ) THEN RAISE EXCEPTION 'Review assignments: active staff, dates, recorded times and assignment status are required'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.shift_assignments a JOIN public.shift_assignments b ON a.staff_id=b.staff_id AND a.id<>b.id AND a.organization_id=b.organization_id
      JOIN public.schedules bw ON bw.id=b.schedule_id AND bw.deleted_at IS NULL AND bw.status<>'archived'
      WHERE a.schedule_id=w.id AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND b.status::text NOT IN ('called_out','no_show')
        AND b.custom_start_time IS NOT NULL AND b.custom_end_time IS NOT NULL
        AND tsrange(a.shift_date+a.custom_start_time,a.shift_date+a.custom_end_time+CASE WHEN a.custom_end_time<=a.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
          && tsrange(b.shift_date+b.custom_start_time,b.shift_date+b.custom_end_time+CASE WHEN b.custom_end_time<=b.custom_start_time THEN interval '1 day' ELSE interval '0 days' END,'[)')
    ) THEN RAISE EXCEPTION 'An employee has overlapping shifts. Resolve them before publishing.'; END IF;
    NEW.published_at:=clock_timestamp(); NEW.published_by:=auth.uid();
  ELSIF NEW.published_at IS NOT NULL OR NEW.published_by IS NOT NULL THEN
    RAISE EXCEPTION 'Publication evidence requires a published schedule';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_schedule_row() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_guard_schedule_row BEFORE INSERT OR UPDATE OR DELETE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION haven.guard_schedule_row();

CREATE OR REPLACE FUNCTION haven.guard_schedule_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.schedules%ROWTYPE; gap public.shift_assignments%ROWTYPE; planned_changed boolean; swap_authorized boolean:=false;
BEGIN
  SELECT * INTO w FROM public.schedules WHERE id=COALESCE(NEW.schedule_id,OLD.schedule_id) AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment schedule unavailable'; END IF;
  IF TG_OP='DELETE' THEN
    IF w.status<>'draft' THEN RAISE EXCEPTION 'Published and archived assignments cannot be deleted'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.staff_id::text,0));
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id=NEW.staff_id OR (TG_OP='UPDATE' AND s.id=OLD.staff_id) ORDER BY s.id;
  IF NEW.facility_id<>w.facility_id OR NEW.organization_id<>w.organization_id THEN RAISE EXCEPTION 'Assignment scope must match its schedule'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id=NEW.staff_id AND s.facility_id=w.facility_id AND s.organization_id=w.organization_id AND s.deleted_at IS NULL) THEN RAISE EXCEPTION 'Assignment employee must belong to the schedule facility'; END IF;
  IF NEW.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6 THEN RAISE EXCEPTION 'Shift date must be inside this schedule week'; END IF;
  IF NEW.shift_definition_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.shift_definition_id IS DISTINCT FROM OLD.shift_definition_id) AND NOT EXISTS (SELECT 1 FROM public.facility_shift_definitions d WHERE d.id=NEW.shift_definition_id AND d.facility_id=NEW.facility_id AND d.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Shift definition must belong to the schedule facility'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id,NEW.schedule_id,NEW.organization_id,NEW.facility_id) IS DISTINCT FROM (OLD.id,OLD.schedule_id,OLD.organization_id,OLD.facility_id) THEN RAISE EXCEPTION 'Assignment identity and scope are immutable'; END IF;
  planned_changed:=TG_OP='INSERT' OR (NEW.staff_id,NEW.shift_date,NEW.shift_type,NEW.custom_start_time,NEW.custom_end_time,NEW.unit_id,NEW.shift_definition_id,NEW.covers_assignment_id,NEW.shift_classification,NEW.deleted_at)
    IS DISTINCT FROM (OLD.staff_id,OLD.shift_date,OLD.shift_type,OLD.custom_start_time,OLD.custom_end_time,OLD.unit_id,OLD.shift_definition_id,OLD.covers_assignment_id,OLD.shift_classification,OLD.deleted_at);
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.staff_id IS DISTINCT FROM OLD.staff_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.staff WHERE id=NEW.staff_id AND employment_status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
  END IF;
  IF w.status<>'draft' AND planned_changed THEN
    IF TG_OP='INSERT' AND w.status='published' AND NEW.covers_assignment_id IS NOT NULL THEN
      SELECT * INTO gap FROM public.shift_assignments WHERE id=NEW.covers_assignment_id AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND OR gap.status::text NOT IN ('called_out','no_show') OR gap.staff_id=NEW.staff_id
        OR (NEW.schedule_id,NEW.facility_id,NEW.organization_id,NEW.shift_date,NEW.shift_type,NEW.custom_start_time,NEW.custom_end_time,NEW.unit_id)
          IS DISTINCT FROM (gap.schedule_id,gap.facility_id,gap.organization_id,gap.shift_date,gap.shift_type,gap.custom_start_time,gap.custom_end_time,gap.unit_id)
        OR NEW.deleted_at IS NOT NULL OR NEW.status::text NOT IN ('assigned','confirmed') THEN RAISE EXCEPTION 'Published replacement must exactly cover a called-out shift'; END IF;
      IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.covers_assignment_id=gap.id AND a.deleted_at IS NULL AND a.status::text NOT IN ('called_out','no_show')) THEN RAISE EXCEPTION 'This shift is already covered'; END IF;
    ELSIF TG_OP='UPDATE' AND w.status='published' AND pg_trigger_depth()>1
      AND NEW.staff_id IS DISTINCT FROM OLD.staff_id
      AND (NEW.shift_date,NEW.shift_type,NEW.custom_start_time,NEW.custom_end_time,NEW.unit_id,NEW.shift_definition_id,NEW.covers_assignment_id,NEW.shift_classification,NEW.deleted_at)
        IS NOT DISTINCT FROM (OLD.shift_date,OLD.shift_type,OLD.custom_start_time,OLD.custom_end_time,OLD.unit_id,OLD.shift_definition_id,OLD.covers_assignment_id,OLD.shift_classification,OLD.deleted_at) THEN
      SELECT EXISTS (SELECT 1 FROM public.shift_swap_requests r WHERE r.status='approved' AND r.deleted_at IS NULL AND r.approved_by=auth.uid()
        AND r.requesting_confirmed_at IS NOT NULL AND r.covering_confirmed_at IS NOT NULL AND r.eligibility_reviewed_by=auth.uid()
        AND r.facility_id=NEW.facility_id AND r.organization_id=NEW.organization_id
        AND ((r.requesting_assignment_id=NEW.id AND r.requesting_staff_id=OLD.staff_id AND r.covering_staff_id=NEW.staff_id)
          OR (r.covering_assignment_id=NEW.id AND r.covering_staff_id=OLD.staff_id AND r.requesting_staff_id=NEW.staff_id))) INTO swap_authorized;
      IF NOT swap_authorized THEN RAISE EXCEPTION 'Published employee change requires an applied approved swap'; END IF;
    ELSE RAISE EXCEPTION 'Published and archived assignment plans are immutable; use call-out coverage or an approved swap'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_schedule_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER workforce_guard_schedule_assignment BEFORE INSERT OR UPDATE OR DELETE ON public.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION haven.guard_schedule_assignment();

-- Preserve Home call-out behavior with the shared schedule-first lock order.
CREATE OR REPLACE FUNCTION public.home_record_callout(
  p_event_id uuid, p_assignment_id uuid, p_reason text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  v_shift public.shift_assignments;
  v_prior public.staff_attendance_events;
  v_status public.shift_assignment_status;
  v_event public.staff_attendance_event_type;
BEGIN
  IF p_reason NOT IN ('sick', 'family', 'no_show', 'other') THEN
    RAISE EXCEPTION 'Reason must be sick, family, no-show or other' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shift FROM public.shift_assignments WHERE id = p_assignment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift unavailable' USING ERRCODE = '42501'; END IF;
  a := haven.home_operator_for(v_shift.facility_id, 'call_out');
  PERFORM 1 FROM public.schedules WHERE id=v_shift.schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment schedule unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(staff_id::text,0)) FROM public.shift_assignments WHERE id=p_assignment_id;
  SELECT * INTO v_shift FROM public.shift_assignments WHERE id = p_assignment_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift unavailable' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_prior FROM public.staff_attendance_events WHERE id = p_event_id;
  IF FOUND THEN
    IF v_prior.shift_assignment_id IS DISTINCT FROM p_assignment_id THEN
      RAISE EXCEPTION 'Call-out identity already used' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('eventId', v_prior.id, 'assignmentId', p_assignment_id, 'status', v_shift.status, 'replayed', true);
  END IF;
  IF v_shift.status NOT IN ('assigned', 'confirmed', 'swap_requested') THEN
    RAISE EXCEPTION 'This shift is already %', replace(v_shift.status::text, '_', ' ') USING ERRCODE = '22023';
  END IF;

  v_status := CASE WHEN p_reason = 'no_show' THEN 'no_show' ELSE 'called_out' END;
  v_event := CASE WHEN p_reason = 'no_show' THEN 'no_show' ELSE 'callout' END;
  UPDATE public.shift_assignments
     SET status = v_status, updated_at = now(), updated_by = a.actor_user_id
   WHERE id = v_shift.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call-out update was not applied'; END IF;
  INSERT INTO public.staff_attendance_events (id, staff_id, facility_id, organization_id, event_type, occurred_at,
                                              shift_assignment_id, reason, notes, created_by, updated_by)
  VALUES (p_event_id, v_shift.staff_id, v_shift.facility_id, v_shift.organization_id, v_event, now(),
          v_shift.id, p_reason, nullif(btrim(coalesce(p_note, '')), ''), a.actor_user_id, a.actor_user_id);
  RETURN jsonb_build_object('eventId', p_event_id, 'assignmentId', v_shift.id, 'status', v_status, 'replayed', false);
END $$;

-- Preserve Home call-out behavior with the shared schedule-first lock order.
CREATE OR REPLACE FUNCTION public.home_cover_shift(p_id uuid, p_called_out_assignment_id uuid, p_staff_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_gap public.shift_assignments; v_row public.shift_assignments; v_prior public.shift_assignments;
BEGIN
  SELECT * INTO v_gap FROM public.shift_assignments WHERE id = p_called_out_assignment_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift unavailable' USING ERRCODE = '42501'; END IF;
  a := haven.home_operator_for(v_gap.facility_id, 'call_out');
  PERFORM 1 FROM public.schedules WHERE id=v_gap.schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment schedule unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id=p_staff_id OR s.id=(SELECT staff_id FROM public.shift_assignments WHERE id=p_called_out_assignment_id) ORDER BY s.id;
  SELECT * INTO v_gap FROM public.shift_assignments WHERE id = p_called_out_assignment_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_prior FROM public.shift_assignments WHERE id = p_id;
  IF FOUND THEN
    IF v_prior.covers_assignment_id IS DISTINCT FROM p_called_out_assignment_id OR v_prior.staff_id <> p_staff_id THEN
      RAISE EXCEPTION 'Cover identity already used' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('assignmentId', v_prior.id, 'replayed', true);
  END IF;
  IF v_gap.status NOT IN ('called_out', 'no_show') THEN
    RAISE EXCEPTION 'Only a called-out or no-show shift is covered here' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments c WHERE c.covers_assignment_id = v_gap.id
             AND c.deleted_at IS NULL AND c.status NOT IN ('called_out', 'no_show')) THEN
    RAISE EXCEPTION 'This shift is already covered' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_staff_id AND s.facility_id = v_gap.facility_id
                 AND s.deleted_at IS NULL AND s.employment_status::text = 'active') OR p_staff_id = v_gap.staff_id THEN
    RAISE EXCEPTION 'Pick someone else who works in this building' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments x WHERE x.staff_id = p_staff_id AND x.shift_date = v_gap.shift_date
             AND x.shift_type = v_gap.shift_type AND x.deleted_at IS NULL AND x.status NOT IN ('called_out', 'no_show')) THEN
    RAISE EXCEPTION 'That person is already on this shift' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shift_assignments (id, schedule_id, staff_id, facility_id, organization_id, shift_date, shift_type,
                                        custom_start_time, custom_end_time, unit_id, status, notes, covers_assignment_id,
                                        created_by, updated_by)
  VALUES (p_id, v_gap.schedule_id, p_staff_id, v_gap.facility_id, v_gap.organization_id, v_gap.shift_date, v_gap.shift_type,
          v_gap.custom_start_time, v_gap.custom_end_time, v_gap.unit_id, 'assigned', 'Covering a call-out (Home)',
          v_gap.id, a.actor_user_id, a.actor_user_id)
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cover assignment was not inserted'; END IF;
  RETURN jsonb_build_object('assignmentId', v_row.id, 'replayed', false);
END $$;
