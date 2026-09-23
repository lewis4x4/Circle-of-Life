-- COL-710: three business thresholds that lived as literals in code become
-- effective-dated operating rules an owner or org admin can change.
--
--   risk.score_bands                 Nightly risk score levels. Scores below
--                                    critical_below are critical, below
--                                    high_below high, below moderate_below
--                                    moderate, otherwise low. Was 50 / 70 / 85
--                                    in the risk-nightly-scorer Edge Function
--                                    and 50 / 70 in the /admin/risk card tone.
--   survey_binder.due_window_days    How far ahead the survey binder counts
--                                    documents expiring and drills coming due.
--                                    Was 60 days in src/lib/office/survey-binder.ts.
--   compliance.score_alert_below_pct The /admin/compliance header alert for a
--                                    low compliance-rule pass rate. JSON null is
--                                    off. PR #743 removed the old hardcoded
--                                    `score < 75` trigger; nobody has ruled on a
--                                    threshold, so it stays off until someone
--                                    sets one.
--
-- Same shape as billing_rate_rules (477) and med_tech_shift_rules (476):
-- organization-wide rows with an optional per-facility override, append only
-- (a change is a new row with a later effective_from, never an edit), so a past
-- day still resolves the rule that was in force then. Values are validated by
-- a trigger, so a direct SQL or service-role write obeys the same guardrails as
-- the settings page.
--
-- Seed: every organization gets the two values that were hardcoded, so
-- behaviour is unchanged on the day this lands. The compliance alert gets no
-- row; its built-in default is off.
BEGIN;

CREATE TABLE public.operating_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Null: the organization-wide rule. A facility row overrides it.
  facility_id uuid NULL REFERENCES public.facilities(id),
  rule_key text NOT NULL CHECK (rule_key IN (
    'risk.score_bands',
    'survey_binder.due_window_days',
    'compliance.score_alert_below_pct'
  )),
  value jsonb NOT NULL,
  effective_from date NOT NULL,
  change_reason text NOT NULL CHECK (char_length(btrim(change_reason)) BETWEEN 1 AND 500),
  created_by uuid NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX idx_operating_rules_scope_key_effective
  ON public.operating_rules (organization_id, facility_id, rule_key, effective_from) NULLS NOT DISTINCT;
CREATE INDEX idx_operating_rules_lookup
  ON public.operating_rules (organization_id, rule_key, effective_from DESC);

COMMENT ON TABLE public.operating_rules IS
  'COL-710. Effective-dated business thresholds (risk score bands, survey binder due window, compliance score alert). facility_id NULL is the organization rule; a facility row overrides it. Append only: a change is a new row with a later effective_from.';

REVOKE ALL ON public.operating_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.operating_rules TO authenticated;
GRANT ALL ON public.operating_rules TO service_role;
ALTER TABLE public.operating_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read operating rules for accessible facilities"
  ON public.operating_rules FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

-- Owners and org admins set the organization rule; they and facility admins set
-- a facility override for a building they can reach. No backdating: a rule takes
-- effect today (facility calendar, America/New_York) or later.
CREATE POLICY "Administrators record operating rules"
  ON public.operating_rules FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND created_by = (SELECT auth.uid())
    AND effective_from >= (now() AT TIME ZONE 'America/New_York')::date
    AND (
      (facility_id IS NULL AND (SELECT haven.app_role()) IN ('owner', 'org_admin'))
      OR (
        facility_id IN (SELECT haven.accessible_facility_ids())
        AND (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin')
      )
    )
  );

-- Guardrails on the value, for every writer.
CREATE FUNCTION haven.operating_rules_validate_row()
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
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION haven.operating_rules_validate_row() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tr_operating_rules_validate
  BEFORE INSERT OR UPDATE ON public.operating_rules
  FOR EACH ROW EXECUTE FUNCTION haven.operating_rules_validate_row();

CREATE TRIGGER tr_operating_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.operating_rules
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- The rule in force for a scope on a day: the facility's own row first, then
-- the organization's, latest effective date first. No row resolves to the
-- built-in default (rule_id null): the seeded values below for the bands and
-- the binder window, off for the compliance alert. A null organization means
-- the caller's own. Invoker: a signed-in caller sees only its own
-- organization's rules; the service role sees all.
CREATE FUNCTION public.haven_operating_rule(
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

REVOKE ALL ON FUNCTION public.haven_operating_rule(uuid, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_operating_rule(uuid, uuid, text, date) TO authenticated, service_role;

-- The values that were hardcoded until now, so nothing changes on the day this lands.
INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
SELECT o.id, NULL, 'risk.score_bands',
       '{"critical_below": 50, "high_below": 70, "moderate_below": 85}'::jsonb,
       DATE '2026-09-23',
       'Seeded by migration 489 (COL-710): the risk levels the nightly scorer used before they became configurable (critical below 50, high below 70, moderate below 85).'
FROM public.organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
SELECT o.id, NULL, 'survey_binder.due_window_days', '60'::jsonb,
       DATE '2026-09-23',
       'Seeded by migration 489 (COL-710): the 60-day survey binder window used before it became configurable.'
FROM public.organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
