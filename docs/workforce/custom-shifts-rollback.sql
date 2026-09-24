-- COL-756 schema rollback only; saved custom assignments remain intact.
-- Restore this only with the previous app deployment. Prefer keeping backward-compatible503.
BEGIN;
CREATE OR REPLACE FUNCTION public.schedule_bulk_upsert(p_schedule_id uuid,p_expected_updated_at timestamptz,p_cells jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  w public.schedules%ROWTYPE;
  d public.facility_shift_definitions%ROWTYPE;
  c record;
  assignment_id uuid;
  expected_updates integer;
  applied_updates integer;
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
    IF c.shift_definition_id IS NOT NULL THEN
      SELECT * INTO d FROM public.facility_shift_definitions WHERE id=c.shift_definition_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL;
      IF NOT FOUND OR d.starts_at_local=d.ends_at_local THEN RAISE EXCEPTION 'Active facility shift definition with distinct times required'; END IF;
    END IF;
  END LOOP;

  -- A cell edits the existing plan. Keep its identity, resident/unit coverage,
  -- classification and notes. Update every existing cell in one statement so
  -- AFTER overlap checks see the final arrangement, not an intermediate move.
  SELECT count(*) INTO expected_updates FROM public.shift_assignments a
    JOIN jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid)
      ON x.staff_id=a.staff_id AND x.shift_date=a.shift_date
    WHERE a.schedule_id=w.id AND a.deleted_at IS NULL;
  UPDATE public.shift_assignments a
    SET deleted_at=CASE WHEN x.shift_definition_id IS NULL THEN clock_timestamp() ELSE NULL END,
      shift_type=CASE WHEN definition.id IS NULL THEN a.shift_type ELSE definition.roster_shift_type END,
      custom_start_time=CASE WHEN definition.id IS NULL THEN a.custom_start_time ELSE definition.starts_at_local END,
      custom_end_time=CASE WHEN definition.id IS NULL THEN a.custom_end_time ELSE definition.ends_at_local END,
      shift_definition_id=CASE WHEN definition.id IS NULL THEN a.shift_definition_id ELSE definition.id END,
      updated_by=auth.uid()
    FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid)
      LEFT JOIN public.facility_shift_definitions definition ON definition.id=x.shift_definition_id
        AND definition.facility_id=w.facility_id AND definition.organization_id=w.organization_id AND definition.active AND definition.deleted_at IS NULL AND definition.starts_at_local<>definition.ends_at_local
    WHERE a.schedule_id=w.id AND a.staff_id=x.staff_id AND a.shift_date=x.shift_date AND a.deleted_at IS NULL
      AND (x.shift_definition_id IS NULL OR definition.id IS NOT NULL);
  GET DIAGNOSTICS applied_updates=ROW_COUNT;
  IF applied_updates<>expected_updates THEN RAISE EXCEPTION 'Schedule cell updates were not applied in full'; END IF;

  FOR c IN SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid) ORDER BY staff_id,shift_date LOOP
    IF c.shift_definition_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=c.staff_id AND a.shift_date=c.shift_date AND a.deleted_at IS NULL
    ) THEN
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
DECLARE w public.schedules%ROWTYPE; source_week public.schedules%ROWTYPE; cells jsonb; copied_metadata integer;
BEGIN
  IF auth.uid() IS NULL OR haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
  SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
  IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before copying.'; END IF;
  IF EXISTS (SELECT 1 FROM public.shift_assignments WHERE schedule_id=w.id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Copy last week requires an empty draft'; END IF;
  SELECT * INTO source_week FROM public.schedules WHERE facility_id=w.facility_id AND organization_id=w.organization_id AND week_start_date=w.week_start_date-7 AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No schedule exists for the previous week'; END IF;
  -- Reuse the original plan; coverage rows describe a one-off attendance event.
  -- Inactive original employees are rejected by bulk validation, never silently replaced.
  IF EXISTS (
    SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND a.covers_assignment_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time)
  ) THEN RAISE EXCEPTION 'Previous week contains shifts without a matching active definition. Plan those shifts explicitly.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('staff_id',a.staff_id,'shift_date',a.shift_date+7,'shift_definition_id',d.id) ORDER BY a.staff_id,a.shift_date)
    INTO cells FROM public.shift_assignments a CROSS JOIN LATERAL (
      SELECT d.id FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time ORDER BY (d.id=a.shift_definition_id) DESC,d.id LIMIT 1
    ) d WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND a.covers_assignment_id IS NULL;
  IF cells IS NULL THEN RAISE EXCEPTION 'Previous week has no assignments to copy'; END IF;
  PERFORM public.schedule_bulk_upsert(w.id,p_expected_updated_at,cells);
  -- Carry the chosen plan into the new draft, without attendance/coverage state.
  UPDATE public.shift_assignments target
    SET unit_id=source.unit_id,assigned_resident_ids=source.assigned_resident_ids,
      shift_classification=source.shift_classification,notes=source.notes,updated_by=auth.uid()
    FROM public.shift_assignments source
    WHERE source.schedule_id=source_week.id AND source.deleted_at IS NULL AND source.covers_assignment_id IS NULL
      AND target.schedule_id=w.id AND target.staff_id=source.staff_id AND target.shift_date=source.shift_date+7 AND target.deleted_at IS NULL;
  GET DIAGNOSTICS copied_metadata=ROW_COUNT;
  IF copied_metadata<>jsonb_array_length(cells) THEN RAISE EXCEPTION 'Previous week planning details were not copied in full'; END IF;
  RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_copy_week(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_copy_week(uuid,timestamptz) TO authenticated;

COMMIT;
