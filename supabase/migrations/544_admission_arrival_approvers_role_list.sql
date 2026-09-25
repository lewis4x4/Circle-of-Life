-- COL-333 (part of COL-749): an Assistant Administrator may approve an arrival.
--
-- Brian, 2026-09-25: the Assistant Administrator (admin_assistant) can approve a
-- move-in. Migration 534 made admissions.arrival_approval_roles a rule that
-- could narrow owner, org_admin and facility_admin but never add to them, and
-- 538's haven.admission_arrival_approval_roles dropped any other role it found.
-- That was a ceiling written into code. Under Brian's standing rule (business
-- decisions are data, effective dated), who approves is now an ordinary role
-- list:
--
--   1. The validator (542's text, one branch changed) accepts any non-empty
--      list, without repeats, of the roles that can open a case's arrival at
--      all: owner, org_admin, facility_admin, admin_assistant, manager,
--      coordinator and med_tech (the read roles of admission_arrival_approvals,
--      538). A recruiter or any other role still cannot be listed, and the
--      approval still cannot be switched off.
--   2. haven.admission_arrival_approval_roles reads the list as written, kept
--      to those same roles, and falls back to the resolver's default.
--   3. The resolver's built-in default (542's text, one line changed) becomes
--      owner, org_admin, facility_admin and admin_assistant.
--   4. A new organization row, effective 2026-09-26, with those four roles. The
--      table is append only and each organization already has a 2026-09-25
--      row, so the ruling takes effect from the next day; the 2026-09-25 row
--      stays as history. A facility's own row, if any, still wins there.
--
-- The same list decides who may withdraw an approval and who may reverse an
-- arrival (538, 539), so an Assistant Administrator gains those too. Who may
-- confirm the arrival (538) is unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION haven.operating_rules_validate_row()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v jsonb := NEW.value;
  k text;
BEGIN
  IF NEW.rule_key = 'risk.score_bands' THEN
    IF jsonb_typeof(v) <> 'object' THEN
      RAISE EXCEPTION 'Risk score bands must be an object' USING ERRCODE = '22023';
    END IF;
    FOR k IN SELECT jsonb_object_keys(v) LOOP
      IF k NOT IN ('critical_below', 'high_below', 'moderate_below') THEN
        RAISE EXCEPTION 'Unknown risk band %', k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_typeof(v->'critical_below') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v->'high_below') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v->'moderate_below') IS DISTINCT FROM 'number'
      OR (v->>'critical_below') !~ '^[0-9]+$'
      OR (v->>'high_below') !~ '^[0-9]+$'
      OR (v->>'moderate_below') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Risk bands need whole-number critical_below, high_below and moderate_below' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      (v->>'critical_below')::int >= 1
      AND (v->>'critical_below')::int < (v->>'high_below')::int
      AND (v->>'high_below')::int < (v->>'moderate_below')::int
      AND (v->>'moderate_below')::int <= 100
    ) THEN
      RAISE EXCEPTION 'Risk bands must rise: 1 <= critical < high < moderate <= 100' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'survey_binder.due_window_days' THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 1 AND 365 THEN
      RAISE EXCEPTION 'The survey binder window must be a whole number of days from 1 to 365' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'compliance.score_alert_below_pct' THEN
    IF jsonb_typeof(v) = 'null' THEN
      RETURN NEW;
    END IF;
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'The compliance alert threshold must be off (null) or a whole percentage from 1 to 100' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'resident_movement.backdate_window_days' THEN
    -- 0 is a real setting: only an owner or org admin may back-date at all.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 365 THEN
      RAISE EXCEPTION 'The movement back-date window must be a whole number of days from 0 to 365' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_reason_window_days' THEN
    -- 0 is a real setting: a reason never keeps a disagreement explained.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 60 THEN
      RAISE EXCEPTION 'The census reason window must be a whole number of days from 0 to 60' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_notice_lead_minutes' THEN
    -- 0 is a real setting: the only notice goes out at the deadline.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 1440 THEN
      RAISE EXCEPTION 'The census notice lead time must be a whole number of minutes from 0 to 1440' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_notice_roles' THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'string'
         OR r #>> '{}' NOT IN ('owner', 'org_admin', 'facility_admin', 'manager', 'admin_assistant')) THEN
      RAISE EXCEPTION 'Census notices go to one or more of: owner, org_admin, facility_admin, manager, admin_assistant' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_reason_options' THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 12
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(r)) <> 2 OR NOT r ?& ARRAY['key', 'label']
         OR jsonb_typeof(r -> 'key') <> 'string' OR jsonb_typeof(r -> 'label') <> 'string'
         OR (r ->> 'key') !~ '^[a-z][a-z0-9_]{0,39}$'
         OR char_length(btrim(r ->> 'label')) NOT BETWEEN 1 AND 80 OR (r ->> 'label') <> btrim(r ->> 'label'))
       OR (SELECT count(DISTINCT r ->> 'key') FROM jsonb_array_elements(v) r) <> jsonb_array_length(v)
       OR (SELECT count(DISTINCT lower(r ->> 'label')) FROM jsonb_array_elements(v) r) <> jsonb_array_length(v) THEN
      RAISE EXCEPTION 'Census reasons must be 1 to 12 entries, each with a unique lowercase key (letters, digits, underscores) and a unique label of 1 to 80 characters' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.census_notice_channels' THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'string')
       OR (SELECT count(DISTINCT r #>> '{}') FROM jsonb_array_elements(v) r) <> jsonb_array_length(v) THEN
      RAISE EXCEPTION 'Census notice delivery must be a list of channels' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE r #>> '{}' IN ('push', 'sms')) THEN
      RAISE EXCEPTION 'Push and text delivery of census notices are not available yet; census notices are delivered in Haven (in_app)' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE r #>> '{}' <> 'in_app') THEN
      RAISE EXCEPTION 'Unknown census notice channel' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key IN ('stand_up.thursday_census_vs_monday', 'stand_up.thursday_admission_notes_to_recruiters',
      'stand_up.census_bridge_hospital_in_census', 'stand_up.thursday_admission_workflow_to_recruiters') THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'This rule is on (true) or off (false)' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'stand_up.thursday_bridge_tolerance' THEN
    -- 0 is the default: Thursday must equal the expected census exactly.
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' OR v::text !~ '^[0-9]+$' OR v::text::int NOT BETWEEN 0 AND 20 THEN
      RAISE EXCEPTION 'The census bridge tolerance must be a whole number of residents from 0 to 20' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'admissions.arrival_approval_roles' THEN
    -- Any role that can open a case's arrival (the read roles of 538's
    -- approvals table); never empty, never a repeat.
    IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'string'
         OR r #>> '{}' NOT IN ('owner', 'org_admin', 'facility_admin', 'admin_assistant', 'manager', 'coordinator', 'med_tech'))
       OR (SELECT count(DISTINCT r #>> '{}') FROM jsonb_array_elements(v) r) <> jsonb_array_length(v) THEN
      RAISE EXCEPTION 'Arrival approval needs one or more of: owner, org_admin, facility_admin, admin_assistant, manager, coordinator, med_tech, each once. The approval itself cannot be switched off.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION haven.operating_rules_validate_row() FROM PUBLIC, anon, authenticated;

-- Migration 542's resolver, with admin_assistant in the arrival approvers.
CREATE OR REPLACE FUNCTION public.haven_operating_rule(
  p_organization_id uuid,
  p_facility_id uuid,
  p_rule_key text,
  p_as_of date
)
RETURNS TABLE (value jsonb, rule_id uuid, effective_from date, facility_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    coalesce(r.value, CASE p_rule_key
      WHEN 'risk.score_bands' THEN '{"critical_below": 50, "high_below": 70, "moderate_below": 85}'::jsonb
      WHEN 'survey_binder.due_window_days' THEN '60'::jsonb
      WHEN 'resident_movement.backdate_window_days' THEN '3'::jsonb
      WHEN 'stand_up.census_reason_window_days' THEN '7'::jsonb
      WHEN 'stand_up.census_notice_lead_minutes' THEN '60'::jsonb
      WHEN 'stand_up.census_notice_roles' THEN '["facility_admin", "admin_assistant", "manager"]'::jsonb
      WHEN 'stand_up.census_reason_options' THEN '[{"key": "roster_not_current", "label": "Roster not updated yet"}, {"key": "change_not_entered", "label": "Admission or discharge not entered in Haven"}, {"key": "different_definition", "label": "Workbook counts census differently"}, {"key": "other", "label": "Other"}]'::jsonb
      WHEN 'stand_up.census_notice_channels' THEN '["in_app"]'::jsonb
      WHEN 'stand_up.thursday_census_vs_monday' THEN 'true'::jsonb
      WHEN 'stand_up.thursday_admission_notes_to_recruiters' THEN 'false'::jsonb
      WHEN 'admissions.arrival_approval_roles' THEN '["owner", "org_admin", "facility_admin", "admin_assistant"]'::jsonb
      WHEN 'stand_up.thursday_bridge_tolerance' THEN '0'::jsonb
      WHEN 'stand_up.census_bridge_hospital_in_census' THEN 'true'::jsonb
      WHEN 'stand_up.thursday_admission_workflow_to_recruiters' THEN 'true'::jsonb
      ELSE 'null'::jsonb
    END),
    r.id,
    r.effective_from,
    r.facility_id
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT o.value, o.id, o.effective_from, o.facility_id
    FROM public.operating_rules o
    WHERE o.organization_id = coalesce(p_organization_id, haven.organization_id())
      AND o.rule_key = p_rule_key
      AND (o.facility_id = p_facility_id OR o.facility_id IS NULL)
      AND o.effective_from <= p_as_of
    ORDER BY (o.facility_id IS NOT NULL) DESC, o.effective_from DESC, o.created_at DESC
    LIMIT 1
  ) r ON true
$$;

CREATE OR REPLACE FUNCTION haven.admission_arrival_approval_roles(p_organization uuid, p_facility uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(nullif((SELECT array_agg(x #>> '{}') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.value) = 'array' THEN o.value ELSE '[]'::jsonb END) x
    WHERE x #>> '{}' IN ('owner', 'org_admin', 'facility_admin', 'admin_assistant', 'manager', 'coordinator', 'med_tech')), '{}'),
    ARRAY['owner', 'org_admin', 'facility_admin', 'admin_assistant'])
  FROM public.haven_operating_rule(p_organization, p_facility, 'admissions.arrival_approval_roles', (clock_timestamp() AT TIME ZONE 'America/New_York')::date) o
$$;
REVOKE ALL ON FUNCTION haven.admission_arrival_approval_roles(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
SELECT o.id, NULL, 'admissions.arrival_approval_roles', '["owner", "org_admin", "facility_admin", "admin_assistant"]'::jsonb, DATE '2026-09-26',
  'Brian''s ruling, 2026-09-25 (COL-333, applied by migration 544): the Assistant Administrator (admin_assistant) can approve a move-in. Who approves is an ordinary role list; the approval itself stays required.'
FROM public.organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 542's haven.operating_rules_validate_row and
-- public.haven_operating_rule and migration 538's
-- haven.admission_arrival_approval_roles, and delete the 2026-09-26
-- admissions.arrival_approval_roles rows this migration wrote (export them
-- first; they are the record of the ruling). The 2026-09-25 rows then apply.
