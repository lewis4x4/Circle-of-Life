-- COL-666: the posted-rate overlap rule is data, and direct writes obey it.
-- Self-contained: every schedule it writes is dated in 1900, so it never meets
-- a real schedule, and it all rolls back.
BEGIN;
DO $$
DECLARE
  v_org uuid;
  v_facility uuid;
  v_rule record;
  v_a uuid;
BEGIN
  -- Every live organization carries the ruling as a row, not only as a code default.
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.billing_rate_rules b WHERE b.organization_id = o.id AND b.facility_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'An organization has no billing rate rule row';
  END IF;

  SELECT f.organization_id, f.id INTO v_org, v_facility
  FROM public.facilities f
  WHERE f.deleted_at IS NULL
  ORDER BY f.id
  LIMIT 1;

  SELECT * INTO v_rule FROM public.haven_billing_rate_rule(v_org, v_facility, current_date);
  IF v_rule.rate_overlap_rule IS DISTINCT FROM 'single_in_force' OR v_rule.payer_split_is_concession IS DISTINCT FROM false OR v_rule.rule_id IS NULL THEN
    RAISE EXCEPTION 'Seeded rule does not resolve: %', row_to_json(v_rule);
  END IF;

  INSERT INTO public.rate_schedules (facility_id, organization_id, name, effective_date, end_date, base_rate_private, care_surcharge_level_2, care_surcharge_level_3, status)
  VALUES (v_facility, v_org, 'probe A', DATE '1900-01-01', DATE '1900-12-31', 100000, 0, 0, 'published')
  RETURNING id INTO v_a;
  SET CONSTRAINTS tr_rate_schedules_overlap_guard IMMEDIATE;
  SET CONSTRAINTS tr_rate_schedules_overlap_guard DEFERRED;

  -- A second schedule in force at the same time, written straight to the table, is refused.
  BEGIN
    INSERT INTO public.rate_schedules (facility_id, organization_id, name, effective_date, end_date, base_rate_private, care_surcharge_level_2, care_surcharge_level_3, status)
    VALUES (v_facility, v_org, 'probe B', DATE '1900-06-01', DATE '1900-06-30', 100000, 0, 0, 'published');
    SET CONSTRAINTS tr_rate_schedules_overlap_guard IMMEDIATE;
    RAISE EXCEPTION 'Overlapping schedule was accepted';
  EXCEPTION WHEN SQLSTATE '23P01' THEN
    NULL;
  END;
  SET CONSTRAINTS tr_rate_schedules_overlap_guard DEFERRED;

  -- A draft, or a row ended before it began, is never in force and never conflicts.
  INSERT INTO public.rate_schedules (facility_id, organization_id, name, effective_date, end_date, base_rate_private, care_surcharge_level_2, care_surcharge_level_3, status)
  VALUES (v_facility, v_org, 'probe draft', DATE '1900-06-01', NULL, 100000, 0, 0, 'draft'),
         (v_facility, v_org, 'probe empty', DATE '1900-06-01', DATE '1900-05-31', 100000, 0, 0, 'superseded');
  SET CONSTRAINTS tr_rate_schedules_overlap_guard IMMEDIATE;
  SET CONSTRAINTS tr_rate_schedules_overlap_guard DEFERRED;

  -- haven_publish_rate_schedule inserts the new schedule, then end-dates the old
  -- one in the same transaction. The deferred guard lets that commit.
  INSERT INTO public.rate_schedules (facility_id, organization_id, name, effective_date, end_date, base_rate_private, care_surcharge_level_2, care_surcharge_level_3, status)
  VALUES (v_facility, v_org, 'probe C', DATE '1900-07-01', DATE '1900-12-31', 100000, 0, 0, 'published');
  UPDATE public.rate_schedules SET end_date = DATE '1900-06-30', status = 'superseded' WHERE id = v_a;
  SET CONSTRAINTS tr_rate_schedules_overlap_guard IMMEDIATE;
  SET CONSTRAINTS tr_rate_schedules_overlap_guard DEFERRED;

  -- The rule is runtime: a facility override to "latest effective wins" lets an overlap through.
  INSERT INTO public.billing_rate_rules (organization_id, facility_id, effective_from, rate_overlap_rule, payer_split_is_concession, medicaid_resident_share_invoice, ruled_by)
  VALUES (v_org, v_facility, DATE '1900-01-01', 'latest_effective_wins', false, false, 'probe');
  SELECT * INTO v_rule FROM public.haven_billing_rate_rule(v_org, v_facility, current_date);
  IF v_rule.rate_overlap_rule IS DISTINCT FROM 'latest_effective_wins' THEN
    RAISE EXCEPTION 'Facility override does not take precedence';
  END IF;
  INSERT INTO public.rate_schedules (facility_id, organization_id, name, effective_date, end_date, base_rate_private, care_surcharge_level_2, care_surcharge_level_3, status)
  VALUES (v_facility, v_org, 'probe D', DATE '1900-08-01', DATE '1900-08-31', 100000, 0, 0, 'published');
  SET CONSTRAINTS tr_rate_schedules_overlap_guard IMMEDIATE;
END $$;
ROLLBACK;
