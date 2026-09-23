-- COL-666: which posted rate schedule wins, and what a concession is measured
-- against, become runtime rules instead of whatever the code happened to do.
--
-- Brian's rulings (2026-09-23, recorded on COL-666):
--   4b. Overlap: one schedule in force per facility (a schedule carries every
--       tier: private, semi-private/companion, care levels). The alternative
--       the business may choose later is "the latest effective date wins".
--   4c. A concession is a discount against the same payer's posted rate. A
--       Medicaid/insurer + private split is a payer split, not a concession.
--
-- Both are business decisions, so they live in billing_rate_rules: effective-
-- dated, organization-wide with an optional per-facility override, appended
-- by an owner or org admin and never edited in place, so a past period still
-- resolves the rule that was in force then.
--
-- haven_publish_rate_schedule already refuses a schedule dated on or before an
-- open one. This adds the guard for direct writes (SQL, service role, the
-- facility-launch promoter): a deferred constraint trigger, so the publish
-- RPC's insert-then-supersede still commits as one step.
BEGIN;

CREATE TABLE public.billing_rate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- Null: the organization-wide rule. A facility row overrides it.
  facility_id uuid NULL REFERENCES public.facilities(id),
  effective_from date NOT NULL,
  rate_overlap_rule text NOT NULL
    CHECK (rate_overlap_rule IN ('single_in_force', 'latest_effective_wins')),
  payer_split_is_concession boolean NOT NULL,
  -- The person whose decision this row records.
  ruled_by text NOT NULL CHECK (btrim(ruled_by) <> ''),
  note text NULL,
  created_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT billing_rate_rules_one_per_day UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, effective_from)
);

CREATE INDEX billing_rate_rules_lookup ON public.billing_rate_rules (organization_id, facility_id, effective_from DESC);

ALTER TABLE public.billing_rate_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organization members read rate rules for accessible facilities"
  ON public.billing_rate_rules FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
  );

-- Append-only: a change is a new effective-dated row, never an edit.
CREATE POLICY "Organization administrators record rate rules"
  ON public.billing_rate_rules FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND (facility_id IS NULL OR facility_id IN (SELECT haven.accessible_facility_ids()))
    AND haven.app_role() IN ('owner', 'org_admin')
    AND created_by = auth.uid()
  );

REVOKE ALL ON public.billing_rate_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.billing_rate_rules TO authenticated;
GRANT ALL ON public.billing_rate_rules TO service_role;

-- The rule in force for a facility on a day: the facility's own row first,
-- then the organization's, latest effective date first. No row means the
-- stricter overlap rule and no payer-split concessions, which is the ruling
-- seeded below; it never loosens anything. Invoker: a signed-in caller sees
-- only its own organization's rules; the guard below reads it as definer.
CREATE FUNCTION public.haven_billing_rate_rule(p_organization_id uuid, p_facility_id uuid, p_as_of date)
RETURNS TABLE (rate_overlap_rule text, payer_split_is_concession boolean, rule_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(r.rate_overlap_rule, 'single_in_force'), coalesce(r.payer_split_is_concession, false), r.id
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT b.rate_overlap_rule, b.payer_split_is_concession, b.id
    FROM public.billing_rate_rules b
    WHERE b.organization_id = p_organization_id
      AND (b.facility_id = p_facility_id OR b.facility_id IS NULL)
      AND b.effective_from <= p_as_of
    ORDER BY (b.facility_id IS NOT NULL) DESC, b.effective_from DESC, b.created_at DESC
    LIMIT 1
  ) r ON true
$$;

REVOKE ALL ON FUNCTION public.haven_billing_rate_rule(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haven_billing_rate_rule(uuid, uuid, date) TO authenticated, service_role;

-- A schedule is in force from effective_date through end_date. A draft, a
-- soft-deleted row, or a row ended before it began (migration 306 closed two
-- duplicate May rows that way) is never in force and never conflicts.
CREATE FUNCTION public.haven_rate_schedule_overlap_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.rate_schedules%ROWTYPE;
  v_rule text;
  v_conflict record;
BEGIN
  -- Deferred: read the row as it is at commit, not as this event saw it.
  SELECT * INTO v_row FROM public.rate_schedules WHERE id = NEW.id;
  IF NOT FOUND
    OR v_row.deleted_at IS NOT NULL
    OR v_row.status = 'draft'
    OR (v_row.end_date IS NOT NULL AND v_row.end_date < v_row.effective_date) THEN
    RETURN NULL;
  END IF;

  SELECT r.rate_overlap_rule INTO v_rule
  FROM public.haven_billing_rate_rule(v_row.organization_id, v_row.facility_id, v_row.effective_date) r;
  IF v_rule IS DISTINCT FROM 'single_in_force' THEN
    RETURN NULL;
  END IF;

  SELECT s.name, s.effective_date, s.end_date INTO v_conflict
  FROM public.rate_schedules s
  WHERE s.facility_id = v_row.facility_id
    AND s.id <> v_row.id
    AND s.deleted_at IS NULL
    AND s.status <> 'draft'
    AND (s.end_date IS NULL OR s.end_date >= s.effective_date)
    AND s.effective_date <= coalesce(v_row.end_date, 'infinity'::date)
    AND coalesce(s.end_date, 'infinity'::date) >= v_row.effective_date
  ORDER BY s.effective_date
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23P01',
      MESSAGE = format(
        'Rate schedule "%s" would be in force at the same time as "%s" (%s to %s). This facility allows one schedule in force at a time; end-date the other schedule or publish with a later effective date.',
        v_row.name, v_conflict.name, v_conflict.effective_date, coalesce(v_conflict.end_date::text, 'ongoing'));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.haven_rate_schedule_overlap_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.haven_rate_schedule_overlap_guard() IS
  'COL-666: refuses a second posted rate schedule in force at the same time for a facility when the billing rate rule is single_in_force. Deferred constraint trigger on rate_schedules; not callable directly. COL-37 ruling: definer required -- the writer (service role, the publish RPC, the facility-launch promoter) may not be able to read billing_rate_rules or every schedule of the facility under row level security, and the guard must see all of them.';

CREATE CONSTRAINT TRIGGER tr_rate_schedules_overlap_guard
  AFTER INSERT OR UPDATE ON public.rate_schedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_rate_schedule_overlap_guard();

-- The rulings, as data. Organizations are a handful of rows.
INSERT INTO public.billing_rate_rules (organization_id, facility_id, effective_from, rate_overlap_rule, payer_split_is_concession, ruled_by, note)
SELECT o.id, NULL, DATE '2026-01-01', 'single_in_force', false, 'Brian Lewis',
  'COL-666 rulings 4b/4c, 2026-09-23: one posted schedule in force per facility; a concession is a discount against the same payer''s posted rate, and a payer split is not a concession.'
FROM public.organizations o
WHERE o.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
