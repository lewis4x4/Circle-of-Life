-- COL-795 (migration 513): one grid click schedules the cook split (two time blocks in one cell).
-- No schema/ACL changes. A cell may now carry `custom_blocks`: exactly two
-- same-day, non-overlapping custom blocks saved as two assignments. A cell that
-- already holds exactly two custom assignments (a split) can be replaced from
-- the grid; any other multi-assignment cell stays blocked as before.
BEGIN;

-- Target blocks for a batch of grid cells, ordered by start time within a cell.
-- Off cells yield no rows. Callers validate the cells first.
CREATE OR REPLACE FUNCTION haven.schedule_cell_targets(p_cells jsonb,p_facility_id uuid,p_organization_id uuid)
RETURNS TABLE(staff_id uuid,shift_date date,slot integer,shift_type public.shift_type,starts_at time,ends_at time,definition_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  WITH cells AS (
    SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid,custom_start_time text,custom_end_time text,custom_blocks jsonb)
  )
  SELECT c.staff_id,c.shift_date,1,'custom'::public.shift_type,c.custom_start_time::time,c.custom_end_time::time,NULL::uuid
    FROM cells c WHERE c.custom_start_time IS NOT NULL
  UNION ALL
  SELECT c.staff_id,c.shift_date,1,d.roster_shift_type,d.starts_at_local,d.ends_at_local,d.id
    FROM cells c JOIN public.facility_shift_definitions d ON d.id=c.shift_definition_id AND d.facility_id=p_facility_id
      AND d.organization_id=p_organization_id AND d.active AND d.deleted_at IS NULL AND d.starts_at_local<>d.ends_at_local
  UNION ALL
  SELECT c.staff_id,c.shift_date,(row_number() OVER (PARTITION BY c.staff_id,c.shift_date ORDER BY (b->>'start_time')::time))::integer,
      'custom'::public.shift_type,(b->>'start_time')::time,(b->>'end_time')::time,NULL::uuid
    FROM cells c CROSS JOIN LATERAL jsonb_array_elements(c.custom_blocks) b
    WHERE jsonb_typeof(c.custom_blocks)='array'
$$;
REVOKE ALL ON FUNCTION haven.schedule_cell_targets(jsonb,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION haven.schedule_cell_targets(jsonb,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.schedule_bulk_upsert(p_schedule_id uuid,p_expected_updated_at timestamptz,p_cells jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  w public.schedules%ROWTYPE;
  d public.facility_shift_definitions%ROWTYPE;
  c record;
  blk record;
  t record;
  existing_count integer;
  assignment_id uuid;
  expected_updates integer;
  applied_updates integer;
  targets jsonb;
BEGIN
  IF auth.uid() IS NULL OR haven.app_role()::text NOT IN ('owner','org_admin','facility_admin','manager') THEN RAISE EXCEPTION 'Schedule manager access required'; END IF;
  SELECT * INTO w FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR w.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
  IF p_expected_updated_at IS NULL OR w.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Schedule changed. Reload before saving.'; END IF;
  IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Provide 1 to 1000 cell changes'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) GROUP BY staff_id,shift_date HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate employee/date cells'; END IF;

  -- Serialize staff mutations across schedule weeks in consistent order.
  PERFORM pg_advisory_xact_lock(hashtextextended(s.id::text,0)) FROM public.staff s WHERE s.id IN (SELECT x.staff_id FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid)) ORDER BY s.id;
  FOR c IN SELECT * FROM jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date,shift_definition_id uuid,custom_start_time text,custom_end_time text,custom_blocks jsonb) ORDER BY staff_id,shift_date LOOP
    IF c.shift_date IS NULL OR c.shift_date NOT BETWEEN w.week_start_date AND w.week_start_date+6 THEN RAISE EXCEPTION 'Shift date must be inside this schedule week'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id=c.staff_id AND s.facility_id=w.facility_id AND s.organization_id=w.organization_id AND s.deleted_at IS NULL AND s.employment_status='active') THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
    SELECT count(*) INTO existing_count FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=c.staff_id AND a.shift_date=c.shift_date AND a.deleted_at IS NULL;
    -- A saved split is two plain custom blocks. Anything else with several rows needs review first.
    IF existing_count>2 OR (existing_count=2 AND EXISTS (
      SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=c.staff_id AND a.shift_date=c.shift_date AND a.deleted_at IS NULL
        AND (a.shift_type<>'custom' OR a.shift_definition_id IS NOT NULL OR a.covers_assignment_id IS NOT NULL)
    )) THEN RAISE EXCEPTION 'Multiple assignments in this cell. Review assignment details first.'; END IF;
    IF EXISTS (SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=c.staff_id AND a.shift_date=c.shift_date AND a.deleted_at IS NULL AND a.status::text NOT IN ('assigned','confirmed')) THEN RAISE EXCEPTION 'Resolve the assignment status before replacing this cell'; END IF;
    IF c.custom_blocks IS NOT NULL AND jsonb_typeof(c.custom_blocks)<>'null' THEN
      IF c.shift_definition_id IS NOT NULL OR c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL THEN RAISE EXCEPTION 'Choose a facility shift, custom times or a split shift, not more than one'; END IF;
      IF jsonb_typeof(c.custom_blocks)<>'array' OR jsonb_array_length(c.custom_blocks)<>2 THEN RAISE EXCEPTION 'Split shifts require exactly two time blocks'; END IF;
      FOR blk IN SELECT * FROM jsonb_array_elements(c.custom_blocks) AS e(value) LOOP
        IF jsonb_typeof(blk.value)<>'object'
          OR coalesce(blk.value->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$'
          OR coalesce(blk.value->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' THEN
          RAISE EXCEPTION 'Split shifts require valid start and finish times';
        END IF;
        -- Blocks stay within the shift date; overlap between them is rejected below.
        IF (blk.value->>'end_time')::time<=(blk.value->>'start_time')::time THEN RAISE EXCEPTION 'Each split block must finish after it starts on the same day'; END IF;
      END LOOP;
    ELSIF c.custom_start_time IS NOT NULL OR c.custom_end_time IS NOT NULL THEN
      IF c.shift_definition_id IS NOT NULL THEN RAISE EXCEPTION 'Choose a facility shift or custom times, not both'; END IF;
      IF c.custom_start_time IS NULL OR c.custom_end_time IS NULL
        OR c.custom_start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$'
        OR c.custom_end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' THEN
        RAISE EXCEPTION 'Custom shifts require valid start and finish times';
      END IF;
      IF c.custom_start_time::time=c.custom_end_time::time THEN RAISE EXCEPTION 'Custom start and finish times must differ'; END IF;
    END IF;
    IF c.shift_definition_id IS NOT NULL THEN
      SELECT * INTO d FROM public.facility_shift_definitions WHERE id=c.shift_definition_id AND facility_id=w.facility_id AND organization_id=w.organization_id AND active AND deleted_at IS NULL;
      IF NOT FOUND OR d.starts_at_local=d.ends_at_local THEN RAISE EXCEPTION 'Active facility shift definition with distinct times required'; END IF;
    END IF;
  END LOOP;

  -- Resolve every target block once, so the update and the additions below
  -- agree even if a definition changes mid-save. A validated cell without its
  -- target would otherwise be soft deleted.
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO targets FROM haven.schedule_cell_targets(p_cells,w.facility_id,w.organization_id) r;
  IF jsonb_array_length(targets)<>(SELECT coalesce(sum(CASE WHEN jsonb_typeof(x.custom_blocks)='array' THEN jsonb_array_length(x.custom_blocks)
      WHEN x.custom_start_time IS NOT NULL OR x.shift_definition_id IS NOT NULL THEN 1 ELSE 0 END),0)
    FROM jsonb_to_recordset(p_cells) AS x(shift_definition_id uuid,custom_start_time text,custom_blocks jsonb)) THEN
    RAISE EXCEPTION 'Active facility shift definition with distinct times required';
  END IF;

  -- A cell edits the existing plan. Existing rows fill target blocks in start
  -- order and keep their identity, resident/unit coverage, classification and
  -- notes; rows beyond the target count are soft deleted. Update every existing
  -- cell in one statement so AFTER overlap checks see the final arrangement,
  -- not an intermediate move.
  SELECT count(*) INTO expected_updates FROM public.shift_assignments a
    JOIN jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) ON x.staff_id=a.staff_id AND x.shift_date=a.shift_date
    WHERE a.schedule_id=w.id AND a.deleted_at IS NULL;
  UPDATE public.shift_assignments a
    SET deleted_at=CASE WHEN target.slot IS NULL THEN clock_timestamp() ELSE NULL END,
      shift_type=COALESCE(target.shift_type,a.shift_type),
      custom_start_time=COALESCE(target.starts_at,a.custom_start_time),
      custom_end_time=COALESCE(target.ends_at,a.custom_end_time),
      shift_definition_id=CASE WHEN target.slot IS NULL THEN a.shift_definition_id ELSE target.definition_id END,
      updated_by=auth.uid()
    FROM (
      SELECT e.id,e.staff_id,e.shift_date,row_number() OVER (PARTITION BY e.staff_id,e.shift_date ORDER BY e.custom_start_time NULLS LAST,e.id)::integer AS slot
      FROM public.shift_assignments e JOIN jsonb_to_recordset(p_cells) AS x(staff_id uuid,shift_date date) ON x.staff_id=e.staff_id AND x.shift_date=e.shift_date
      WHERE e.schedule_id=w.id AND e.deleted_at IS NULL
    ) existing
    LEFT JOIN jsonb_to_recordset(targets) AS target(staff_id uuid,shift_date date,slot integer,shift_type public.shift_type,starts_at time,ends_at time,definition_id uuid)
      ON target.staff_id=existing.staff_id AND target.shift_date=existing.shift_date AND target.slot=existing.slot
    WHERE a.id=existing.id;
  GET DIAGNOSTICS applied_updates=ROW_COUNT;
  IF applied_updates<>expected_updates THEN RAISE EXCEPTION 'Schedule cell updates were not applied in full'; END IF;

  -- Add blocks the cell did not already have, in start order.
  FOR t IN SELECT * FROM jsonb_to_recordset(targets) AS x(staff_id uuid,shift_date date,slot integer,shift_type public.shift_type,starts_at time,ends_at time,definition_id uuid) ORDER BY staff_id,shift_date,slot LOOP
    IF (SELECT count(*) FROM public.shift_assignments a WHERE a.schedule_id=w.id AND a.staff_id=t.staff_id AND a.shift_date=t.shift_date AND a.deleted_at IS NULL)<t.slot THEN
      assignment_id:=gen_random_uuid();
      PERFORM public.edit_draft_schedule(w.id,'add',assignment_id,t.staff_id,t.shift_date,t.starts_at,t.ends_at);
      IF t.definition_id IS NOT NULL THEN
        UPDATE public.shift_assignments SET shift_type=t.shift_type,shift_definition_id=t.definition_id WHERE id=assignment_id;
      END IF;
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
DECLARE w public.schedules%ROWTYPE; source_week public.schedules%ROWTYPE; cells jsonb; source_rows integer; copied_metadata integer;
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
      AND NOT (CASE WHEN a.shift_type='custom' AND a.shift_definition_id IS NULL THEN
        a.custom_start_time IS NOT NULL AND a.custom_end_time IS NOT NULL AND a.custom_start_time<>a.custom_end_time AND a.custom_start_time<'24:00'::time AND a.custom_end_time<'24:00'::time
      ELSE EXISTS (SELECT 1 FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND d.starts_at_local<>d.ends_at_local AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time) END)
  ) THEN RAISE EXCEPTION 'Previous week contains shifts without a matching active definition. Plan those shifts explicitly.'; END IF;
  -- A split (exactly two plain custom rows in one cell) copies as one split cell.
  -- Other multi-row cells still copy row by row and are rejected as duplicates.
  WITH source AS (
    SELECT a.*,d.id AS definition_id,
      count(*) OVER (PARTITION BY a.staff_id,a.shift_date) AS cell_rows,
      bool_and(a.shift_type='custom' AND a.shift_definition_id IS NULL) OVER (PARTITION BY a.staff_id,a.shift_date) AS all_custom
    FROM public.shift_assignments a LEFT JOIN LATERAL (
      SELECT d.id FROM public.facility_shift_definitions d WHERE d.facility_id=w.facility_id AND d.organization_id=w.organization_id AND d.active AND d.deleted_at IS NULL AND NOT (a.shift_type='custom' AND a.shift_definition_id IS NULL) AND d.roster_shift_type=a.shift_type AND d.starts_at_local=a.custom_start_time AND d.ends_at_local=a.custom_end_time ORDER BY (d.id=a.shift_definition_id) DESC,d.id LIMIT 1
    ) d ON true WHERE a.schedule_id=source_week.id AND a.deleted_at IS NULL AND a.covers_assignment_id IS NULL
  ), copied AS (
    SELECT s.staff_id,s.shift_date,jsonb_build_object('staff_id',s.staff_id,'shift_date',s.shift_date+7,'shift_definition_id',s.definition_id,
        'custom_start_time',CASE WHEN s.definition_id IS NULL THEN s.custom_start_time END,
        'custom_end_time',CASE WHEN s.definition_id IS NULL THEN s.custom_end_time END) AS cell
      FROM source s WHERE NOT (s.cell_rows=2 AND s.all_custom)
    UNION ALL
    SELECT s.staff_id,s.shift_date,jsonb_build_object('staff_id',s.staff_id,'shift_date',s.shift_date+7,'shift_definition_id',NULL,
        'custom_blocks',jsonb_agg(jsonb_build_object('start_time',s.custom_start_time,'end_time',s.custom_end_time) ORDER BY s.custom_start_time))
      FROM source s WHERE s.cell_rows=2 AND s.all_custom GROUP BY s.staff_id,s.shift_date
  )
  SELECT jsonb_agg(cell ORDER BY staff_id,shift_date),(SELECT count(*) FROM source) INTO cells,source_rows FROM copied;
  IF cells IS NULL THEN RAISE EXCEPTION 'Previous week has no assignments to copy'; END IF;
  PERFORM public.schedule_bulk_upsert(w.id,p_expected_updated_at,cells);
  -- Carry the chosen plan into the new draft, without attendance/coverage state.
  -- Rows pair by start order within a cell, so each split block keeps its own details.
  UPDATE public.shift_assignments target
    SET unit_id=source.unit_id,assigned_resident_ids=source.assigned_resident_ids,
      shift_classification=source.shift_classification,notes=source.notes,updated_by=auth.uid()
    FROM (
      SELECT s.*,row_number() OVER (PARTITION BY s.staff_id,s.shift_date ORDER BY s.custom_start_time NULLS LAST,s.id) AS slot
      FROM public.shift_assignments s WHERE s.schedule_id=source_week.id AND s.deleted_at IS NULL AND s.covers_assignment_id IS NULL
    ) source, (
      SELECT t.id,t.staff_id,t.shift_date,row_number() OVER (PARTITION BY t.staff_id,t.shift_date ORDER BY t.custom_start_time NULLS LAST,t.id) AS slot
      FROM public.shift_assignments t WHERE t.schedule_id=w.id AND t.deleted_at IS NULL
    ) ranked
    WHERE target.id=ranked.id AND ranked.staff_id=source.staff_id AND ranked.shift_date=source.shift_date+7 AND ranked.slot=source.slot;
  GET DIAGNOSTICS copied_metadata=ROW_COUNT;
  IF copied_metadata<>source_rows THEN RAISE EXCEPTION 'Previous week planning details were not copied in full'; END IF;
  RETURN w.id;
END $$;
REVOKE ALL ON FUNCTION public.schedule_copy_week(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_copy_week(uuid,timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
