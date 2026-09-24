-- COL-710: business thresholds are effective-dated operating rules, and every
-- writer is held to the same guardrails. Self-contained: it all rolls back.
BEGIN;
DO $$
DECLARE
  v_org uuid;
  v_facility uuid;
  v_rule record;
BEGIN
  -- Every live organization carries the two previously hardcoded values as rows.
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.deleted_at IS NULL
      AND (
        NOT EXISTS (SELECT 1 FROM public.operating_rules r WHERE r.organization_id = o.id AND r.facility_id IS NULL AND r.rule_key = 'risk.score_bands')
        OR NOT EXISTS (SELECT 1 FROM public.operating_rules r WHERE r.organization_id = o.id AND r.facility_id IS NULL AND r.rule_key = 'survey_binder.due_window_days')
      )
  ) THEN
    RAISE EXCEPTION 'An organization is missing a seeded operating rule';
  END IF;

  SELECT f.organization_id, f.id INTO v_org, v_facility
  FROM public.facilities f
  WHERE f.deleted_at IS NULL
  ORDER BY f.id
  LIMIT 1;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_rule FROM public.haven_operating_rule(v_org, v_facility, 'risk.score_bands', current_date);
  IF v_rule.value IS DISTINCT FROM '{"critical_below": 50, "high_below": 70, "moderate_below": 85}'::jsonb OR v_rule.rule_id IS NULL THEN
    RAISE EXCEPTION 'Seeded risk bands do not resolve: %', row_to_json(v_rule);
  END IF;

  -- The compliance alert is off unless someone sets it.
  SELECT * INTO v_rule FROM public.haven_operating_rule(v_org, v_facility, 'compliance.score_alert_below_pct', current_date);
  IF v_rule.value IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Compliance alert should default to off, got %', v_rule.value;
  END IF;

  -- Guardrails hold for a direct write.
  BEGIN
    INSERT INTO public.operating_rules (organization_id, rule_key, value, effective_from, change_reason)
    VALUES (v_org, 'risk.score_bands', '{"critical_below": 70, "high_below": 50, "moderate_below": 85}', DATE '2999-01-01', 'probe');
    RAISE EXCEPTION 'Falling bands were accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.operating_rules (organization_id, rule_key, value, effective_from, change_reason)
    VALUES (v_org, 'survey_binder.due_window_days', '0', DATE '2999-01-01', 'probe');
    RAISE EXCEPTION 'A zero-day window was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.operating_rules (organization_id, rule_key, value, effective_from, change_reason)
    VALUES (v_org, 'compliance.score_alert_below_pct', '101', DATE '2999-01-01', 'probe');
    RAISE EXCEPTION 'A 101 percent alert was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- A future-dated change is not in force until its date; then it wins.
  INSERT INTO public.operating_rules (organization_id, rule_key, value, effective_from, change_reason)
  VALUES (v_org, 'survey_binder.due_window_days', '45', DATE '2999-01-01', 'probe');
  SELECT * INTO v_rule FROM public.haven_operating_rule(v_org, v_facility, 'survey_binder.due_window_days', current_date);
  IF v_rule.value IS DISTINCT FROM '60'::jsonb THEN
    RAISE EXCEPTION 'A future-dated rule applied early: %', v_rule.value;
  END IF;
  SELECT * INTO v_rule FROM public.haven_operating_rule(v_org, v_facility, 'survey_binder.due_window_days', DATE '2999-01-02');
  IF v_rule.value IS DISTINCT FROM '45'::jsonb THEN
    RAISE EXCEPTION 'The later rule did not take over: %', v_rule.value;
  END IF;

  -- A facility override beats the organization rule for that facility only.
  INSERT INTO public.operating_rules (organization_id, facility_id, rule_key, value, effective_from, change_reason)
  VALUES (v_org, v_facility, 'compliance.score_alert_below_pct', '80', DATE '1900-01-01', 'probe');
  SELECT * INTO v_rule FROM public.haven_operating_rule(v_org, v_facility, 'compliance.score_alert_below_pct', current_date);
  IF v_rule.value IS DISTINCT FROM '80'::jsonb OR v_rule.facility_id IS DISTINCT FROM v_facility THEN
    RAISE EXCEPTION 'Facility override does not take precedence: %', row_to_json(v_rule);
  END IF;
  SELECT * INTO v_rule FROM public.haven_operating_rule(v_org, NULL, 'compliance.score_alert_below_pct', current_date);
  IF v_rule.value IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Facility override leaked to the organization: %', v_rule.value;
  END IF;
END $$;
ROLLBACK;
