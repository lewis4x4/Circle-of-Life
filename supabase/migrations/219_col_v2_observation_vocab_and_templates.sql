-- COL v2 Slice 3: observation vocabulary, COL rounds templates, and resident-safe Plantation wing helper.
-- Uses the existing resident_observation_* engine. Does not insert NULL resident_id plans/rules.

CREATE TABLE IF NOT EXISTS public.observation_vocab (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  field_name text NOT NULL CHECK (field_name IN ('location', 'state', 'activity', 'position', 'intervention')),
  value_code text NOT NULL CHECK (value_code ~ '^[a-z0-9_]+$'),
  display_label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_oof boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, field_name, value_code)
);

CREATE INDEX IF NOT EXISTS idx_observation_vocab_org_field_active
  ON public.observation_vocab(organization_id, facility_id, field_name, display_order)
  WHERE deleted_at IS NULL AND active = true;

ALTER TABLE public.observation_vocab ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS observation_vocab_select ON public.observation_vocab;
CREATE POLICY observation_vocab_select ON public.observation_vocab
  FOR SELECT
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
  );

DROP POLICY IF EXISTS observation_vocab_manage ON public.observation_vocab;
CREATE POLICY observation_vocab_manage ON public.observation_vocab
  FOR ALL
  TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (
      facility_id IS NULL
      OR facility_id IN (SELECT haven.accessible_facility_ids())
    )
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager')
  );

DROP TRIGGER IF EXISTS tr_observation_vocab_set_updated_at ON public.observation_vocab;
CREATE TRIGGER tr_observation_vocab_set_updated_at
  BEFORE UPDATE ON public.observation_vocab
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_observation_vocab_audit ON public.observation_vocab;
CREATE TRIGGER tr_observation_vocab_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.observation_vocab
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

WITH vocab_seed AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS organization_id,
    NULL::uuid AS facility_id,
    v.field_name,
    v.value_code,
    v.display_label,
    v.display_order,
    v.is_oof
  FROM (VALUES
    -- Where the resident is.
    ('location', 'common_area',             'Common Area',                1, false),
    ('location', 'dining_room',             'Dining Room',                2, false),
    ('location', 'resident_room',           'Resident Room',              3, false),
    ('location', 'front_porch',             'Front Porch',                4, false),
    ('location', 'back_porch',              'Back Porch',                 5, false),
    ('location', 'activity_room',           'Activity Room',              6, false),
    ('location', 'bathroom',                'Bathroom',                   7, false),
    ('location', 'outside_courtyard',       'Outside/Courtyard',          8, false),
    ('location', 'oof_personal_errand',     'OOF — Personal Errand',      9, true),
    ('location', 'oof_medical_appointment', 'OOF — Medical Appointment', 10, true),
    ('location', 'oof_family_friends',      'OOF — Family/Friends',      11, true),
    ('location', 'oof_hospitalization',     'OOF — Hospitalization',     12, true),
    ('location', 'oof_day_treatment',       'OOF — Day Treatment',       13, true),
    ('location', 'oof_baker_act',           'OOF — Baker Act',           14, true),
    -- What the resident is doing / condition observed.
    ('state', 'participating_facility_activity', 'Participating in Facility Activity', 1, false),
    ('state', 'socializing_with_others',         'Socializing with Others',            2, false),
    ('state', 'watching_tv',                     'Watching TV',                        3, false),
    ('state', 'resting_in_bed',                  'Resting in Bed',                     4, false),
    ('state', 'sleeping',                        'Sleeping',                           5, false),
    ('state', 'individual_activity',             'Individual Activity',                6, false),
    ('state', 'eating_meal',                     'Eating Meal/Snack',                  7, false),
    ('state', 'in_bathroom',                     'In Bathroom',                        8, false),
    ('state', 'needs_assistance',                'Needs Assistance',                   9, false),
    ('state', 'distressed',                      'Distressed',                        10, false),
    ('state', 'not_found',                       'Not Found / Escalate',              11, false),
    -- Position / immediate intervention vocabulary.
    ('position', 'sitting',        'Sitting',                  1, false),
    ('position', 'lying_down',     'Lying Down',               2, false),
    ('position', 'standing',       'Standing',                 3, false),
    ('position', 'walking',        'Walking',                  4, false),
    ('position', 'wheelchair',     'In Wheelchair',            5, false),
    ('intervention', 'toileting_assisted', 'Toileting Assisted', 1, false),
    ('intervention', 'hydration_offered',  'Hydration Offered',  2, false),
    ('intervention', 'repositioned',       'Repositioned',       3, false),
    ('intervention', 'staff_notified',     'Staff Notified',     4, false),
    ('intervention', 'family_notified',    'Family Notified',    5, false)
  ) AS v(field_name, value_code, display_label, display_order, is_oof)
)
INSERT INTO public.observation_vocab (
  organization_id,
  facility_id,
  field_name,
  value_code,
  display_label,
  display_order,
  is_oof
)
SELECT
  organization_id,
  facility_id,
  field_name,
  value_code,
  display_label,
  display_order,
  is_oof
FROM vocab_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.observation_vocab existing
  WHERE existing.organization_id = s.organization_id
    AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
    AND existing.field_name = s.field_name
    AND existing.value_code = s.value_code
    AND existing.deleted_at IS NULL
);

WITH vocab_seed AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS organization_id,
    NULL::uuid AS facility_id,
    v.field_name,
    v.value_code,
    v.display_label,
    v.display_order,
    v.is_oof
  FROM (VALUES
    ('location', 'common_area',             'Common Area',                1, false),
    ('location', 'dining_room',             'Dining Room',                2, false),
    ('location', 'resident_room',           'Resident Room',              3, false),
    ('location', 'front_porch',             'Front Porch',                4, false),
    ('location', 'back_porch',              'Back Porch',                 5, false),
    ('location', 'activity_room',           'Activity Room',              6, false),
    ('location', 'bathroom',                'Bathroom',                   7, false),
    ('location', 'outside_courtyard',       'Outside/Courtyard',          8, false),
    ('location', 'oof_personal_errand',     'OOF — Personal Errand',      9, true),
    ('location', 'oof_medical_appointment', 'OOF — Medical Appointment', 10, true),
    ('location', 'oof_family_friends',      'OOF — Family/Friends',      11, true),
    ('location', 'oof_hospitalization',     'OOF — Hospitalization',     12, true),
    ('location', 'oof_day_treatment',       'OOF — Day Treatment',       13, true),
    ('location', 'oof_baker_act',           'OOF — Baker Act',           14, true),
    ('state', 'participating_facility_activity', 'Participating in Facility Activity', 1, false),
    ('state', 'socializing_with_others',         'Socializing with Others',            2, false),
    ('state', 'watching_tv',                     'Watching TV',                        3, false),
    ('state', 'resting_in_bed',                  'Resting in Bed',                     4, false),
    ('state', 'sleeping',                        'Sleeping',                           5, false),
    ('state', 'individual_activity',             'Individual Activity',                6, false),
    ('state', 'eating_meal',                     'Eating Meal/Snack',                  7, false),
    ('state', 'in_bathroom',                     'In Bathroom',                        8, false),
    ('state', 'needs_assistance',                'Needs Assistance',                   9, false),
    ('state', 'distressed',                      'Distressed',                        10, false),
    ('state', 'not_found',                       'Not Found / Escalate',              11, false),
    ('position', 'sitting',        'Sitting',                  1, false),
    ('position', 'lying_down',     'Lying Down',               2, false),
    ('position', 'standing',       'Standing',                 3, false),
    ('position', 'walking',        'Walking',                  4, false),
    ('position', 'wheelchair',     'In Wheelchair',            5, false),
    ('intervention', 'toileting_assisted', 'Toileting Assisted', 1, false),
    ('intervention', 'hydration_offered',  'Hydration Offered',  2, false),
    ('intervention', 'repositioned',       'Repositioned',       3, false),
    ('intervention', 'staff_notified',     'Staff Notified',     4, false),
    ('intervention', 'family_notified',    'Family Notified',    5, false)
  ) AS v(field_name, value_code, display_label, display_order, is_oof)
)
UPDATE public.observation_vocab existing
SET
  display_label = s.display_label,
  display_order = s.display_order,
  is_oof = s.is_oof,
  active = true,
  deleted_at = NULL,
  updated_at = now()
FROM vocab_seed s
WHERE existing.organization_id = s.organization_id
  AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
  AND existing.field_name = s.field_name
  AND existing.value_code = s.value_code;

WITH template_seed AS (
  SELECT
    f.organization_id,
    f.entity_id,
    f.id AS facility_id,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN 'COL Homewood Standard Day + Night Rounds'
      WHEN f.name = 'Plantation ALF' THEN 'COL Plantation Wing Rounds'
      ELSE 'COL Standard 12-Hour Rounds'
    END AS name,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN 'Homewood default: daytime 12-hour visibility plus night two-hour checks. Apply per resident when admitted/activated.'
      WHEN f.name = 'Plantation ALF' THEN 'Plantation default: wing-based staggered checks. Use apply_plantation_wing_observation_plan(resident_id) after bed assignment.'
      ELSE 'Standard COL facility default: 12-hour visibility checks. Apply per resident when admitted/activated.'
    END AS description,
    'routine_rounding'::text AS category,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN jsonb_build_object(
        'source', 'COL v2 Slice 3',
        'template_type', 'facility_default',
        'rules', jsonb_build_array(
          jsonb_build_object('interval_type', 'fixed_minutes', 'interval_minutes', 720, 'daypart_start', '06:00', 'daypart_end', '22:00', 'grace_minutes', 30),
          jsonb_build_object('interval_type', 'fixed_minutes', 'interval_minutes', 120, 'daypart_start', '22:00', 'daypart_end', '06:00', 'grace_minutes', 30)
        ),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      WHEN f.name = 'Plantation ALF' THEN jsonb_build_object(
        'source', 'COL v2 Slice 3',
        'template_type', 'wing_default',
        'wing_times', jsonb_build_object(
          'Wing 1', jsonb_build_array('00:00', '08:00', '16:00'),
          'Wing 2', jsonb_build_array('00:00', '08:00', '16:00'),
          'Wing 3', jsonb_build_array('03:00', '11:00', '19:00'),
          'Wing 4', jsonb_build_array('03:00', '11:00', '19:00'),
          'Wing 5', jsonb_build_array('06:00', '14:00', '22:00'),
          'Wing 6', jsonb_build_array('06:00', '14:00', '22:00')
        ),
        'implementation_note', 'Existing enum has no fixed_times value; helper creates one daypart rule per scheduled time.',
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      ELSE jsonb_build_object(
        'source', 'COL v2 Slice 3',
        'template_type', 'facility_default',
        'rules', jsonb_build_array(
          jsonb_build_object('interval_type', 'fixed_minutes', 'interval_minutes', 720, 'grace_minutes', 30)
        ),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
    END AS preset_definition
  FROM public.facilities f
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Homewood Lodge ALF', 'Plantation ALF', 'Grande Cypress ALF')
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
  true
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
      WHEN f.name = 'Homewood Lodge ALF' THEN 'COL Homewood Standard Day + Night Rounds'
      WHEN f.name = 'Plantation ALF' THEN 'COL Plantation Wing Rounds'
      ELSE 'COL Standard 12-Hour Rounds'
    END AS name,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN 'Homewood default: daytime 12-hour visibility plus night two-hour checks. Apply per resident when admitted/activated.'
      WHEN f.name = 'Plantation ALF' THEN 'Plantation default: wing-based staggered checks. Use apply_plantation_wing_observation_plan(resident_id) after bed assignment.'
      ELSE 'Standard COL facility default: 12-hour visibility checks. Apply per resident when admitted/activated.'
    END AS description,
    'routine_rounding'::text AS category,
    CASE
      WHEN f.name = 'Homewood Lodge ALF' THEN jsonb_build_object(
        'source', 'COL v2 Slice 3',
        'template_type', 'facility_default',
        'rules', jsonb_build_array(
          jsonb_build_object('interval_type', 'fixed_minutes', 'interval_minutes', 720, 'daypart_start', '06:00', 'daypart_end', '22:00', 'grace_minutes', 30),
          jsonb_build_object('interval_type', 'fixed_minutes', 'interval_minutes', 120, 'daypart_start', '22:00', 'daypart_end', '06:00', 'grace_minutes', 30)
        ),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      WHEN f.name = 'Plantation ALF' THEN jsonb_build_object(
        'source', 'COL v2 Slice 3',
        'template_type', 'wing_default',
        'wing_times', jsonb_build_object(
          'Wing 1', jsonb_build_array('00:00', '08:00', '16:00'),
          'Wing 2', jsonb_build_array('00:00', '08:00', '16:00'),
          'Wing 3', jsonb_build_array('03:00', '11:00', '19:00'),
          'Wing 4', jsonb_build_array('03:00', '11:00', '19:00'),
          'Wing 5', jsonb_build_array('06:00', '14:00', '22:00'),
          'Wing 6', jsonb_build_array('06:00', '14:00', '22:00')
        ),
        'implementation_note', 'Existing enum has no fixed_times value; helper creates one daypart rule per scheduled time.',
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
      ELSE jsonb_build_object(
        'source', 'COL v2 Slice 3',
        'template_type', 'facility_default',
        'rules', jsonb_build_array(
          jsonb_build_object('interval_type', 'fixed_minutes', 'interval_minutes', 720, 'grace_minutes', 30)
        ),
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      )
    END AS preset_definition
  FROM public.facilities f
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Homewood Lodge ALF', 'Plantation ALF', 'Grande Cypress ALF')
)
UPDATE public.resident_observation_templates existing
SET
  description = s.description,
  category = s.category,
  preset_definition = s.preset_definition,
  active = true,
  deleted_at = NULL,
  updated_at = now()
FROM template_seed s
WHERE existing.organization_id = s.organization_id
  AND existing.facility_id IS NOT DISTINCT FROM s.facility_id
  AND existing.name = s.name;

CREATE OR REPLACE FUNCTION public.apply_plantation_wing_observation_plan(p_resident_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, haven
AS $$
DECLARE
  v_org_id uuid;
  v_entity_id uuid;
  v_facility_id uuid;
  v_wing_name text;
  v_plan_id uuid;
  v_existing_plan_id uuid;
  v_times time[];
  v_time time;
  v_sort_order integer := 0;
BEGIN
  SELECT
    res.organization_id,
    fac.entity_id,
    res.facility_id,
    unit.name
  INTO v_org_id, v_entity_id, v_facility_id, v_wing_name
  FROM public.residents res
  JOIN public.beds bed ON bed.id = res.bed_id AND bed.deleted_at IS NULL
  JOIN public.rooms room ON room.id = bed.room_id AND room.deleted_at IS NULL
  JOIN public.units unit ON unit.id = room.unit_id AND unit.deleted_at IS NULL
  JOIN public.facilities fac ON fac.id = res.facility_id AND fac.deleted_at IS NULL
  WHERE res.id = p_resident_id
    AND res.deleted_at IS NULL
    AND fac.organization_id = '00000000-0000-0000-0000-000000000001'
    AND fac.name = 'Plantation ALF';

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'Resident % is not assigned to an active Plantation wing bed', p_resident_id
      USING ERRCODE = '22023';
  END IF;

  v_times := CASE v_wing_name
    WHEN 'Wing 1' THEN ARRAY['00:00'::time, '08:00'::time, '16:00'::time]
    WHEN 'Wing 2' THEN ARRAY['00:00'::time, '08:00'::time, '16:00'::time]
    WHEN 'Wing 3' THEN ARRAY['03:00'::time, '11:00'::time, '19:00'::time]
    WHEN 'Wing 4' THEN ARRAY['03:00'::time, '11:00'::time, '19:00'::time]
    WHEN 'Wing 5' THEN ARRAY['06:00'::time, '14:00'::time, '22:00'::time]
    WHEN 'Wing 6' THEN ARRAY['06:00'::time, '14:00'::time, '22:00'::time]
    ELSE NULL
  END;

  IF v_times IS NULL THEN
    RAISE EXCEPTION 'Unsupported Plantation wing % for resident %', v_wing_name, p_resident_id
      USING ERRCODE = '22023';
  END IF;

  SELECT id
    INTO v_existing_plan_id
  FROM public.resident_observation_plans
  WHERE resident_id = p_resident_id
    AND facility_id = v_facility_id
    AND status = 'active'::public.resident_observation_plan_status
    AND source_type = 'policy'::public.resident_observation_source_type
    AND rationale = 'COL Plantation ' || v_wing_name || ' default rounds'
    AND deleted_at IS NULL
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_existing_plan_id IS NOT NULL THEN
    RETURN v_existing_plan_id;
  END IF;

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
    'COL Plantation ' || v_wing_name || ' default rounds',
    auth.uid()
  )
  RETURNING id INTO v_plan_id;

  FOREACH v_time IN ARRAY v_times LOOP
    v_sort_order := v_sort_order + 1;

    INSERT INTO public.resident_observation_plan_rules (
      plan_id,
      organization_id,
      entity_id,
      facility_id,
      resident_id,
      interval_type,
      interval_minutes,
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
      'daypart'::public.resident_observation_interval_type,
      NULL,
      v_time,
      v_time + interval '5 minutes',
      ARRAY[1,2,3,4,5,6,7],
      30,
      jsonb_build_object(
        'scheduled_time', to_char(v_time, 'HH24:MI'),
        'wing', v_wing_name,
        'required_fields', jsonb_build_array('resident_location', 'resident_state', 'quick_status'),
        'vocab_source', 'observation_vocab'
      ),
      'resident-assurance-standard',
      v_sort_order,
      true
    );
  END LOOP;

  RETURN v_plan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.observation_vocab IS
  'Dropdown vocabulary for resident observation logs. Org-wide rows use facility_id NULL; facility-specific overrides may be added later.';

COMMENT ON FUNCTION public.apply_plantation_wing_observation_plan(uuid) IS
  'Creates a resident-specific Plantation observation plan from the resident bed -> room -> unit wing. Uses existing daypart enum because fixed_times is not a valid interval type.';
