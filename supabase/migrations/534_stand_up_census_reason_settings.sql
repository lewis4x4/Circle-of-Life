-- COL-555 (remainder) and COL-333: the batch's runtime settings, a command to
-- set them per facility, and the census reason list as a facility setting.
--
-- Brian's standing rule (2026-09-18): a business decision is data, effective
-- dated and changed at runtime, never a literal. Every open question in this
-- batch is therefore a setting with a proposed default, so a future ruling is a
-- settings change and not a code change.
--
--   1. Five new operating rules in the COL-710 registry (491 / 504 / 523):
--        stand_up.census_reason_options          the reasons an administrator
--          may give for a Stand Up census that differs from the roster, per
--          facility. Default: the four reasons migration 404 fixed in code.
--        stand_up.census_notice_channels         how a census notice is
--          delivered. Default ["in_app"]; [] sends none. Only in-app delivery
--          exists; push and text are refused by the validator until they are
--          built (COL-751).
--        stand_up.thursday_census_vs_monday      whether Thursday's census is
--          also checked against Monday's submitted figure plus the roster's
--          movement since Monday. Default false (off).
--        stand_up.thursday_admission_notes_to_recruiters  whether recruiters
--          read admission notes on the Thursday report. Default false.
--        admissions.arrival_approval_roles       who may give the administrator
--          approval that an actual arrival needs (COL-333). Default owner,
--          org_admin and facility_admin. The rule can narrow the roles; it
--          cannot empty the list or add a role outside those three, so it can
--          refine the gate but never waive it.
--
--   2. public.operating_rule_record(...): the one command that writes a rule,
--      for the organization or for one facility, from a date on or after
--      today. It runs as the caller, so the 491 policy decides who may write
--      (owner and org admin for the organization; owner, org admin and the
--      facility's administrator for a facility) and the validator decides
--      what may be written.
--
--   3. The Monday census reason is checked against the facility's reason list
--      in force today, not against a list in code. stand_up_roster_confirmations
--      keeps the label the administrator saw (override_reason_label), so a
--      reason renamed or retired later still reads as it was given. Rows saved
--      before this migration have no label; readers fall back to the four
--      original labels, which are history, not a rule.
--
--   4. The census disagreement (523) returns each reason's label and the
--      facility's current reason list, so every surface words a reason the
--      same way and the Reconcile dialog offers exactly the facility's list.
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
  'admissions.arrival_approval_roles'
));

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
    -- One to twelve reasons, each a short key and a label. Keys never change
    -- meaning: a reason is retired by leaving it out, and saved reasons keep
    -- the label they were given with.
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
    -- Only in-app delivery exists. Push and text are named so the refusal says
    -- what is missing, rather than accepting a channel nothing delivers.
    -- An empty list is a real setting: no census notices for the facility.
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
  ELSIF NEW.rule_key IN ('stand_up.thursday_census_vs_monday', 'stand_up.thursday_admission_notes_to_recruiters') THEN
    IF jsonb_typeof(v) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'This rule is on (true) or off (false)' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.rule_key = 'admissions.arrival_approval_roles' THEN
    -- Refines who approves an arrival; never waives the approval.
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

-- The resolver's built-in defaults, as 491, 504 and 523 do.
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
      WHEN 'stand_up.census_notice_roles' THEN '["facility_admin"]'::jsonb
      WHEN 'stand_up.census_reason_options' THEN '[{"key": "roster_not_current", "label": "Roster not updated yet"}, {"key": "change_not_entered", "label": "Admission or discharge not entered in Haven"}, {"key": "different_definition", "label": "Workbook counts census differently"}, {"key": "other", "label": "Other"}]'::jsonb
      WHEN 'stand_up.census_notice_channels' THEN '["in_app"]'::jsonb
      WHEN 'stand_up.thursday_census_vs_monday' THEN 'false'::jsonb
      WHEN 'stand_up.thursday_admission_notes_to_recruiters' THEN 'false'::jsonb
      WHEN 'admissions.arrival_approval_roles' THEN '["owner", "org_admin", "facility_admin"]'::jsonb
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
SELECT o.id, NULL, k.rule_key, k.value, DATE '2026-09-25', k.reason
FROM public.organizations o
CROSS JOIN (VALUES
  ('stand_up.census_reason_options', '[{"key": "roster_not_current", "label": "Roster not updated yet"}, {"key": "change_not_entered", "label": "Admission or discharge not entered in Haven"}, {"key": "different_definition", "label": "Workbook counts census differently"}, {"key": "other", "label": "Other"}]'::jsonb,
   'Seeded by migration 534 (COL-555): the four reasons migration 404 fixed in code, now a setting. A facility may set its own list.'),
  ('stand_up.census_notice_channels', '["in_app"]'::jsonb,
   'Seeded by migration 534 (COL-751): proposed default. Census notices are delivered in Haven; push and text are not built yet.'),
  ('stand_up.thursday_census_vs_monday', 'false'::jsonb,
   'Seeded by migration 534 (COL-751): proposed default, off. Thursday census is checked against the roster only, not against Monday''s submitted figure.'),
  ('stand_up.thursday_admission_notes_to_recruiters', 'false'::jsonb,
   'Seeded by migration 534 (COL-754): proposed default. Admission notes are not shown to recruiters on the Thursday report.'),
  ('admissions.arrival_approval_roles', '["owner", "org_admin", "facility_admin"]'::jsonb,
   'Seeded by migration 534 (COL-333): proposed default. An owner, org admin or the facility''s administrator approves an arrival before it is confirmed.')
) AS k(rule_key, value, reason)
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The command that writes a rule
-- ---------------------------------------------------------------------------
-- Runs as the caller: the 491 insert policy decides who may write at which
-- scope, the validator decides the value, and the audit trigger records it.
CREATE FUNCTION public.operating_rule_record(
  p_rule_key text,
  p_facility_id uuid,
  p_value jsonb,
  p_effective_from date,
  p_change_reason text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  created public.operating_rules;
BEGIN
  IF auth.uid() IS NULL OR haven.organization_id() IS NULL THEN
    RAISE EXCEPTION 'Sign in to change a rule' USING ERRCODE = '42501';
  END IF;
  IF p_effective_from IS NULL OR p_effective_from < (now() AT TIME ZONE 'America/New_York')::date THEN
    RAISE EXCEPTION 'Choose an effective date of today or later' USING ERRCODE = '22023';
  END IF;
  IF p_facility_id IS NOT NULL AND NOT haven.has_facility_access(p_facility_id) THEN
    RAISE EXCEPTION 'You cannot change rules for that facility' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason, created_by)
  VALUES (haven.organization_id(), p_facility_id, p_rule_key, p_value, p_effective_from, btrim(coalesce(p_change_reason, '')), auth.uid())
  RETURNING * INTO created;
  RETURN jsonb_build_object('id', created.id, 'rule_key', created.rule_key, 'facility_id', created.facility_id,
    'value', created.value, 'effective_from', created.effective_from, 'change_reason', created.change_reason,
    'created_at', created.created_at);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'You cannot change this rule at that scope' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.operating_rule_record(text, uuid, jsonb, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.operating_rule_record(text, uuid, jsonb, date, text) TO authenticated;
COMMENT ON FUNCTION public.operating_rule_record(text, uuid, jsonb, date, text) IS
  'COL-555: records an operating rule for the organization (p_facility_id null) or one facility, effective from a date on or after today. Runs as the caller: the 491 policy limits the organization scope to owner and org_admin and a facility scope to owner, org_admin and facility_admin with access; the validator trigger checks the value; the audit trigger records the change.';

-- ---------------------------------------------------------------------------
-- 3. Census reasons from the facility's list
-- ---------------------------------------------------------------------------
-- The label of a reason key in the facility's list on a day; null when the key
-- is not in the list in force then.
CREATE FUNCTION haven.stand_up_census_reason_label(p_organization uuid, p_facility uuid, p_key text, p_as_of date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x ->> 'label'
  FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_reason_options', p_as_of) o
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.value) = 'array' THEN o.value ELSE '[]'::jsonb END) x
  WHERE x ->> 'key' = p_key
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION haven.stand_up_census_reason_label(uuid, uuid, text, date) FROM PUBLIC, anon, authenticated, service_role;

-- The facility's list on a day, as [{key,label}]; an unreadable value is empty.
CREATE FUNCTION haven.stand_up_census_reason_options(p_organization uuid, p_facility uuid, p_as_of date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(o.value) = 'array' THEN o.value ELSE '[]'::jsonb END
  FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_reason_options', p_as_of) o
$$;
REVOKE ALL ON FUNCTION haven.stand_up_census_reason_options(uuid, uuid, date) FROM PUBLIC, anon, authenticated, service_role;

-- What a reason recorded before this migration read as (migration 404's list).
-- History, not a rule: it only labels rows that were saved with those keys.
CREATE FUNCTION haven.stand_up_census_reason_legacy_label(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_key
    WHEN 'roster_not_current' THEN 'Roster not updated yet'
    WHEN 'change_not_entered' THEN 'Admission or discharge not entered in Haven'
    WHEN 'different_definition' THEN 'Workbook counts census differently'
    WHEN 'other' THEN 'Other'
  END
$$;
REVOKE ALL ON FUNCTION haven.stand_up_census_reason_legacy_label(text) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.stand_up_roster_confirmations DROP CONSTRAINT stand_up_roster_confirmations_override_reason_check;
ALTER TABLE public.stand_up_roster_confirmations
  ADD CONSTRAINT stand_up_roster_confirmations_override_reason_check CHECK (override_reason IS NULL OR override_reason ~ '^[a-z][a-z0-9_]{0,39}$'),
  ADD COLUMN override_reason_label text CHECK (override_reason_label IS NULL OR char_length(override_reason_label) BETWEEN 1 AND 80);
COMMENT ON COLUMN public.stand_up_roster_confirmations.override_reason_label IS
  'COL-555: the reason''s label in the facility''s stand_up.census_reason_options when it was given. Null on rows saved before migration 534 (their keys are migration 404''s four).';

-- Migration 522's text; the reason is checked against the facility's list and
-- its label is kept with it.
CREATE OR REPLACE FUNCTION haven.stand_up_roster_confirm(p jsonb, p_organization uuid, p_facility uuid, p_actor uuid, p_report uuid, p_revision uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE roster jsonb:=p->'roster'; c record; k text; v jsonb; entry jsonb; reason text; suggested integer; confirmed integer; src text;
 prefill jsonb; given jsonb; field jsonb; haven_value bigint; typed numeric; week date; reason_label text;
BEGIN
 IF roster IS NULL THEN RETURN; END IF;
 IF jsonb_typeof(roster)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(roster) x WHERE x<>ALL(haven.stand_up_roster_keys())) THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
 SELECT * INTO c FROM public.stand_up_roster_census(p_organization,p_facility);
 FOREACH k IN ARRAY haven.stand_up_roster_keys() LOOP
  v:=p->'values'->k;
  IF v IS NULL OR v='null'::jsonb THEN CONTINUE; END IF; -- a blank figure confirms nothing
  entry:=roster->k;
  IF entry IS NOT NULL AND jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'Invalid roster confirmation'; END IF;
  reason:=nullif(btrim(coalesce(entry->>'override_reason','')),'');
  reason_label:=NULL;
  IF reason IS NOT NULL THEN
   reason_label:=haven.stand_up_census_reason_label(p_organization,p_facility,reason,(clock_timestamp() AT TIME ZONE 'America/New_York')::date);
   IF reason_label IS NULL THEN RAISE EXCEPTION 'Invalid override reason' USING ERRCODE='22023'; END IF;
  END IF;
  confirmed:=(v#>>'{}')::numeric::integer;
  suggested:=CASE WHEN c.resident_count_in_haven=0 THEN NULL WHEN k='current_total_census' THEN c.roster_census_count ELSE c.hospital_hold_count END;
  src:=CASE WHEN suggested IS NULL THEN 'entered_no_roster' WHEN confirmed=suggested THEN 'roster_confirmed' ELSE 'overridden' END;
  IF src='overridden' AND reason IS NULL THEN
   RAISE EXCEPTION '% differs from the Haven roster (%). Choose why it is different or use the roster figure.',
    CASE WHEN k='current_total_census' THEN 'Current census' ELSE 'Residents at hospital or rehab' END,suggested USING ERRCODE='22023';
  END IF;
  IF src<>'overridden' THEN reason:=NULL; reason_label:=NULL; END IF;
  INSERT INTO public.stand_up_roster_confirmations(organization_id,facility_id,report_id,revision_id,field_key,roster_suggested_value,confirmed_value,source,override_reason,override_reason_label,roster_as_of,confirmed_by)
  VALUES(p_organization,p_facility,p_report,p_revision,k,suggested,confirmed,src,reason,reason_label,c.roster_as_of,p_actor);
 END LOOP;

 -- COL-753: every other figure against Haven's own, recomputed here.
 given:=coalesce(p->'prefill','{}'::jsonb);
 IF jsonb_typeof(given)<>'object' THEN RAISE EXCEPTION 'Invalid prefill confirmation'; END IF;
 SELECT r.week_start INTO week FROM public.stand_up_reports r WHERE r.id=p_report;
 prefill:=haven.stand_up_monday_prefill(p_organization,p_facility,week);
 FOR k IN SELECT jsonb_object_keys(prefill->'fields') LOOP
  IF k=ANY(haven.stand_up_roster_keys()) THEN CONTINUE; END IF;
  v:=p->'values'->k;
  IF v IS NULL OR v='null'::jsonb THEN CONTINUE; END IF;
  field:=prefill->'fields'->k;
  haven_value:=CASE WHEN field->'value' IS NULL OR field->'value'='null'::jsonb THEN NULL ELSE (field->>'value')::bigint END;
  typed:=(v#>>'{}')::numeric;
  entry:=given->k;
  IF entry IS NOT NULL AND jsonb_typeof(entry)<>'object' THEN RAISE EXCEPTION 'Invalid prefill confirmation'; END IF;
  reason:=nullif(btrim(coalesce(entry->>'override_reason','')),'');
  IF reason IS NOT NULL AND reason NOT IN('haven_not_current','counted_differently','other') THEN RAISE EXCEPTION 'Invalid override reason'; END IF;
  src:=CASE WHEN haven_value IS NULL THEN 'entered_no_source' WHEN typed=haven_value THEN 'haven_confirmed' ELSE 'overridden' END;
  IF src='overridden' AND reason IS NULL AND coalesce(p->>'status','draft')='ready' THEN
   RAISE EXCEPTION '% differs from Haven (%). Choose why it is different or use Haven''s figure.',
    CASE k WHEN 'monthly_rent_roll_cents' THEN 'Monthly rent roll' WHEN 'sp_female_beds_open' THEN 'Semi-private female beds open'
      WHEN 'sp_male_beds_open' THEN 'Semi-private male beds open' WHEN 'sp_flexible_beds_open' THEN 'Semi-private flexible beds open'
      WHEN 'private_beds_open' THEN 'Private beds open' WHEN 'admissions_expected' THEN 'Expected admissions this week'
      WHEN 'expected_discharges' THEN 'Expected discharges this week' WHEN 'callouts_last_week' THEN 'Callouts last week'
      WHEN 'terminations_last_week' THEN 'Terminations last week' WHEN 'tours_expected' THEN 'Expected tours this week'
      WHEN 'provider_activities_expected' THEN 'Home-health activities this week' WHEN 'outreach_engagements' THEN 'Outreach and engagements this week'
      ELSE k END,
    CASE WHEN k='monthly_rent_roll_cents' THEN to_char(haven_value/100.0,'FM$999,999,990.00') ELSE haven_value::text END
    USING ERRCODE='22023';
  END IF;
  IF src<>'overridden' THEN reason:=NULL; END IF;
  INSERT INTO public.stand_up_prefill_confirmations(organization_id,facility_id,report_id,revision_id,field_key,haven_value,confirmed_value,source,override_reason,haven_source,computed_at,confirmed_by)
  VALUES(p_organization,p_facility,p_report,p_revision,k,haven_value,typed,src,reason,field->>'source',(prefill->>'computed_at')::timestamptz,p_actor);
 END LOOP;
END $function$;
REVOKE ALL ON FUNCTION haven.stand_up_roster_confirm(jsonb,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Migration 404's reader, with the reason's label.
CREATE OR REPLACE FUNCTION haven.stand_up_roster_confirmations(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(c.field_key,jsonb_build_object('source',c.source,'suggested',c.roster_suggested_value,'confirmed',c.confirmed_value,
  'override_reason',c.override_reason,
  'override_reason_label',CASE WHEN c.override_reason IS NULL THEN NULL ELSE coalesce(c.override_reason_label,haven.stand_up_census_reason_legacy_label(c.override_reason),c.override_reason) END,
  'roster_as_of',c.roster_as_of,'confirmed_at',c.confirmed_at)),'{}'::jsonb)
 FROM public.stand_up_roster_confirmations c WHERE c.revision_id=p_revision
$$;

-- ---------------------------------------------------------------------------
-- 4. The disagreement names each reason, and the facility's list
-- ---------------------------------------------------------------------------
-- Migration 523's text, plus reason_label per figure and reason_options.
CREATE OR REPLACE FUNCTION haven.stand_up_census_disagreement(p_organization uuid, p_facility uuid, p_day text, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  week date; times jsonb; roster record; vals jsonb; revision uuid; window_days integer; rule jsonb;
  k text; stand integer; ros integer; c_reason text; c_label text; c_at timestamptz; c_roster_as_of timestamptz; st text; until timestamptz;
  figures jsonb := '[]'::jsonb; overall text := 'not_entered'; rank_now integer := 0; rank integer;
  facility_name text; today date := (p_now AT TIME ZONE 'America/New_York')::date;
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
  END IF;
  times := haven.stand_up_meeting_times(p_organization, p_facility, p_day, week);
  IF times IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO roster FROM public.stand_up_roster_census(p_organization, p_facility);
  SELECT o.value INTO rule FROM public.haven_operating_rule(p_organization, p_facility, 'stand_up.census_reason_window_days', today) o;
  -- An unreadable window gives a reason no grace: the disagreement stays open.
  window_days := CASE WHEN jsonb_typeof(rule) = 'number' AND rule::text ~ '^[0-9]+$' THEN rule::text::integer ELSE 0 END;

  FOREACH k IN ARRAY ARRAY['current_total_census', 'hospital_and_rehab_total'] LOOP
    stand := CASE WHEN vals IS NULL OR vals -> k IS NULL OR vals -> k = 'null'::jsonb THEN NULL ELSE (vals ->> k)::numeric::integer END;
    ros := CASE WHEN roster.resident_count_in_haven = 0 THEN NULL WHEN k = 'current_total_census' THEN roster.roster_census_count ELSE roster.hospital_hold_count END;
    c_reason := NULL; c_label := NULL; c_at := NULL; c_roster_as_of := NULL;
    IF p_day = 'monday' AND revision IS NOT NULL THEN
      SELECT c.override_reason, coalesce(c.override_reason_label, haven.stand_up_census_reason_legacy_label(c.override_reason), c.override_reason), c.confirmed_at, c.roster_as_of
        INTO c_reason, c_label, c_at, c_roster_as_of
      FROM public.stand_up_roster_confirmations c WHERE c.revision_id = revision AND c.field_key = k AND c.source = 'overridden';
    END IF;
    until := CASE WHEN c_at IS NULL THEN NULL ELSE c_at + make_interval(days => window_days) END;
    st := CASE
      WHEN stand IS NULL THEN 'not_entered'
      WHEN ros IS NULL THEN 'no_roster'
      WHEN stand = ros THEN 'agrees'
      WHEN c_reason IS NOT NULL AND until > p_now AND c_roster_as_of IS NOT DISTINCT FROM roster.roster_as_of THEN 'explained'
      ELSE 'open' END;
    rank := CASE st WHEN 'open' THEN 4 WHEN 'explained' THEN 3 WHEN 'agrees' THEN 2 WHEN 'no_roster' THEN 1 ELSE 0 END;
    IF rank > rank_now THEN rank_now := rank; overall := st; END IF;
    figures := figures || jsonb_build_array(jsonb_build_object(
      'key', k,
      'label', CASE k WHEN 'current_total_census' THEN 'Census' ELSE 'At hospital or rehab' END,
      'stand_up', stand, 'roster', ros, 'state', st,
      'reason', CASE WHEN st IN ('explained', 'open') THEN c_reason END,
      'reason_label', CASE WHEN st IN ('explained', 'open') THEN c_label END,
      'reason_at', CASE WHEN st IN ('explained', 'open') THEN c_at END,
      'reason_until', CASE WHEN st IN ('explained', 'open') THEN until END,
      'roster_changed_since_reason', c_reason IS NOT NULL AND c_roster_as_of IS DISTINCT FROM roster.roster_as_of));
  END LOOP;

  RETURN jsonb_build_object(
    'facility_id', p_facility, 'facility_name', facility_name, 'meeting_day', p_day, 'week_start', week,
    'entry_due_at', times -> 'entry_due_at', 'call_at', times -> 'call_at',
    'state', overall,
    'unreconciled', overall = 'open' AND p_now >= (times ->> 'call_at')::timestamptz,
    'roster_as_of', roster.roster_as_of, 'reason_window_days', window_days,
    'reason_options', haven.stand_up_census_reason_options(p_organization, p_facility, today),
    'figures', figures);
END $$;
REVOKE ALL ON FUNCTION haven.stand_up_census_disagreement(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 523's haven.operating_rules_validate_row,
-- public.haven_operating_rule, rule-key check and haven.stand_up_census_disagreement,
-- migration 522's haven.stand_up_roster_confirm and 404's
-- haven.stand_up_roster_confirmations; DROP FUNCTION public.operating_rule_record,
-- haven.stand_up_census_reason_label, haven.stand_up_census_reason_options,
-- haven.stand_up_census_reason_legacy_label; delete the five seeded rule rows.
-- Keep stand_up_roster_confirmations.override_reason_label (it is the record of
-- what was given); restore the four-key check only if no other key was saved.
