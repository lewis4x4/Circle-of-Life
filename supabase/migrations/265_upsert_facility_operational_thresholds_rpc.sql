CREATE OR REPLACE FUNCTION public.upsert_facility_operational_thresholds(
  p_facility_id uuid,
  p_organization_id uuid,
  p_actor_id uuid,
  p_thresholds jsonb
)
RETURNS SETOF public.facility_operational_thresholds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold jsonb;
  v_id uuid;
  v_threshold_type text;
  v_yellow numeric;
  v_red numeric;
  v_notify_roles text[];
  v_enabled boolean;
  v_alert_frequency text;
  v_row public.facility_operational_thresholds%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_thresholds) <> 'array' THEN
    RAISE EXCEPTION 'p_thresholds must be a JSON array' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.facilities f
    WHERE f.id = p_facility_id
      AND f.organization_id = p_organization_id
      AND f.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Facility not found' USING ERRCODE = 'P0001';
  END IF;

  FOR v_threshold IN SELECT value FROM jsonb_array_elements(p_thresholds)
  LOOP
    v_id := NULLIF(v_threshold->>'id', '')::uuid;
    v_threshold_type := v_threshold->>'threshold_type';
    v_yellow := (v_threshold->>'yellow_threshold')::numeric;
    v_red := (v_threshold->>'red_threshold')::numeric;
    v_notify_roles := ARRAY(SELECT jsonb_array_elements_text(v_threshold->'notify_roles'));
    v_enabled := COALESCE((v_threshold->>'enabled')::boolean, true);
    v_alert_frequency := v_threshold->>'alert_frequency';

    IF v_id IS NOT NULL THEN
      UPDATE public.facility_operational_thresholds
      SET
        yellow_threshold = v_yellow,
        red_threshold = v_red,
        notify_roles = v_notify_roles,
        enabled = v_enabled,
        alert_frequency = v_alert_frequency,
        updated_at = now(),
        updated_by = p_actor_id
      WHERE id = v_id
        AND facility_id = p_facility_id
        AND organization_id = p_organization_id
      RETURNING * INTO v_row;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update threshold %', v_id USING ERRCODE = 'P0001';
      END IF;

      RETURN NEXT v_row;
      CONTINUE;
    END IF;

    INSERT INTO public.facility_operational_thresholds (
      facility_id,
      organization_id,
      threshold_type,
      yellow_threshold,
      red_threshold,
      notify_roles,
      enabled,
      alert_frequency,
      created_by,
      updated_by
    ) VALUES (
      p_facility_id,
      p_organization_id,
      v_threshold_type,
      v_yellow,
      v_red,
      v_notify_roles,
      v_enabled,
      v_alert_frequency,
      p_actor_id,
      p_actor_id
    )
    ON CONFLICT (facility_id, threshold_type)
    DO UPDATE SET
      yellow_threshold = EXCLUDED.yellow_threshold,
      red_threshold = EXCLUDED.red_threshold,
      notify_roles = EXCLUDED.notify_roles,
      enabled = EXCLUDED.enabled,
      alert_frequency = EXCLUDED.alert_frequency,
      updated_at = now(),
      updated_by = p_actor_id
    RETURNING * INTO v_row;

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_facility_operational_thresholds(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_facility_operational_thresholds(uuid, uuid, uuid, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_facility_operational_thresholds(uuid, uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_facility_operational_thresholds(uuid, uuid, uuid, jsonb) TO service_role;
