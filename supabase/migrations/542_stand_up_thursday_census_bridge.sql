-- COL-555 / COL-754 (part of COL-749): the Thursday census bridge.
--
-- Brian, 2026-09-25 (ruling 3 on the batch-2 questions): flag Thursday against
-- Monday, but never on a raw difference, because movements between Monday and
-- Thursday are legitimate. Show a bridge per building instead:
--
--   Monday submitted + arrivals - departures - hospital/rehab out + returns
--     = expected Thursday, next to Thursday's actual census.
--
-- Matching is green with a check; a gap is red with its number, and it opens the
-- same Reconcile path (fix the movement or the roster first, a reason second).
-- The tolerance is a setting, default 0.
--
--   1. haven.stand_up_census_bridge(org, facility, week, now): derived on read,
--      never stored. Monday is the latest submitted revision of that week's
--      Monday report (as of when its figures were given). Thursday is the
--      Thursday report's current revision (as of when its figures were given);
--      before Thursday has figures, the bridge runs to now. The movements are
--      the resident status changes whose effective date (COL-750, migration 504)
--      falls after Monday's figures and on or before Thursday's:
--        arrival      from outside the census into it
--        departure    from the census to outside it (discharge, death)
--        hospital out from in house or leave to a hospital or rehab stay
--        return       from a hospital or rehab stay back in house or on leave
--      A hospital-to-rehab move is the same trip and counts as neither.
--      Counting transitions, not rows, means the bridge balances with the
--      roster by construction: the roster at Thursday minus the roster at Monday
--      is exactly arrivals minus departures (both are returned, so a reader can
--      check it).
--
--   2. Whether a hospital or rehab stay moves the census is itself a setting,
--      stand_up.census_bridge_hospital_in_census. Haven's roster census counts
--      residents at a hospital or in rehab (COL-351: in house, hospital and
--      leave together), and the Monday and Thursday forms are held to that
--      roster, so the default is true: the bridge shows hospital or rehab out
--      and returns, and they do not change the expected census. A facility that
--      counts census without its hospital stays sets it to false, and the
--      bridge subtracts the stays and adds the returns exactly as Brian wrote
--      it. (That definition is COL-374's question for Brian.)
--
--   3. stand_up.thursday_bridge_tolerance (whole number 0 to 20, default 0):
--      how far Thursday may be from the expected figure and still match.
--
--   4. The flag uses the bridge and never a raw difference. The census
--      disagreement's Thursday-against-Monday figure (535) now compares
--      Thursday with the bridge's expected census and hospital figures, within
--      the tolerance. stand_up.thursday_census_vs_monday is switched on for
--      every organization from 2026-09-26 (a new dated row; the 2026-09-25
--      "off" row stays as history), and the resolver's default becomes on.
--
--   5. The notice sweep words a Monday comparison as the bridge.
--
--   6. Registry: the two bridge settings, and
--      stand_up.thursday_admission_workflow_to_recruiters for migration 543.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
ALTER TABLE public.operating_rules DROP CONSTRAINT IF EXISTS operating_rules_rule_key_check;
ALTER TABLE public.operating_rules ADD CONSTRAINT operating_rules_rule_key_check CHECK (rule_key IN (
  'risk.score_bands',
  'survey_binder.due_window_days',
  'compliance.score_alert_below_pct',
  'resident_movement.backdate_window_days',
  'stand_up.census_reason_window_days',
  'stand_up.census_notice_lead_minutes',
  'stand_up.census_notice_roles',
  'stand_up.census_reason_options',
  'stand_up.census_notice_channels',
  'stand_up.thursday_census_vs_monday',
  'stand_up.thursday_admission_notes_to_recruiters',
  'admissions.arrival_approval_roles',
  'stand_up.thursday_bridge_tolerance',
  'stand_up.census_bridge_hospital_in_census',
  'stand_up.thursday_admission_workflow_to_recruiters'
));

-- Migration 534's validator, plus the three new keys.
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
    IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) r WHERE jsonb_typeof(r) <> 'string'
         OR r #>> '{}' NOT IN ('owner', 'org_admin', 'facility_admin')) THEN
      RAISE EXCEPTION 'Arrival approval needs one or more of: owner, org_admin, facility_admin. The approval itself cannot be switched off.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION haven.operating_rules_validate_row() FROM PUBLIC, anon, authenticated;

-- Migration 541's resolver, with the new defaults and the Monday check on.
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
      WHEN 'admissions.arrival_approval_roles' THEN '["owner", "org_admin", "facility_admin"]'::jsonb
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

INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
SELECT o.id, NULL, k.rule_key, k.value, k.effective_from, k.reason
FROM public.organizations o
CROSS JOIN (VALUES
  ('stand_up.thursday_bridge_tolerance', '0'::jsonb, DATE '2026-09-25',
   'Brian''s ruling, 2026-09-25 (COL-749 ruling 3, migration 542): Thursday''s census is flagged against a bridge from Monday, never a raw difference. "The tolerance is a setting, default 0": Thursday must equal Monday + arrivals - departures - hospital/rehab out + returns.'),
  ('stand_up.census_bridge_hospital_in_census', 'true'::jsonb, DATE '2026-09-25',
   'Seeded by migration 542 (COL-749): proposed default. Haven''s roster census counts residents at a hospital or in rehab (COL-351), and Stand Up census is held to it, so a hospital or rehab stay and its return are shown on the bridge but do not change the expected census. Set to false for a census that leaves hospital stays out (COL-374).'),
  ('stand_up.thursday_admission_workflow_to_recruiters', 'true'::jsonb, DATE '2026-09-25',
   'Brian''s ruling, 2026-09-25 (COL-749 ruling 4, migration 542): recruiters see admission notes on the Thursday report; "they are working with the admins to get them pushed through and in the building." This switch covers the non-clinical admission workflow (status changes, blocks, quoted-rate notes and non-clinical checklist notes). Clinical categories stay behind stand_up.thursday_admission_notes_to_recruiters until Brian rules on them.'),
  ('stand_up.thursday_census_vs_monday', 'true'::jsonb, DATE '2026-09-26',
   'Brian''s ruling, 2026-09-25 (COL-749 ruling 3, migration 542): "Flag it." Thursday is checked against Monday through the census bridge (Monday submitted + arrivals - departures - hospital/rehab out + returns = expected Thursday), never a raw difference. On from 2026-09-26; the 2026-09-25 row keeps the earlier default.')
) AS k(rule_key, value, effective_from, reason)
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The bridge
-- ---------------------------------------------------------------------------
-- Internal. Callers (the disagreement, the Thursday report) decide who may read
-- it. Counts only: no resident is named.
CREATE FUNCTION haven.stand_up_census_bridge(p_organization uuid, p_facility uuid, p_week date, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := (p_now AT TIME ZONE 'America/New_York')::date;
  monday_rev record; thursday record; rule jsonb;
  from_at timestamptz; to_at timestamptz; tolerance integer; hospital_in_census boolean;
  m_census integer; m_hospital integer; actual integer; actual_hospital integer;
  arrivals integer := 0; arrivals_to_hospital integer := 0; departures integer := 0; departures_from_hospital integer := 0;
  hospital_out integer := 0; returns integer := 0;
  used_arrivals integer; used_departures integer; expected integer; expected_hospital integer;
  roster_from integer; roster_to integer; state text; hospital_state text;
BEGIN
  IF p_week IS NULL OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = p_facility AND f.organization_id = p_organization AND f.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;
  SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.thursday_bridge_tolerance', today) o;
  -- An unreadable tolerance allows no gap.
  tolerance := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer ELSE 0 END;
  SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_bridge_hospital_in_census', today) o;
  hospital_in_census := rule IS DISTINCT FROM 'false'::jsonb;

  -- Monday: the week's latest submitted revision, as of when its figures were given.
  SELECT v.id, coalesce(v.source_as_of, v.created_at) AS at, v.values INTO monday_rev
  FROM public.stand_up_reports r
  JOIN LATERAL (SELECT s.* FROM public.stand_up_revisions s WHERE s.report_id = r.id AND s.status = 'ready' ORDER BY s.version DESC LIMIT 1) v ON true
  WHERE r.facility_id = p_facility AND r.organization_id = p_organization AND r.week_start = p_week;
  -- Thursday: the current revision, as of when its figures were given.
  SELECT r.values, r.revision_id, coalesce(v.source_as_of, v.created_at) AS at INTO thursday
  FROM public.stand_up_meeting_reports r LEFT JOIN public.stand_up_meeting_revisions v ON v.id = r.revision_id
  WHERE r.facility_id = p_facility AND r.organization_id = p_organization AND r.week_start = p_week AND r.meeting_day = 'thursday';

  m_census := CASE WHEN monday_rev.values -> 'current_total_census' IS NULL OR monday_rev.values -> 'current_total_census' = 'null'::jsonb THEN NULL
    ELSE (monday_rev.values ->> 'current_total_census')::numeric::integer END;
  m_hospital := CASE WHEN monday_rev.values -> 'hospital_and_rehab_total' IS NULL OR monday_rev.values -> 'hospital_and_rehab_total' = 'null'::jsonb THEN NULL
    ELSE (monday_rev.values ->> 'hospital_and_rehab_total')::numeric::integer END;
  actual := CASE WHEN thursday.values -> 'current_total_census' IS NULL OR thursday.values -> 'current_total_census' = 'null'::jsonb THEN NULL
    ELSE (thursday.values ->> 'current_total_census')::numeric::integer END;
  actual_hospital := CASE WHEN thursday.values -> 'hospital_and_rehab_total' IS NULL OR thursday.values -> 'hospital_and_rehab_total' = 'null'::jsonb THEN NULL
    ELSE (thursday.values ->> 'hospital_and_rehab_total')::numeric::integer END;

  from_at := monday_rev.at;
  to_at := CASE WHEN actual IS NOT NULL AND thursday.at IS NOT NULL THEN thursday.at ELSE p_now END;
  IF from_at IS NOT NULL AND to_at < from_at THEN to_at := from_at; END IF;

  IF from_at IS NOT NULL THEN
    -- Each status change dated after Monday's figures and on or before
    -- Thursday's, against the status the resident held just before it.
    -- Empty intervals (a state an arrival dated earlier collapsed) are not
    -- movements, as in the admission and discharge register (504).
    WITH ordered AS (
      SELECT h.status::text AS status, h.effective_from,
        lag(h.status::text) OVER (PARTITION BY h.resident_id ORDER BY h.effective_from, h.id) AS prev
      FROM public.resident_status_history h
      JOIN public.residents res ON res.id = h.resident_id AND res.deleted_at IS NULL
      WHERE h.organization_id = p_organization AND h.facility_id = p_facility AND h.deleted_at IS NULL
        AND (h.effective_to IS NULL OR h.effective_to > h.effective_from)
        AND h.effective_from <= to_at
    ), moves AS (
      SELECT o.prev, o.status,
        coalesce(o.prev IN ('active', 'hospital_hold', 'loa'), false) AS was_in,
        o.status IN ('active', 'hospital_hold', 'loa') AS is_in
      FROM ordered o
      WHERE o.effective_from > from_at AND o.prev IS DISTINCT FROM o.status
    )
    SELECT
      count(*) FILTER (WHERE NOT was_in AND is_in),
      count(*) FILTER (WHERE NOT was_in AND status = 'hospital_hold'),
      count(*) FILTER (WHERE was_in AND NOT is_in),
      count(*) FILTER (WHERE was_in AND NOT is_in AND prev = 'hospital_hold'),
      count(*) FILTER (WHERE prev IN ('active', 'loa') AND status = 'hospital_hold'),
      count(*) FILTER (WHERE prev = 'hospital_hold' AND status IN ('active', 'loa'))
    INTO arrivals, arrivals_to_hospital, departures, departures_from_hospital, hospital_out, returns
    FROM moves;
    SELECT x.roster_census_count INTO roster_from FROM public.stand_up_roster_census_as_of(p_organization, p_facility, from_at) x;
    SELECT x.roster_census_count INTO roster_to FROM public.stand_up_roster_census_as_of(p_organization, p_facility, to_at) x;
  END IF;

  -- With hospital stays in the census, a stay and its return do not move it;
  -- without them, arrivals and departures are the ones in house or on leave.
  used_arrivals := CASE WHEN hospital_in_census THEN arrivals ELSE arrivals - arrivals_to_hospital END;
  used_departures := CASE WHEN hospital_in_census THEN departures ELSE departures - departures_from_hospital END;
  expected := CASE WHEN m_census IS NULL THEN NULL WHEN hospital_in_census
    THEN greatest(m_census + used_arrivals - used_departures, 0)
    ELSE greatest(m_census + used_arrivals - used_departures - hospital_out + returns, 0) END;
  expected_hospital := CASE WHEN m_hospital IS NULL THEN NULL
    ELSE greatest(m_hospital + hospital_out - returns + arrivals_to_hospital - departures_from_hospital, 0) END;

  state := CASE WHEN m_census IS NULL THEN 'no_monday' WHEN actual IS NULL THEN 'not_entered'
    WHEN abs(actual - expected) <= tolerance THEN 'matches' ELSE 'differs' END;
  hospital_state := CASE WHEN m_hospital IS NULL THEN 'no_monday' WHEN actual_hospital IS NULL THEN 'not_entered'
    WHEN abs(actual_hospital - expected_hospital) <= tolerance THEN 'matches' ELSE 'differs' END;

  RETURN jsonb_build_object(
    'facility_id', p_facility, 'week_start', p_week, 'state', state,
    'monday_census', m_census, 'monday_at', from_at, 'monday_revision_id', monday_rev.id,
    'thursday_at', CASE WHEN actual IS NOT NULL THEN to_at END, 'through', to_at,
    'arrivals', used_arrivals, 'departures', used_departures, 'hospital_out', hospital_out, 'returns', returns,
    'hospital_in_census', hospital_in_census,
    'expected', expected, 'actual', actual, 'gap', CASE WHEN actual IS NOT NULL AND expected IS NOT NULL THEN actual - expected END,
    'tolerance', tolerance,
    'roster_at_monday', roster_from, 'roster_at_thursday', roster_to,
    'hospital', jsonb_build_object('state', hospital_state, 'monday', m_hospital, 'expected', expected_hospital, 'actual', actual_hospital,
      'gap', CASE WHEN actual_hospital IS NOT NULL AND expected_hospital IS NOT NULL THEN actual_hospital - expected_hospital END,
      'hospital_out', hospital_out, 'returns', returns, 'arrivals_to_hospital', arrivals_to_hospital, 'departures_from_hospital', departures_from_hospital));
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_bridge(uuid, uuid, date, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION haven.stand_up_census_bridge(uuid, uuid, date, timestamptz) IS
  'COL-749 ruling 3: one facility''s Thursday census bridge for a week: Monday''s submitted census + arrivals - departures (- hospital or rehab out + returns when stand_up.census_bridge_hospital_in_census is false) = expected Thursday, beside Thursday''s actual, within stand_up.thursday_bridge_tolerance. Movements are status changes by effective date between Monday''s and Thursday''s figures. Counts only. Internal: callers decide who reads it.';

-- ---------------------------------------------------------------------------
-- 3. The disagreement flags Thursday against the bridge
-- ---------------------------------------------------------------------------
-- Migration 535's text. The Monday comparison now uses the bridge's expected
-- figure, within the tolerance, instead of Monday plus the roster's change.
CREATE OR REPLACE FUNCTION haven.stand_up_census_disagreement(p_organization uuid, p_facility uuid, p_day text, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  week date; times jsonb; roster record; vals jsonb; revision uuid; window_days integer; rule jsonb;
  k text; stand integer; ros integer; c_reason text; c_label text; c_at timestamptz; c_roster_as_of timestamptz; st text; until timestamptz;
  figures jsonb := '[]'::jsonb; overall text := 'not_entered'; rank_now integer := 0; rank integer;
  facility_name text; today date := (p_now AT TIME ZONE 'America/New_York')::date;
  vs_monday boolean := false; bridge jsonb; part jsonb; monday_value integer; expected integer; tolerance integer := 0; against text;
BEGIN
  SELECT f.name INTO facility_name FROM public.facilities f WHERE f.id = p_facility AND f.organization_id = p_organization AND f.deleted_at IS NULL;
  IF facility_name IS NULL THEN RETURN NULL; END IF;
  IF p_day = 'monday' THEN
    week := haven.stand_up_open_week(p_facility);
    SELECT r.values, r.revision_id INTO vals, revision FROM public.stand_up_reports r WHERE r.facility_id = p_facility AND r.week_start = week;
  ELSE
    week := haven.stand_up_meeting_open_week(p_organization, p_facility, p_day, p_now);
    IF week IS NULL THEN RETURN NULL; END IF;
    SELECT r.values, r.revision_id INTO vals, revision FROM public.stand_up_meeting_reports r
    WHERE r.facility_id = p_facility AND r.week_start = week AND r.meeting_day = p_day;
    SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.thursday_census_vs_monday', today) o;
    vs_monday := rule = 'true'::jsonb AND p_day = 'thursday';
    IF vs_monday THEN
      bridge := haven.stand_up_census_bridge(p_organization, p_facility, week, p_now);
      tolerance := coalesce((bridge ->> 'tolerance')::integer, 0);
    END IF;
  END IF;
  times := haven.stand_up_meeting_times(p_organization, p_facility, p_day, week);
  IF times IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO roster FROM public.stand_up_roster_census(p_organization, p_facility);
  SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_reason_window_days', today) o;
  window_days := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer ELSE 0 END;

  FOREACH k IN ARRAY ARRAY['current_total_census', 'hospital_and_rehab_total'] LOOP
    stand := CASE WHEN vals IS NULL OR vals -> k IS NULL OR vals -> k = 'null'::jsonb THEN NULL ELSE (vals ->> k)::numeric::integer END;
    ros := CASE WHEN roster.resident_count_in_haven = 0 THEN NULL WHEN k = 'current_total_census' THEN roster.roster_census_count ELSE roster.hospital_hold_count END;
    c_reason := NULL; c_label := NULL; c_at := NULL; c_roster_as_of := NULL;
    IF revision IS NOT NULL AND p_day = 'monday' THEN
      SELECT c.override_reason, coalesce(c.override_reason_label, haven.stand_up_census_reason_legacy_label(c.override_reason), c.override_reason), c.confirmed_at, c.roster_as_of
        INTO c_reason, c_label, c_at, c_roster_as_of
      FROM public.stand_up_roster_confirmations c WHERE c.revision_id = revision AND c.field_key = k AND c.source = 'overridden';
    ELSIF revision IS NOT NULL THEN
      SELECT c.override_reason, c.override_reason_label, c.confirmed_at, c.roster_as_of
        INTO c_reason, c_label, c_at, c_roster_as_of
      FROM public.stand_up_meeting_roster_confirmations c WHERE c.revision_id = revision AND c.field_key = k AND c.source = 'overridden';
    END IF;
    until := CASE WHEN c_at IS NULL THEN NULL ELSE c_at + make_interval(days => window_days) END;
    FOREACH against IN ARRAY CASE WHEN vs_monday THEN ARRAY['roster', 'monday'] ELSE ARRAY['roster'] END LOOP
      expected := NULL; monday_value := NULL; part := NULL;
      IF against = 'monday' THEN
        part := CASE WHEN k = 'current_total_census' THEN bridge - 'hospital' ELSE bridge -> 'hospital' END;
        monday_value := CASE WHEN k = 'current_total_census' THEN (bridge ->> 'monday_census')::integer ELSE (part ->> 'monday')::integer END;
        expected := (part ->> 'expected')::integer;
        -- Nothing to compare with (Monday not submitted): this comparison says nothing.
        IF expected IS NULL THEN CONTINUE; END IF;
      END IF;
      st := CASE
        WHEN stand IS NULL THEN 'not_entered'
        WHEN against = 'roster' AND ros IS NULL THEN 'no_roster'
        WHEN against = 'roster' AND stand = ros THEN 'agrees'
        WHEN against = 'monday' AND abs(stand - expected) <= tolerance THEN 'agrees'
        WHEN c_reason IS NOT NULL AND until > p_now AND c_roster_as_of IS NOT DISTINCT FROM roster.roster_as_of THEN 'explained'
        ELSE 'open' END;
      rank := CASE st WHEN 'open' THEN 4 WHEN 'explained' THEN 3 WHEN 'agrees' THEN 2 WHEN 'no_roster' THEN 1 ELSE 0 END;
      IF rank > rank_now THEN rank_now := rank; overall := st; END IF;
      figures := figures || jsonb_build_array(jsonb_build_object(
        'key', k, 'against', against,
        'label', CASE k WHEN 'current_total_census' THEN 'Census' ELSE 'At hospital or rehab' END
          || CASE WHEN against = 'monday' THEN ' against Monday' ELSE '' END,
        'stand_up', stand, 'roster', CASE WHEN against = 'roster' THEN ros ELSE expected END, 'state', st,
        'monday', monday_value, 'roster_change_since_monday', CASE WHEN against = 'monday' THEN expected - monday_value END,
        'bridge', CASE WHEN against = 'monday' THEN jsonb_build_object('monday', monday_value, 'expected', expected,
          'arrivals', CASE WHEN k = 'current_total_census' THEN (bridge ->> 'arrivals')::integer ELSE (part ->> 'arrivals_to_hospital')::integer END,
          'departures', CASE WHEN k = 'current_total_census' THEN (bridge ->> 'departures')::integer ELSE (part ->> 'departures_from_hospital')::integer END,
          'hospital_out', (part ->> 'hospital_out')::integer, 'returns', (part ->> 'returns')::integer,
          'hospital_in_census', (bridge ->> 'hospital_in_census')::boolean, 'tolerance', tolerance) END,
        'reason', CASE WHEN st IN ('explained', 'open') THEN c_reason END,
        'reason_label', CASE WHEN st IN ('explained', 'open') THEN c_label END,
        'reason_at', CASE WHEN st IN ('explained', 'open') THEN c_at END,
        'reason_until', CASE WHEN st IN ('explained', 'open') THEN until END,
        'roster_changed_since_reason', c_reason IS NOT NULL AND c_roster_as_of IS DISTINCT FROM roster.roster_as_of));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'facility_id', p_facility, 'facility_name', facility_name, 'meeting_day', p_day, 'week_start', week,
    'entry_due_at', times -> 'entry_due_at', 'call_at', times -> 'call_at',
    'state', overall,
    'unreconciled', overall = 'open' AND p_now >= (times ->> 'call_at')::timestamptz,
    'roster_as_of', roster.roster_as_of, 'reason_window_days', window_days,
    'reason_options', haven.stand_up_census_reason_options(p_organization, p_facility, today),
    'compares_with_monday', vs_monday,
    'figures', figures);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_disagreement(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The notice words a Monday comparison as the bridge
-- ---------------------------------------------------------------------------
-- Migration 535's sweep; only the Monday-comparison sentence changes.
CREATE OR REPLACE FUNCTION haven.stand_up_census_notice_sweep(p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f record; d jsonb; lead integer; rule jsonb; roles text[]; due timestamptz; call_at timestamptz; v_phase text;
  sent integer := 0; n integer; open_figures jsonb; message text; week date; today date := (p_now AT TIME ZONE 'America/New_York')::date;
BEGIN
  FOR f IN
    SELECT fa.id, fa.organization_id, m.meeting_day
    FROM public.facilities fa
    CROSS JOIN LATERAL (SELECT DISTINCT s.meeting_day FROM public.stand_up_meeting_schedule s WHERE s.organization_id = fa.organization_id AND s.active) m
    WHERE fa.deleted_at IS NULL
  LOOP
    week := CASE WHEN f.meeting_day = 'monday' THEN haven.stand_up_open_week(f.id)
      ELSE haven.stand_up_meeting_open_week(f.organization_id, f.id, f.meeting_day, p_now) END;
    IF week IS NULL THEN CONTINUE; END IF;
    d := haven.stand_up_meeting_times(f.organization_id, f.id, f.meeting_day, week);
    IF d IS NULL THEN CONTINUE; END IF;
    due := (d ->> 'entry_due_at')::timestamptz; call_at := (d ->> 'call_at')::timestamptz;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_lead_minutes', today) o;
    lead := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer END;
    IF lead IS NULL THEN CONTINUE; END IF;
    v_phase := CASE WHEN p_now >= due - make_interval(mins => lead) AND p_now < due THEN 'before_deadline'
      WHEN p_now >= due AND p_now < call_at THEN 'at_deadline' END;
    IF v_phase IS NULL THEN CONTINUE; END IF;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_channels', today) o;
    IF jsonb_typeof(rule) IS DISTINCT FROM 'array' OR NOT rule @> '["in_app"]'::jsonb THEN CONTINUE; END IF;
    d := haven.stand_up_census_disagreement(f.organization_id, f.id, f.meeting_day, p_now);
    IF d IS NULL OR d ->> 'state' <> 'open' THEN CONTINUE; END IF;
    SELECT o.value INTO rule FROM public.haven_operating_rule(f.organization_id, f.id, 'stand_up.census_notice_roles', today) o;
    SELECT array_agg(x #>> '{}') INTO roles FROM jsonb_array_elements(CASE WHEN jsonb_typeof(rule) = 'array' THEN rule ELSE '[]'::jsonb END) x;
    IF roles IS NULL THEN CONTINUE; END IF;
    SELECT jsonb_agg(x) INTO open_figures FROM jsonb_array_elements(d -> 'figures') x WHERE x ->> 'state' = 'open';
    SELECT string_agg(CASE WHEN x ->> 'against' = 'monday'
        THEN format('%s: Stand Up says %s, Monday''s %s with the movements since expects %s', x ->> 'label', x ->> 'stand_up', x ->> 'monday', x ->> 'roster')
        ELSE format('%s: Stand Up says %s, roster says %s', x ->> 'label', x ->> 'stand_up', x ->> 'roster') END, '. ')
      INTO message FROM jsonb_array_elements(open_figures) x;
    message := message || format('. Reconcile before %s.', to_char(due AT TIME ZONE 'America/New_York', 'FMHH12:MI AM'));
    INSERT INTO public.stand_up_census_notices(organization_id, facility_id, meeting_day, week_start, phase, recipient_user_id, recipient_role, entry_due_at, figures, message)
    SELECT f.organization_id, f.id, f.meeting_day, week, v_phase, p.id, p.app_role::text, due, open_figures, message
    FROM public.user_profiles p
    WHERE p.organization_id = f.organization_id AND p.is_active AND p.deleted_at IS NULL
      AND p.app_role::text = ANY (roles)
      AND (p.app_role::text IN ('owner', 'org_admin') OR EXISTS (
        SELECT 1 FROM public.user_facility_access u WHERE u.user_id = p.id AND u.facility_id = f.id
          AND u.organization_id = f.organization_id AND u.revoked_at IS NULL))
    ON CONFLICT ON CONSTRAINT stand_up_census_notices_one_per_recipient DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    sent := sent + n;
  END LOOP;
  RETURN sent;
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_notice_sweep(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 541's public.haven_operating_rule, 534's
-- haven.operating_rules_validate_row and rule-key check (after deleting any rows
-- for the three new keys), and 535's haven.stand_up_census_disagreement and
-- haven.stand_up_census_notice_sweep; DROP FUNCTION haven.stand_up_census_bridge;
-- delete the rows this migration seeded (the 2026-09-26 thursday_census_vs_monday
-- row turns the Monday check back off). Nothing is stored by the bridge.
