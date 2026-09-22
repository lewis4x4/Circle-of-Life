-- 459: Facility Operator Home — On tap feed (COL-593 / COL-591, W1).
--
-- One new read surface, `public.home_on_tap`, composes engines that already
-- exist. This file adds the smallest schema the composition needs:
--
--   * facility_assets.run_check_*        — the generator's self-test schedule is
--                                          data on the asset (DEC-2026-09-22-04);
--                                          a vendor visit resets it. Never a constant.
--   * facilities.operator_end_of_day_local — when "before you leave" ends (E4);
--                                          per facility, default 17:00 local.
--   * facility_executives                — the home-office person who receives
--                                          what the building did not clear (COL-571).
--   * Homewood generator asset + template — the first live On-tap row
--                                          (DEC-2026-09-22-04, Tue 10:00). Facility
--                                          scoped; nothing for any other building.
--   * operation_activity_subjects rows   — the COL-133 classification the
--                                          scheduler stamps on rows so a signed-in
--                                          operator can read them at all.
--   * home_on_tap / home_claim_task / home_escalate_uncleared /
--     home_escalations_for_executive.
--
-- Completion never happens here: rows are cleared through the existing
-- operations completion route (`complete_operation_task_review`), which keeps
-- the actor, the audit row and the dual-sign rules exactly as they are.
--
-- Rolls forward only. Every statement is idempotent so a partial apply can be
-- re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Asset self-test schedule (COL-568)
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_assets
  ADD COLUMN IF NOT EXISTS run_check_weekday smallint
    CHECK (run_check_weekday IS NULL OR run_check_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS run_check_local_time time,
  ADD COLUMN IF NOT EXISTS run_check_set_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS run_check_set_at timestamptz;

COMMENT ON COLUMN public.facility_assets.run_check_weekday IS
  'ISO weekday (1 = Monday) the asset self-tests. Overrides the linked template day_of_week when set together with run_check_local_time (COL-568).';
COMMENT ON COLUMN public.facility_assets.run_check_local_time IS
  'Local clock time the asset self-tests; a vendor service visit resets it (DEC-2026-09-22-04). Never hard-code the time.';

-- ---------------------------------------------------------------------------
-- 2. Operator end of day (E4: "due today" = before the administrator leaves)
-- ---------------------------------------------------------------------------
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS operator_end_of_day_local time NOT NULL DEFAULT '17:00';

COMMENT ON COLUMN public.facilities.operator_end_of_day_local IS
  'Local time the facility operator queue closes for the day; anything still on tap escalates to the Facility Executive (COL-593 §5.4). Per facility, editable.';

-- ---------------------------------------------------------------------------
-- 3. Facility Executive (COL-571)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_executives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL UNIQUE REFERENCES public.facilities(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  effective_from date NOT NULL DEFAULT current_date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE public.facility_executives IS
  'The home-office person in charge of a building (not the owner). Receives end-of-day escalations from the facility operator queue. One current executive per facility (COL-571).';

ALTER TABLE public.facility_executives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organization members see facility executives" ON public.facility_executives;
CREATE POLICY "Organization members see facility executives" ON public.facility_executives
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS "Owners and org admins manage facility executives" ON public.facility_executives;
CREATE POLICY "Owners and org admins manage facility executives" ON public.facility_executives
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  ) WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

REVOKE ALL ON public.facility_executives FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.facility_executives TO authenticated;
GRANT SELECT ON public.facility_executives TO service_role;

DROP TRIGGER IF EXISTS facility_executives_audit_trigger ON public.facility_executives;
CREATE TRIGGER facility_executives_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.facility_executives
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- Seed the executives that have Haven logins today. Grande Cypress (Jen) has no
-- login yet; Rising Oaks and Oakridge are unconfirmed (COL-571). Guarded so the
-- local replay, which has none of these accounts, stays clean.
INSERT INTO public.facility_executives (facility_id, organization_id, user_id)
SELECT f.id, f.organization_id, u.id
FROM (VALUES
  ('00000000-0000-0000-0002-000000000003'::uuid, '7a56e7e0-bf95-4f09-bf00-0e3f9ab61b08'::uuid), -- Homewood Lodge → COO
  ('00000000-0000-0000-0002-000000000004'::uuid, '399c531e-2237-4c55-9a09-c9f0a1bc4558'::uuid)  -- The Plantation on Summers → CFO
) AS seed(facility_id, user_id)
JOIN public.facilities f ON f.id = seed.facility_id AND f.deleted_at IS NULL
JOIN auth.users u ON u.id = seed.user_id
JOIN public.user_profiles p ON p.id = u.id AND p.deleted_at IS NULL AND p.is_active
ON CONFLICT (facility_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Homewood generator: the asset, its COL-133 subject, and the weekly template
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_facility uuid := '00000000-0000-0000-0002-000000000003';
  v_asset uuid := '00000000-0000-0000-0007-000000000301';
  v_template uuid := '00000000-0000-0000-0007-000000000302';
  v_activity uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.facilities WHERE id = v_facility AND organization_id = v_org AND deleted_at IS NULL) THEN
    RAISE NOTICE 'home_on_tap: Homewood facility not present; skipping generator seed';
    RETURN;
  END IF;

  INSERT INTO public.facility_assets (id, organization_id, facility_id, asset_type, name, description, install_location,
    status, run_check_weekday, run_check_local_time, run_check_set_at)
  VALUES (v_asset, v_org, v_facility, 'generator', 'Emergency generator',
    'Standby generator. Weekly self-test observed and logged by the administrator (Admin Log AL-W01).',
    'Exterior', 'active', 2, '10:00', now())
  ON CONFLICT (id) DO UPDATE SET
    run_check_weekday = COALESCE(public.facility_assets.run_check_weekday, EXCLUDED.run_check_weekday),
    run_check_local_time = COALESCE(public.facility_assets.run_check_local_time, EXCLUDED.run_check_local_time),
    run_check_set_at = COALESCE(public.facility_assets.run_check_set_at, EXCLUDED.run_check_set_at);

  -- COL-133 subjects: the scheduler stamps these on the rows it creates so the
  -- current-authority read policy can answer for a signed-in operator.
  INSERT INTO public.operation_activity_subjects (organization_id, facility_id, subject_kind)
  SELECT v_org, v_facility, 'facility'
  WHERE NOT EXISTS (SELECT 1 FROM public.operation_activity_subjects WHERE facility_id = v_facility AND subject_kind = 'facility');

  INSERT INTO public.operation_activity_subjects (organization_id, facility_id, subject_kind, asset_id)
  SELECT v_org, v_facility, 'asset', v_asset
  WHERE NOT EXISTS (SELECT 1 FROM public.operation_activity_subjects WHERE subject_kind = 'asset' AND asset_id = v_asset);

  SELECT id INTO v_activity FROM public.operation_activities
  WHERE organization_id = v_org AND activity_key = 'hfo-al-w01-01' AND facility_id IS NULL
  LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.operation_task_templates WHERE id = v_template) THEN
    INSERT INTO public.operation_task_templates (id, organization_id, facility_id, name, description, category, cadence_type,
      shift_scope, day_of_week, assignee_role, escalation_ladder, asset_ref, priority, license_threatening,
      compliance_requirement, survey_readiness_impact, requires_dual_sign, estimated_minutes, is_active, activity_id)
    VALUES (v_template, v_org, v_facility,
      'Generator weekly run',
      'Listen for the generator self-test and record whether it ran. The day and time come from the asset schedule, which a vendor visit resets.',
      'safety', 'weekly', 'day', 2, 'facility_administrator', '[]'::jsonb, v_asset, 'high', false,
      'FAC 59A-36.025 emergency environmental control; Admin Log AL-W01', true, false, 10, true, v_activity);
  END IF;
END $$;

-- The scheduler (service job) reads subjects to stamp the COL-133 classification
-- on the rows it creates; without this grant every row it writes stays
-- unclassified and therefore invisible to operators.
GRANT SELECT ON public.operation_activity_subjects TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Claim / release (ownership without duplication)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: browser DML on operation_task_instances is
-- revoked (348), so the write runs as the definer after the same authority
-- checks the operations commands make — a facility operator role, and
-- haven.operation_task_mutable for this row (readable subject, current template
-- links, queue or role match). The row triggers still see auth.uid() and lock
-- the actor's authority before the update lands.
CREATE OR REPLACE FUNCTION public.home_claim_task(p_instance_id uuid, p_claim boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_role text := haven.app_role()::text;
  v_uid uuid := auth.uid();
  v_row public.operation_task_instances;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'org_admin', 'facility_admin', 'manager') THEN
    RAISE EXCEPTION 'Home is for facility operators' USING ERRCODE = '42501';
  END IF;
  IF NOT public.haven_operation_task_access(p_instance_id) THEN
    RAISE EXCEPTION 'Task unavailable' USING ERRCODE = '42501';
  END IF;

  UPDATE public.operation_task_instances
  SET assigned_to = CASE WHEN p_claim THEN v_uid ELSE NULL END,
      assigned_at = CASE WHEN p_claim THEN clock_timestamp() ELSE NULL END,
      assigned_by = v_uid,
      updated_at = clock_timestamp()
  WHERE id = p_instance_id
    AND deleted_at IS NULL
    AND status IN ('pending', 'in_progress')
    AND ((p_claim AND assigned_to IS NULL) OR (NOT p_claim AND assigned_to IS NOT NULL))
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Task cannot be claimed from this state' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('success', true, 'instanceId', v_row.id, 'assignedTo', v_row.assigned_to, 'assignedAt', v_row.assigned_at);
END $$;

REVOKE ALL ON FUNCTION public.home_claim_task(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_claim_task(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.home_claim_task(uuid, boolean) IS
  'COL-37 ruling: definer required — browser DML on operation_task_instances is revoked (348); the function re-checks the caller''s role and haven.operation_task_mutable before writing only assigned_to/assigned_at/assigned_by on one row, and the row guards still lock the caller''s authority (COL-593).';

-- ---------------------------------------------------------------------------
-- 6. The feed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_on_tap(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_role text := haven.app_role()::text;
  v_org uuid := haven.organization_id();
  v_uid uuid := auth.uid();
  v_tz text;
  v_name text;
  v_eod time;
  v_local_date date;
  v_is_weekend boolean;
  v_rows jsonb;
  v_later jsonb;
  v_cleared jsonb;
  v_exec jsonb;
  v_co jsonb;
  v_on_duty jsonb;
  v_count_regulatory integer;
  v_count_assigned integer;
  v_count_cleared integer;
  v_count_later integer;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'org_admin', 'facility_admin', 'manager') THEN
    RAISE EXCEPTION 'Home is for facility operators' USING ERRCODE = '42501';
  END IF;
  IF p_facility_id IS NULL OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT f.name, COALESCE(f.timezone, 'America/New_York'), f.operator_end_of_day_local
  INTO v_name, v_tz, v_eod
  FROM public.facilities f
  WHERE f.id = p_facility_id AND f.organization_id = v_org AND f.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;

  v_local_date := (p_as_of AT TIME ZONE v_tz)::date;
  v_is_weekend := extract(isodow FROM v_local_date) IN (6, 7);

  -- Every candidate row the operator queue can see for this building, with the
  -- bucket decided from the template, never from free text. One pass; the
  -- lanes (today / later / cleared) are aggregated from the same candidates.
  WITH candidates AS (
    SELECT
      jsonb_strip_nulls(jsonb_build_object(
        'id', 'oti:' || i.id,
        'instanceId', i.id,
        'bucket', c.bucket,
        'title', i.template_name,
        'category', i.template_category,
        'cadence', i.template_cadence_type,
        'status', i.status,
        'assignedShiftDate', i.assigned_shift_date,
        'dueAt', i.due_at,
        'overdue', (c.lane = 'today' AND i.assigned_shift_date < v_local_date),
        'licenseThreatening', i.license_threatening,
        'requiresDualSign', i.requires_dual_sign,
        'catalogKey', a.activity_key,
        'owner', CASE WHEN i.assigned_to IS NULL THEN jsonb_build_object('kind', 'queue')
                 ELSE jsonb_build_object('kind', 'user', 'userId', i.assigned_to, 'displayName', owner_profile.full_name, 'claimedAt', i.assigned_at) END,
        'assetSchedule', CASE WHEN asset.id IS NULL THEN NULL ELSE jsonb_build_object(
          'assetName', asset.name, 'weekday', asset.run_check_weekday, 'localTime', asset.run_check_local_time,
          'setAt', asset.run_check_set_at, 'lastServiceAt', asset.last_service_at) END,
        'completedAt', i.completed_at,
        'completedBy', completer.full_name,
        'completionNotes', CASE WHEN i.status = 'completed' THEN i.completion_notes END,
        'escalationLevel', i.current_escalation_level,
        'href', '/admin/operations/work?facility_id=' || p_facility_id::text
      )) AS row_json,
      c.bucket, c.lane, i.due_at AS sort_at, i.assigned_shift_date AS sort_date, i.completed_at
    FROM public.operation_task_instances i
    LEFT JOIN public.operation_task_templates t ON t.id = i.template_id
    LEFT JOIN public.operation_activities a ON a.id = COALESCE(i.activity_id, t.activity_id)
    -- The template row itself is hidden from operators by the current-authority
    -- read policy (its activity is asset-kind, not facility-kind), so the asset
    -- rides on the instance's classified subject instead of on the template.
    LEFT JOIN public.operation_activity_subjects subject ON subject.id = i.subject_id AND subject.subject_kind = 'asset'
    LEFT JOIN public.facility_assets asset ON asset.id = COALESCE(subject.asset_id, t.asset_ref) AND asset.deleted_at IS NULL
    LEFT JOIN public.user_profiles owner_profile ON owner_profile.id = i.assigned_to
    LEFT JOIN public.user_profiles completer ON completer.id = COALESCE(i.verified_by, i.signed_by)
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN i.license_threatening OR COALESCE(t.license_threatening, false)
            OR COALESCE(t.survey_readiness_impact, false)
            OR i.template_category IN ('compliance', 'safety') THEN 'regulatory'
          WHEN i.assigned_to = v_uid
            OR i.assigned_role IN ('facility_admin', 'manager', 'facility_administrator') THEN 'assigned'
          ELSE NULL
        END AS bucket,
        CASE
          WHEN i.status = 'completed' AND i.completed_at IS NOT NULL
            AND (i.completed_at AT TIME ZONE v_tz)::date = v_local_date THEN 'cleared'
          WHEN i.status IN ('pending', 'in_progress')
            AND i.assigned_shift_date BETWEEN v_local_date - 14 AND v_local_date THEN 'today'
          WHEN i.status IN ('pending', 'in_progress')
            AND i.assigned_shift_date BETWEEN v_local_date + 1 AND v_local_date + 7 THEN 'later'
          ELSE NULL
        END AS lane
    ) c
    WHERE i.organization_id = v_org
      AND i.facility_id = p_facility_id
      AND i.deleted_at IS NULL
      AND c.bucket IS NOT NULL
      AND c.lane IS NOT NULL
      -- DEC-2026-09-21-11: nothing night-only on this page in Wave 1.
      AND COALESCE(i.assigned_shift, t.shift_scope, 'day') <> 'night'
  )
  SELECT
    -- E1: no items on Saturday or Sunday. Cleared rows still show what was done.
    COALESCE((SELECT jsonb_agg(row_json ORDER BY CASE bucket WHEN 'regulatory' THEN 1 ELSE 3 END, sort_at NULLS LAST, sort_date)
              FROM candidates WHERE lane = 'today' AND NOT v_is_weekend), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(row_json ORDER BY sort_date, sort_at NULLS LAST)
              FROM candidates WHERE lane = 'later'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(row_json ORDER BY completed_at DESC NULLS LAST)
              FROM (SELECT row_json, completed_at FROM candidates WHERE lane = 'cleared'
                    ORDER BY completed_at DESC NULLS LAST LIMIT 5) cleared), '[]'::jsonb),
    (SELECT count(*) FROM candidates WHERE lane = 'today' AND bucket = 'regulatory' AND NOT v_is_weekend),
    (SELECT count(*) FROM candidates WHERE lane = 'today' AND bucket = 'assigned' AND NOT v_is_weekend),
    (SELECT count(*) FROM candidates WHERE lane = 'cleared'),
    (SELECT count(*) FROM candidates WHERE lane = 'later')
  INTO v_rows, v_later, v_cleared, v_count_regulatory, v_count_assigned, v_count_cleared, v_count_later;

  SELECT CASE WHEN fe.user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'userId', fe.user_id, 'displayName', ep.full_name, 'title', 'Facility Executive') END
  INTO v_exec
  FROM public.facility_executives fe
  LEFT JOIN public.user_profiles ep ON ep.id = fe.user_id
  WHERE fe.facility_id = p_facility_id AND fe.organization_id = v_org;

  -- The other operator titles who cover this building (not a claim about today).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', p.id, 'displayName', p.full_name, 'title', p.job_title)
      ORDER BY p.full_name), '[]'::jsonb)
  INTO v_co
  FROM public.user_profiles p
  JOIN public.user_facility_access ufa ON ufa.user_id = p.id AND ufa.facility_id = p_facility_id AND ufa.revoked_at IS NULL
  WHERE p.organization_id = v_org AND p.deleted_at IS NULL AND p.is_active
    AND p.app_role::text IN ('facility_admin', 'manager') AND p.id <> v_uid;

  -- Who has a shift today at this building among the operator titles.
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('userId', p.id, 'displayName', p.full_name, 'title', p.job_title)), '[]'::jsonb)
  INTO v_on_duty
  FROM public.shift_assignments sa
  JOIN public.staff s ON s.id = sa.staff_id AND s.deleted_at IS NULL
  JOIN public.user_profiles p ON p.id = s.user_id AND p.deleted_at IS NULL AND p.is_active
  WHERE sa.facility_id = p_facility_id AND sa.shift_date = v_local_date AND sa.deleted_at IS NULL
    AND sa.status::text NOT IN ('called_out', 'no_show')
    AND p.app_role::text IN ('facility_admin', 'manager') AND p.id <> v_uid;

  RETURN jsonb_build_object(
    'facilityId', p_facility_id,
    'facilityName', v_name,
    'timezone', v_tz,
    'asOf', p_as_of,
    'localDate', v_local_date,
    'isWeekend', v_is_weekend,
    'endOfDayLocal', to_char(v_eod, 'HH24:MI'),
    'escalatesTo', v_exec,
    'coOperators', v_co,
    'onDutyToday', v_on_duty,
    'counts', jsonb_build_object(
      'regulatory', v_count_regulatory,
      'assigned', v_count_assigned,
      'clearedToday', v_count_cleared,
      'later', v_count_later
    ),
    'rows', v_rows,
    'later', v_later,
    'cleared', v_cleared
  );
END $$;

REVOKE ALL ON FUNCTION public.home_on_tap(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_on_tap(uuid, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.home_on_tap(uuid, timestamptz) IS
  'Facility Operator Home feed (COL-593). SECURITY INVOKER: RLS on operation_task_instances is the scope; the caller sees only rows the current-authority policy answers for. Buckets: regulatory (license_threatening / compliance / safety / survey_readiness_impact) and assigned (the operator queue or the caller). FYI rows come from admin_command_center_projection in the app.';

-- ---------------------------------------------------------------------------
-- 7. End-of-day escalation (runs from pg_cron; delivery is the executive panel)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_escalate_uncleared(p_facility_id uuid DEFAULT NULL, p_as_of timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer := 0;
  f record;
  v_local_date date;
  v_local_time time;
  v_exec uuid;
  v_updated integer;
BEGIN
  FOR f IN
    SELECT id, organization_id, COALESCE(timezone, 'America/New_York') AS tz, operator_end_of_day_local
    FROM public.facilities
    WHERE deleted_at IS NULL AND (p_facility_id IS NULL OR id = p_facility_id)
  LOOP
    v_local_date := (p_as_of AT TIME ZONE f.tz)::date;
    v_local_time := (p_as_of AT TIME ZONE f.tz)::time;
    IF extract(isodow FROM v_local_date) IN (6, 7) OR v_local_time < f.operator_end_of_day_local THEN
      CONTINUE;
    END IF;
    SELECT user_id INTO v_exec FROM public.facility_executives WHERE facility_id = f.id;

    UPDATE public.operation_task_instances i
    SET current_escalation_level = 1,
        escalation_triggered_at = p_as_of,
        escalation_history = COALESCE(i.escalation_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'level', 1, 'to', v_exec, 'at', p_as_of, 'reason', 'uncleared_end_of_day', 'local_date', v_local_date)),
        updated_at = clock_timestamp()
    FROM public.operation_task_templates t
    WHERE t.id = i.template_id
      AND i.facility_id = f.id AND i.organization_id = f.organization_id
      AND i.deleted_at IS NULL
      AND i.status IN ('pending', 'in_progress')
      AND i.assigned_shift_date = v_local_date
      AND COALESCE(i.current_escalation_level, 0) = 0
      AND COALESCE(i.assigned_shift, t.shift_scope, 'day') <> 'night'
      AND (i.license_threatening OR t.license_threatening OR t.survey_readiness_impact
           OR i.template_category IN ('compliance', 'safety')
           OR i.assigned_role IN ('facility_admin', 'manager', 'facility_administrator'));
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_count := v_count + v_updated;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.home_escalate_uncleared(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.home_escalate_uncleared(uuid, timestamptz) IS
  'End-of-day sweep (COL-593 §5.4): every operator-queue row still open at the facility''s operator_end_of_day_local is escalated to level 1 for the Facility Executive. Delivery is the Escalated panel on the executive page; push/email waits on COL-152. Scheduled by scripts/operator-home/cron-schedules.sql.';

-- ---------------------------------------------------------------------------
-- 8. What the Facility Executive reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_escalations_for_executive()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'instanceId', i.id,
      'facilityId', i.facility_id,
      'facilityName', f.name,
      'title', i.template_name,
      'assignedShiftDate', i.assigned_shift_date,
      'status', i.status,
      'escalatedAt', i.escalation_triggered_at,
      'owner', CASE WHEN i.assigned_to IS NULL THEN jsonb_build_object('kind', 'queue')
               ELSE jsonb_build_object('kind', 'user', 'userId', i.assigned_to, 'displayName', p.full_name) END,
      'href', '/admin/operations/work?facility_id=' || i.facility_id::text
    ) ORDER BY i.escalation_triggered_at DESC NULLS LAST, i.assigned_shift_date DESC), '[]'::jsonb)
  FROM public.operation_task_instances i
  JOIN public.facility_executives fe ON fe.facility_id = i.facility_id AND fe.user_id = auth.uid()
  JOIN public.facilities f ON f.id = i.facility_id
  LEFT JOIN public.user_profiles p ON p.id = i.assigned_to
  WHERE i.deleted_at IS NULL
    AND i.status IN ('pending', 'in_progress')
    AND COALESCE(i.current_escalation_level, 0) >= 1
    AND i.assigned_shift_date >= current_date - 14
$$;

REVOKE ALL ON FUNCTION public.home_escalations_for_executive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_escalations_for_executive() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
