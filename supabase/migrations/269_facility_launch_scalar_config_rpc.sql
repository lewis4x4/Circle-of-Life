SET search_path = public;

CREATE OR REPLACE FUNCTION public.promote_facility_launch_scalar_config(
  p_organization_id uuid,
  p_facility_id uuid,
  p_actor_user_id uuid,
  p_run_item_id uuid,
  p_table text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_created integer := 0;
  v_updated integer := 0;
  v_noop integer := 0;
  v_row jsonb;
  v_table text;
  v_existing_id uuid;
  v_existing_value jsonb;
  v_existing_provenance jsonb;
  v_existing_module_value_id uuid;
  v_existing_updated_by uuid;
  v_existing_before jsonb;
  v_target_id uuid;
  v_field_path text;
  v_value jsonb;
  v_provenance jsonb;
  v_module_value_id uuid;
BEGIN
  v_table := lower(coalesce(p_table, ''));
  IF v_table NOT IN (
    'facility_billing_config',
    'facility_medication_config',
    'facility_dining_config',
    'facility_maintenance_config',
    'facility_admissions_config',
    'facility_incident_config',
    'facility_vendor_config',
    'facility_launch_scoreboard_config'
  ) THEN
    RAISE EXCEPTION 'Scalar config promotion table % is not allowed', p_table;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.facilities f
    WHERE f.id = p_facility_id
      AND f.organization_id = p_organization_id
      AND f.deleted_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Scalar config promotion validation failed for facility % organization %', p_facility_id, p_organization_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_facility_id::text), hashtext('facility_launch_scalar_config'));

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  LOOP
    v_field_path := nullif(trim(coalesce(v_row->>'field_path', '')), '');
    IF v_field_path IS NULL THEN
      CONTINUE;
    END IF;

    v_value := v_row->'value';
    v_provenance := coalesce(v_row->'provenance', '{}'::jsonb);
    v_module_value_id := nullif(v_row->>'promoted_from_module_value_id', '')::uuid;

    v_existing_id := NULL;
    v_existing_value := NULL;
    v_existing_provenance := NULL;
    v_existing_module_value_id := NULL;
    v_existing_updated_by := NULL;
    v_existing_before := NULL;

    EXECUTE format(
      'SELECT config_row.id,
              config_row.value,
              config_row.provenance,
              config_row.promoted_from_module_value_id,
              config_row.updated_by,
              to_jsonb(config_row.*)
       FROM public.%I config_row
       WHERE config_row.organization_id = $1
         AND config_row.facility_id = $2
         AND config_row.field_path = $3
         AND config_row.deleted_at IS NULL
       LIMIT 1',
      v_table
    )
    INTO v_existing_id,
         v_existing_value,
         v_existing_provenance,
         v_existing_module_value_id,
         v_existing_updated_by,
         v_existing_before
    USING p_organization_id, p_facility_id, v_field_path;

    IF v_existing_id IS NULL THEN
      EXECUTE format(
        'INSERT INTO public.%I (
           organization_id,
           facility_id,
           field_path,
           value,
           provenance,
           promoted_from_module_value_id,
           created_by,
           updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING id',
        v_table
      )
      INTO v_target_id
      USING p_organization_id, p_facility_id, v_field_path, v_value, v_provenance, v_module_value_id, p_actor_user_id;

      v_created := v_created + 1;

      IF p_run_item_id IS NOT NULL THEN
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
          v_module_value_id,
          v_table,
          v_target_id::text,
          'insert',
          NULL,
          jsonb_build_object(
            'organization_id', p_organization_id,
            'facility_id', p_facility_id,
            'field_path', v_field_path,
            'value', v_value,
            'provenance', v_provenance,
            'promoted_from_module_value_id', v_module_value_id,
            'updated_by', p_actor_user_id
          )
        );
      END IF;
    ELSIF
      v_existing_value IS DISTINCT FROM v_value
      OR v_existing_provenance IS DISTINCT FROM v_provenance
      OR v_existing_module_value_id IS DISTINCT FROM v_module_value_id
      OR v_existing_updated_by IS DISTINCT FROM p_actor_user_id
    THEN
      EXECUTE format(
        'UPDATE public.%I
         SET value = $1,
             provenance = $2,
             promoted_from_module_value_id = $3,
             updated_by = $4,
             updated_at = now()
         WHERE id = $5',
        v_table
      )
      USING v_value, v_provenance, v_module_value_id, p_actor_user_id, v_existing_id;

      v_updated := v_updated + 1;

      IF p_run_item_id IS NOT NULL THEN
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
          v_module_value_id,
          v_table,
          v_existing_id::text,
          'update',
          v_existing_before,
          jsonb_build_object(
            'value', v_value,
            'provenance', v_provenance,
            'promoted_from_module_value_id', v_module_value_id,
            'updated_by', p_actor_user_id
          )
        );
      END IF;
    ELSE
      v_noop := v_noop + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'noop', v_noop
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_facility_launch_scalar_config(
  uuid, uuid, uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promote_facility_launch_scalar_config(
  uuid, uuid, uuid, uuid, text, jsonb
) TO service_role;
