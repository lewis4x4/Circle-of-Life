SET search_path = public;

CREATE INDEX IF NOT EXISTS idx_units_org_facility_name_active
  ON public.units (organization_id, facility_id, name)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.promote_facility_launch_m3(
  p_organization_id uuid,
  p_facility_id uuid,
  p_actor_user_id uuid,
  p_run_item_id uuid,
  p_module_value_id uuid,
  p_units jsonb,
  p_rooms jsonb,
  p_beds jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_units_created integer := 0;
  v_units_noop integer := 0;
  v_rooms_created integer := 0;
  v_rooms_noop integer := 0;
  v_beds_created integer := 0;
  v_beds_noop integer := 0;
  v_warnings text[] := ARRAY[]::text[];
  v_unit jsonb;
  v_room jsonb;
  v_bed jsonb;
  v_unit_id uuid;
  v_room_id uuid;
  v_existing_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.facilities f
    WHERE f.id = p_facility_id
      AND f.organization_id = p_organization_id
      AND f.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'M3 facility validation failed for facility % organization %', p_facility_id, p_organization_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_facility_id::text), hashtext('facility_launch_m3'));

  FOR v_unit IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb))
  LOOP
    SELECT count(*)::integer INTO v_existing_count
    FROM public.units u
    WHERE u.organization_id = p_organization_id
      AND u.facility_id = p_facility_id
      AND u.name = COALESCE(v_unit->>'name', '')
      AND u.deleted_at IS NULL;

    IF v_existing_count = 0 THEN
      INSERT INTO public.units (
        organization_id,
        facility_id,
        name,
        floor_number,
        sort_order,
        created_by,
        updated_by
      ) VALUES (
        p_organization_id,
        p_facility_id,
        v_unit->>'name',
        COALESCE((v_unit->>'floor_number')::integer, 1),
        COALESCE((v_unit->>'sort_order')::integer, 0),
        p_actor_user_id,
        p_actor_user_id
      ) RETURNING id INTO v_unit_id;

      v_units_created := v_units_created + 1;

      INSERT INTO public.facility_launch_promotion_run_links (
        run_item_id,
        organization_id,
        facility_id,
        module_value_id,
        target_table,
        target_row_id,
        action,
        before_value,
        after_value
      ) VALUES (
        p_run_item_id,
        p_organization_id,
        p_facility_id,
        p_module_value_id,
        'units',
        v_unit_id::text,
        'insert',
        NULL,
        jsonb_build_object(
          'facility_id', p_facility_id,
          'organization_id', p_organization_id,
          'name', v_unit->>'name',
          'floor_number', COALESCE((v_unit->>'floor_number')::integer, 1),
          'sort_order', COALESCE((v_unit->>'sort_order')::integer, 0)
        )
      );
    ELSE
      SELECT u.id INTO v_unit_id
      FROM public.units u
      WHERE u.organization_id = p_organization_id
        AND u.facility_id = p_facility_id
        AND u.name = COALESCE(v_unit->>'name', '')
        AND u.deleted_at IS NULL
      ORDER BY u.created_at ASC
      LIMIT 1;

      IF v_existing_count > 1 THEN
        v_warnings := array_append(
          v_warnings,
          format('unit ''%s'' has multiple active rows; intake values were skipped to avoid overwriting live data.', COALESCE(v_unit->>'name', ''))
        );
      ELSIF EXISTS (
        SELECT 1
        FROM public.units u
        WHERE u.id = v_unit_id
          AND (
            COALESCE(u.floor_number, 1) <> COALESCE((v_unit->>'floor_number')::integer, 1)
            OR COALESCE(u.sort_order, 0) <> COALESCE((v_unit->>'sort_order')::integer, 0)
          )
      ) THEN
        v_warnings := array_append(
          v_warnings,
          format('unit ''%s'' already exists with differing operational values; intake values were skipped to avoid overwriting live data.', COALESCE(v_unit->>'name', ''))
        );
      END IF;

      v_units_noop := v_units_noop + 1;
    END IF;
  END LOOP;

  FOR v_room IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_rooms, '[]'::jsonb))
  LOOP
    SELECT count(*)::integer INTO v_existing_count
    FROM public.rooms r
    WHERE r.organization_id = p_organization_id
      AND r.facility_id = p_facility_id
      AND r.room_number = COALESCE(v_room->>'room_number', '')
      AND r.deleted_at IS NULL;

    SELECT u.id INTO v_unit_id
    FROM public.units u
    WHERE u.organization_id = p_organization_id
      AND u.facility_id = p_facility_id
      AND u.name = COALESCE(v_room->>'unit_name', '')
      AND u.deleted_at IS NULL
    ORDER BY u.created_at ASC
    LIMIT 1;

    IF v_existing_count = 0 THEN
      INSERT INTO public.rooms (
        organization_id,
        facility_id,
        unit_id,
        room_number,
        room_type,
        max_occupancy,
        floor_number,
        sort_order,
        launch_profile_metadata,
        created_by,
        updated_by
      ) VALUES (
        p_organization_id,
        p_facility_id,
        v_unit_id,
        v_room->>'room_number',
        (v_room->>'room_type')::room_type,
        COALESCE((v_room->>'max_occupancy')::integer, 1),
        COALESCE((v_room->>'floor_number')::integer, 1),
        COALESCE((v_room->>'sort_order')::integer, 0),
        COALESCE(v_room->'launch_profile_metadata', '{}'::jsonb),
        p_actor_user_id,
        p_actor_user_id
      ) RETURNING id INTO v_room_id;

      v_rooms_created := v_rooms_created + 1;

      INSERT INTO public.facility_launch_promotion_run_links (
        run_item_id,
        organization_id,
        facility_id,
        module_value_id,
        target_table,
        target_row_id,
        action,
        before_value,
        after_value
      ) VALUES (
        p_run_item_id,
        p_organization_id,
        p_facility_id,
        p_module_value_id,
        'rooms',
        v_room_id::text,
        'insert',
        NULL,
        jsonb_build_object(
          'facility_id', p_facility_id,
          'organization_id', p_organization_id,
          'unit_id', v_unit_id,
          'room_number', v_room->>'room_number',
          'room_type', v_room->>'room_type',
          'max_occupancy', COALESCE((v_room->>'max_occupancy')::integer, 1),
          'floor_number', COALESCE((v_room->>'floor_number')::integer, 1),
          'sort_order', COALESCE((v_room->>'sort_order')::integer, 0),
          'launch_profile_metadata', COALESCE(v_room->'launch_profile_metadata', '{}'::jsonb)
        )
      );
    ELSE
      SELECT r.id INTO v_room_id
      FROM public.rooms r
      WHERE r.organization_id = p_organization_id
        AND r.facility_id = p_facility_id
        AND r.room_number = COALESCE(v_room->>'room_number', '')
        AND r.deleted_at IS NULL
      ORDER BY r.created_at ASC
      LIMIT 1;

      IF v_existing_count > 1 THEN
        v_warnings := array_append(
          v_warnings,
          format('room ''%s'' has multiple active rows; intake values were skipped to avoid overwriting live data.', COALESCE(v_room->>'room_number', ''))
        );
      ELSIF EXISTS (
        SELECT 1
        FROM public.rooms r
        WHERE r.id = v_room_id
          AND (
            COALESCE(r.unit_id::text, '') <> COALESCE(v_unit_id::text, '')
            OR COALESCE(r.room_type::text, '') <> COALESCE(v_room->>'room_type', '')
            OR COALESCE(r.max_occupancy, 1) <> COALESCE((v_room->>'max_occupancy')::integer, 1)
            OR COALESCE(r.floor_number, 1) <> COALESCE((v_room->>'floor_number')::integer, 1)
            OR COALESCE(r.sort_order, 0) <> COALESCE((v_room->>'sort_order')::integer, 0)
            OR COALESCE(r.launch_profile_metadata, '{}'::jsonb) <> COALESCE(v_room->'launch_profile_metadata', '{}'::jsonb)
          )
      ) THEN
        v_warnings := array_append(
          v_warnings,
          format('room ''%s'' already exists with differing operational values; intake values were skipped to avoid overwriting live data.', COALESCE(v_room->>'room_number', ''))
        );
      END IF;

      v_rooms_noop := v_rooms_noop + 1;
    END IF;
  END LOOP;

  FOR v_bed IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_beds, '[]'::jsonb))
  LOOP
    SELECT r.id INTO v_room_id
    FROM public.rooms r
    WHERE r.organization_id = p_organization_id
      AND r.facility_id = p_facility_id
      AND r.room_number = COALESCE(v_bed->>'room_number', '')
      AND r.deleted_at IS NULL
    ORDER BY r.created_at ASC
    LIMIT 1;

    IF v_room_id IS NULL THEN
      RAISE EXCEPTION 'M3 bed promotion failed: room % not found', COALESCE(v_bed->>'room_number', '');
    END IF;

    SELECT count(*)::integer INTO v_existing_count
    FROM public.beds b
    WHERE b.room_id = v_room_id
      AND b.bed_label = COALESCE(v_bed->>'bed_label', '')
      AND b.deleted_at IS NULL;

    IF v_existing_count = 0 THEN
      INSERT INTO public.beds (
        room_id,
        facility_id,
        organization_id,
        bed_label,
        bed_type,
        status,
        created_by,
        updated_by
      ) VALUES (
        v_room_id,
        p_facility_id,
        p_organization_id,
        v_bed->>'bed_label',
        (v_bed->>'bed_type')::bed_type,
        (v_bed->>'status')::bed_status,
        p_actor_user_id,
        p_actor_user_id
      ) RETURNING id INTO v_unit_id;

      v_beds_created := v_beds_created + 1;

      INSERT INTO public.facility_launch_promotion_run_links (
        run_item_id,
        organization_id,
        facility_id,
        module_value_id,
        target_table,
        target_row_id,
        action,
        before_value,
        after_value
      ) VALUES (
        p_run_item_id,
        p_organization_id,
        p_facility_id,
        p_module_value_id,
        'beds',
        v_unit_id::text,
        'insert',
        NULL,
        jsonb_build_object(
          'room_id', v_room_id,
          'facility_id', p_facility_id,
          'organization_id', p_organization_id,
          'bed_label', v_bed->>'bed_label',
          'bed_type', v_bed->>'bed_type',
          'status', v_bed->>'status'
        )
      );
    ELSE
      IF v_existing_count > 1 THEN
        v_warnings := array_append(
          v_warnings,
          format('bed ''%s/%s'' has multiple active rows; intake values were skipped to avoid overwriting live data.', COALESCE(v_bed->>'room_number', ''), COALESCE(v_bed->>'bed_label', ''))
        );
      ELSIF EXISTS (
        SELECT 1
        FROM public.beds b
        WHERE b.room_id = v_room_id
          AND b.bed_label = COALESCE(v_bed->>'bed_label', '')
          AND b.deleted_at IS NULL
          AND COALESCE(b.bed_type::text, '') <> COALESCE(v_bed->>'bed_type', '')
      ) THEN
        v_warnings := array_append(
          v_warnings,
          format('bed ''%s/%s'' already exists with differing operational values; intake values were skipped to avoid overwriting live data.', COALESCE(v_bed->>'room_number', ''), COALESCE(v_bed->>'bed_label', ''))
        );
      END IF;

      v_beds_noop := v_beds_noop + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'units_created', v_units_created,
    'units_noop', v_units_noop,
    'rooms_created', v_rooms_created,
    'rooms_noop', v_rooms_noop,
    'beds_created', v_beds_created,
    'beds_noop', v_beds_noop,
    'warnings', to_jsonb(v_warnings)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.promote_facility_launch_m3(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promote_facility_launch_m3(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) TO service_role;
