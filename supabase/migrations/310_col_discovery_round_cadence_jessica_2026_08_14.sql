-- COL owner decision 2026-08-14: Jessica Murphy binding discovery-round cadence for training week.
-- Replaces migration 219 12-hour visibility and Plantation wing stagger defaults.

CREATE OR REPLACE FUNCTION haven._col_discovery_discrete_rule(
  p_scheduled_time time,
  p_shift text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'interval_type', 'daypart',
    'interval_minutes', NULL,
    'shift', p_shift,
    'daypart_start', to_char(p_scheduled_time, 'HH24:MI'),
    'daypart_end', to_char(p_scheduled_time + interval '5 minutes', 'HH24:MI'),
    'days_of_week', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
    'grace_minutes', 30,
    'required_fields_schema', jsonb_build_object(
      'scheduled_time', to_char(p_scheduled_time, 'HH24:MI'),
      'shift', p_shift,
      'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
      'vocab_source', 'observation_vocab'
    ),
    'escalation_policy_key', 'resident-assurance-standard',
    'sort_order', p_sort_order,
    'active', true
  );
$$;

CREATE OR REPLACE FUNCTION haven._col_discovery_standard_preset_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    haven._col_discovery_discrete_rule('06:00'::time, 'day', 0),
    haven._col_discovery_discrete_rule('10:00'::time, 'day', 1),
    haven._col_discovery_discrete_rule('14:00'::time, 'day', 2),
    haven._col_discovery_discrete_rule('17:30'::time, 'day', 3),
    haven._col_discovery_discrete_rule('18:00'::time, 'night', 4),
    haven._col_discovery_discrete_rule('22:00'::time, 'night', 5),
    haven._col_discovery_discrete_rule('05:30'::time, 'night', 6)
  );
$$;

CREATE OR REPLACE FUNCTION haven._col_discovery_homewood_preset_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_array(
    haven._col_discovery_discrete_rule('06:00'::time, 'day', 0),
    haven._col_discovery_discrete_rule('10:00'::time, 'day', 1),
    haven._col_discovery_discrete_rule('14:00'::time, 'day', 2),
    haven._col_discovery_discrete_rule('17:30'::time, 'day', 3),
    jsonb_build_object(
      'interval_type', 'fixed_minutes',
      'interval_minutes', 120,
      'shift', 'night',
      'daypart_start', '18:00',
      'daypart_end', '06:00',
      'days_of_week', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'grace_minutes', 30,
      'required_fields_schema', jsonb_build_object(
        'shift', 'night',
        'interval_minutes', 120,
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      ),
      'escalation_policy_key', 'resident-assurance-standard',
      'sort_order', 4,
      'active', true
    )
  );
$$;

UPDATE public.resident_observation_templates
SET
  active = false,
  deleted_at = now(),
  updated_at = now()
WHERE organization_id = '00000000-0000-0000-0000-000000000001'
  AND deleted_at IS NULL
  AND name IN (
    'COL Standard 12-Hour Rounds',
    'COL Homewood Standard Day + Night Rounds',
    'COL Plantation Wing Rounds'
  );

WITH template_seed AS (
  SELECT
    f.organization_id,
    f.entity_id,
    f.id AS facility_id,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN 'COL Discovery Rounds — Day + Two-Hour Night'
      WHEN f.name = 'Plantation ALF' THEN 'COL Discovery Rounds (cadence pending)'
      ELSE 'COL Discovery Rounds — Day + Night'
    END AS name,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN
        'Homewood: Jessica cadence — day 6:00/10:00/14:00/17:30 plus two-hour overnight checks 18:00–06:00. Apply per resident when activated.'
      WHEN f.name = 'Plantation ALF' THEN
        'Plantation cadence pending owner decision — do not apply invented wing or 8-hour stagger schedules.'
      ELSE
        'Jessica cadence — day 6:00/10:00/14:00/17:30; night 18:00/22:00/05:30. Apply per resident when activated.'
    END AS description,
    'routine_rounding'::text AS category,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN jsonb_build_object(
        'source', 'COL owner decision 2026-08-14',
        'template_type', 'facility_default',
        'cadence_profile', 'homewood_two_hour_night',
        'rules', haven._col_discovery_homewood_preset_rules(),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      WHEN f.name = 'Plantation ALF' THEN jsonb_build_object(
        'source', 'COL owner decision 2026-08-14',
        'template_type', 'pending_owner_cadence',
        'cadence_profile', 'pending',
        'rules', '[]'::jsonb,
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      ELSE jsonb_build_object(
        'source', 'COL owner decision 2026-08-14',
        'template_type', 'facility_default',
        'cadence_profile', 'standard_day_night',
        'rules', haven._col_discovery_standard_preset_rules(),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
    END AS preset_definition,
    CASE
      WHEN f.name = 'Plantation ALF' THEN false
      ELSE true
    END AS active
  FROM public.facilities f
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN (
      'Oakridge ALF',
      'Rising Oaks ALF',
      'Homewood Lodge ALF',
      'Plantation ALF',
      'Grande Cypress ALF'
    )
)
INSERT INTO public.resident_observation_templates (
  organization_id,
  entity_id,
  facility_id,
  name,
  description,
  category,
  preset_definition,
  active
)
SELECT
  organization_id,
  entity_id,
  facility_id,
  name,
  description,
  category,
  preset_definition,
  active
FROM template_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.resident_observation_templates existing
  WHERE existing.organization_id = s.organization_id
    AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
    AND existing.name = s.name
    AND existing.deleted_at IS NULL
);

WITH template_seed AS (
  SELECT
    f.organization_id,
    f.entity_id,
    f.id AS facility_id,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN 'COL Discovery Rounds — Day + Two-Hour Night'
      WHEN f.name = 'Plantation ALF' THEN 'COL Discovery Rounds (cadence pending)'
      ELSE 'COL Discovery Rounds — Day + Night'
    END AS name,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN
        'Homewood: Jessica cadence — day 6:00/10:00/14:00/17:30 plus two-hour overnight checks 18:00–06:00. Apply per resident when activated.'
      WHEN f.name = 'Plantation ALF' THEN
        'Plantation cadence pending owner decision — do not apply invented wing or 8-hour stagger schedules.'
      ELSE
        'Jessica cadence — day 6:00/10:00/14:00/17:30; night 18:00/22:00/05:30. Apply per resident when activated.'
    END AS description,
    'routine_rounding'::text AS category,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN jsonb_build_object(
        'source', 'COL owner decision 2026-08-14',
        'template_type', 'facility_default',
        'cadence_profile', 'homewood_two_hour_night',
        'rules', haven._col_discovery_homewood_preset_rules(),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      WHEN f.name = 'Plantation ALF' THEN jsonb_build_object(
        'source', 'COL owner decision 2026-08-14',
        'template_type', 'pending_owner_cadence',
        'cadence_profile', 'pending',
        'rules', '[]'::jsonb,
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      ELSE jsonb_build_object(
        'source', 'COL owner decision 2026-08-14',
        'template_type', 'facility_default',
        'cadence_profile', 'standard_day_night',
        'rules', haven._col_discovery_standard_preset_rules(),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
    END AS preset_definition,
    CASE
      WHEN f.name = 'Plantation ALF' THEN false
      ELSE true
    END AS active
  FROM public.facilities f
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN (
      'Oakridge ALF',
      'Rising Oaks ALF',
      'Homewood Lodge ALF',
      'Plantation ALF',
      'Grande Cypress ALF'
    )
)
UPDATE public.resident_observation_templates existing
SET
  description = s.description,
  category = s.category,
  preset_definition = s.preset_definition,
  active = s.active,
  deleted_at = NULL,
  updated_at = now()
FROM template_seed s
WHERE existing.organization_id = s.organization_id
  AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
  AND existing.name = s.name
  AND existing.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.apply_plantation_wing_observation_plan(p_resident_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
BEGIN
  RAISE EXCEPTION
    'Plantation ALF discovery round cadence is pending owner decision. Do not apply migration 219 wing stagger defaults.'
    USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) IS
  'Blocked until Jessica Murphy supplies Plantation cadence. Migration 219 wing defaults are not operator defaults.';

CREATE OR REPLACE FUNCTION public.apply_col_discovery_round_observation_plan(p_resident_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_org_id uuid;
  v_entity_id uuid;
  v_facility_id uuid;
  v_facility_name text;
  v_plan_id uuid;
  v_existing_plan_id uuid;
  v_profile text;
  v_rule jsonb;
  v_sort_order integer := 0;
  v_is_service_role boolean;
BEGIN
  v_is_service_role := COALESCE(auth.role() = 'service_role', false);

  SELECT
    res.organization_id,
    fac.entity_id,
    res.facility_id,
    fac.name
  INTO v_org_id, v_entity_id, v_facility_id, v_facility_name
  FROM public.residents res
  JOIN public.facilities fac ON fac.id = res.facility_id AND fac.deleted_at IS NULL
  WHERE res.id = p_resident_id
    AND res.deleted_at IS NULL
    AND fac.organization_id = '00000000-0000-0000-0000-000000000001';

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'Resident % is not assigned to an active COL facility', p_resident_id
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service_role AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT v_is_service_role AND haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin', 'nurse') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_service_role AND NOT haven.has_facility_access(v_facility_id) THEN
    RAISE EXCEPTION 'Facility access denied' USING ERRCODE = '42501';
  END IF;

  IF v_facility_name = 'Plantation ALF' THEN
    RAISE EXCEPTION
      'Plantation ALF discovery round cadence is pending owner decision. Do not apply invented defaults.'
      USING ERRCODE = '22023';
  END IF;

  v_profile := CASE
    WHEN v_facility_name = 'Homewood Lodge ALF' THEN 'homewood_two_hour_night'
    WHEN v_facility_name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Grande Cypress ALF') THEN 'standard_day_night'
    ELSE NULL
  END;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Facility % is not configured for COL discovery round cadence', v_facility_name
      USING ERRCODE = '22023';
  END IF;

  SELECT id
    INTO v_existing_plan_id
  FROM public.resident_observation_plans
  WHERE resident_id = p_resident_id
    AND facility_id = v_facility_id
    AND status = 'active'::public.resident_observation_plan_status
    AND source_type = 'policy'::public.resident_observation_source_type
    AND rationale = 'COL discovery rounds default (owner 2026-08-14)'
    AND deleted_at IS NULL
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_existing_plan_id IS NOT NULL THEN
    RETURN v_existing_plan_id;
  END IF;

  UPDATE public.resident_observation_plans
  SET
    status = 'ended'::public.resident_observation_plan_status,
    effective_to = now(),
    updated_at = now()
  WHERE resident_id = p_resident_id
    AND facility_id = v_facility_id
    AND status = 'active'::public.resident_observation_plan_status
    AND deleted_at IS NULL;

  INSERT INTO public.resident_observation_plans (
    organization_id,
    entity_id,
    facility_id,
    resident_id,
    status,
    source_type,
    effective_from,
    rationale,
    created_by
  ) VALUES (
    v_org_id,
    v_entity_id,
    v_facility_id,
    p_resident_id,
    'active'::public.resident_observation_plan_status,
    'policy'::public.resident_observation_source_type,
    now(),
    'COL discovery rounds default (owner 2026-08-14)',
    auth.uid()
  )
  RETURNING id INTO v_plan_id;

  FOR v_rule IN
    SELECT value
    FROM jsonb_array_elements(
      CASE
        WHEN v_profile = 'homewood_two_hour_night' THEN haven._col_discovery_homewood_preset_rules()
        ELSE haven._col_discovery_standard_preset_rules()
      END
    )
  LOOP
  INSERT INTO public.resident_observation_plan_rules (
    plan_id,
    organization_id,
    entity_id,
    facility_id,
    resident_id,
    interval_type,
    interval_minutes,
    shift,
    daypart_start,
    daypart_end,
    days_of_week,
    grace_minutes,
    required_fields_schema,
    escalation_policy_key,
    sort_order,
    active
  ) VALUES (
    v_plan_id,
    v_org_id,
    v_entity_id,
    v_facility_id,
    p_resident_id,
    (v_rule ->> 'interval_type')::public.resident_observation_interval_type,
    NULLIF(v_rule ->> 'interval_minutes', '')::integer,
    NULLIF(v_rule ->> 'shift', '')::public.shift_type,
    NULLIF(v_rule ->> 'daypart_start', '')::time,
    NULLIF(v_rule ->> 'daypart_end', '')::time,
    ARRAY(SELECT jsonb_array_elements_text(v_rule -> 'days_of_week')::integer),
    COALESCE((v_rule ->> 'grace_minutes')::integer, 30),
    COALESCE(v_rule -> 'required_fields_schema', '{}'::jsonb),
    COALESCE(v_rule ->> 'escalation_policy_key', 'resident-assurance-standard'),
    COALESCE((v_rule ->> 'sort_order')::integer, v_sort_order),
    COALESCE((v_rule ->> 'active')::boolean, true)
  );

    v_sort_order := v_sort_order + 1;
  END LOOP;

  RETURN v_plan_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_col_discovery_round_observation_plan(uuid) IS
  'Applies Jessica Murphy COL discovery-round cadence per resident. Plantation is blocked until owner supplies times.';
