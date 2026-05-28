SET search_path = public;

CREATE OR REPLACE FUNCTION public.promote_facility_launch_m6_rates(
  p_organization_id uuid,
  p_facility_id uuid,
  p_actor_user_id uuid,
  p_run_item_id uuid,
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
  v_existing_id uuid;
  v_existing_before jsonb;
  v_exact_count integer;
  v_overlap_count integer;
  v_target_id uuid;
  v_rate_type text;
  v_effective_from date;
  v_amount_cents integer;
  v_effective_to date;
  v_rate_confirmed boolean;
  v_approved_by uuid;
  v_approved_at timestamptz;
  v_notes text;
  v_promoted_from_module_value_id uuid;
  v_update_payload jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.deleted_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.facilities f
    WHERE f.id = p_facility_id
      AND f.organization_id = p_organization_id
      AND f.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'M6 rates promotion validation failed for facility % organization %', p_facility_id, p_organization_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_facility_id::text), hashtext('facility_launch_m6_rates'));

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  LOOP
    v_rate_type := nullif(trim(coalesce(v_row->>'rate_type', '')), '');
    v_effective_from := nullif(trim(coalesce(v_row->>'effective_from', '')), '')::date;
    v_amount_cents := nullif(trim(coalesce(v_row->>'amount_cents', '')), '')::integer;
    v_effective_to := nullif(trim(coalesce(v_row->>'effective_to', '')), '')::date;
    v_rate_confirmed := coalesce((v_row->>'rate_confirmed')::boolean, false);
    v_approved_by := nullif(trim(coalesce(v_row->>'approved_by', '')), '')::uuid;
    v_approved_at := nullif(trim(coalesce(v_row->>'approved_at', '')), '')::timestamptz;
    v_notes := nullif(v_row->>'notes', '');
    v_promoted_from_module_value_id := nullif(trim(coalesce(v_row->>'promoted_from_module_value_id', '')), '')::uuid;

    IF v_rate_type IS NULL THEN
      RAISE EXCEPTION 'M6 rates promotion row missing rate_type for facility %', p_facility_id;
    END IF;
    IF v_effective_from IS DISTINCT FROM DATE '2026-01-01' THEN
      RAISE EXCEPTION 'M6 rates promotion expects effective_from=2026-01-01 for facility % rate_type %', p_facility_id, v_rate_type;
    END IF;
    IF v_amount_cents IS NULL OR v_amount_cents < 0 THEN
      RAISE EXCEPTION 'M6 rates promotion requires non-negative amount_cents for facility % rate_type %', p_facility_id, v_rate_type;
    END IF;

    SELECT count(*)
    INTO v_exact_count
    FROM public.rate_schedule_versions r
    WHERE r.organization_id = p_organization_id
      AND r.facility_id = p_facility_id
      AND r.rate_type = v_rate_type
      AND r.effective_from = DATE '2026-01-01'
      AND r.deleted_at IS NULL;

    IF v_exact_count > 1 THEN
      RAISE EXCEPTION 'Duplicate active exact rate_schedule_versions rows for facility % rate_type % effective_from 2026-01-01', p_facility_id, v_rate_type;
    END IF;

    v_existing_id := NULL;
    v_existing_before := NULL;

    SELECT r.id, to_jsonb(r.*)
    INTO v_existing_id, v_existing_before
    FROM public.rate_schedule_versions r
    WHERE r.organization_id = p_organization_id
      AND r.facility_id = p_facility_id
      AND r.rate_type = v_rate_type
      AND r.effective_from = DATE '2026-01-01'
      AND r.deleted_at IS NULL;

    SELECT count(*)
    INTO v_overlap_count
    FROM public.rate_schedule_versions r
    WHERE r.organization_id = p_organization_id
      AND r.facility_id = p_facility_id
      AND r.rate_type = v_rate_type
      AND r.deleted_at IS NULL
      AND (v_existing_id IS NULL OR r.id <> v_existing_id)
      AND daterange(r.effective_from, r.effective_to, '[)') &&
        daterange(DATE '2026-01-01', v_effective_to, '[)');

    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Overlapping active rate exists for facility % rate_type % candidate range starting 2026-01-01', p_facility_id, v_rate_type;
    END IF;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.rate_schedule_versions (
        organization_id,
        facility_id,
        rate_type,
        amount_cents,
        effective_from,
        effective_to,
        rate_confirmed,
        approved_by,
        approved_at,
        notes,
        created_by
      ) VALUES (
        p_organization_id,
        p_facility_id,
        v_rate_type,
        v_amount_cents,
        DATE '2026-01-01',
        v_effective_to,
        v_rate_confirmed,
        v_approved_by,
        v_approved_at,
        v_notes,
        p_actor_user_id
      ) RETURNING id INTO v_target_id;

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
          v_promoted_from_module_value_id,
          'rate_schedule_versions',
          v_target_id::text,
          'insert',
          NULL,
          jsonb_build_object(
            'organization_id', p_organization_id,
            'facility_id', p_facility_id,
            'rate_type', v_rate_type,
            'amount_cents', v_amount_cents,
            'effective_from', DATE '2026-01-01',
            'effective_to', v_effective_to,
            'rate_confirmed', v_rate_confirmed,
            'approved_by', v_approved_by,
            'approved_at', v_approved_at,
            'notes', v_notes,
            'created_by', p_actor_user_id
          )
        );
      END IF;
      CONTINUE;
    END IF;

    v_update_payload := jsonb_build_object(
      'amount_cents', v_amount_cents,
      'effective_to', v_effective_to,
      'rate_confirmed', v_rate_confirmed,
      'approved_by', v_approved_by,
      'approved_at', v_approved_at,
      'notes', v_notes
    );

    IF (
      (v_existing_before->>'amount_cents')::integer IS DISTINCT FROM v_amount_cents
      OR (v_existing_before->>'effective_to')::date IS DISTINCT FROM v_effective_to
      OR (v_existing_before->>'rate_confirmed')::boolean IS DISTINCT FROM v_rate_confirmed
      OR nullif(v_existing_before->>'notes', '') IS DISTINCT FROM v_notes
    ) THEN
      UPDATE public.rate_schedule_versions
      SET amount_cents = v_amount_cents,
          effective_to = v_effective_to,
          rate_confirmed = v_rate_confirmed,
          approved_by = v_approved_by,
          approved_at = v_approved_at,
          notes = v_notes,
          updated_at = now()
      WHERE id = v_existing_id;

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
          v_promoted_from_module_value_id,
          'rate_schedule_versions',
          v_existing_id::text,
          'update',
          v_existing_before,
          v_update_payload
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

REVOKE ALL ON FUNCTION public.promote_facility_launch_m6_rates(
  uuid, uuid, uuid, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.promote_facility_launch_m6_rates(
  uuid, uuid, uuid, uuid, jsonb
) TO service_role;
