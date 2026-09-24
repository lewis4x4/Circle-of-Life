-- Keep the reviewed rounding owner evidence age configurable without rewriting
-- deployed migration 495 or the forward reconciliation in 498.
-- Default 960 minutes preserves the existing sixteen-hour evidence window.
-- The upper bound deliberately matches the shared timeclock_state horizon:
-- this setting can tighten rounding evidence freshness, not extend kiosk shifts.
BEGIN;

ALTER TABLE public.timeclock_facility_settings
  ADD COLUMN rounding_clock_evidence_max_age_minutes integer NOT NULL DEFAULT 960
    CONSTRAINT timeclock_rounding_clock_evidence_age_check
    CHECK (rounding_clock_evidence_max_age_minutes BETWEEN 1 AND 960);

COMMENT ON COLUMN public.timeclock_facility_settings.rounding_clock_evidence_max_age_minutes IS
  'Maximum age in minutes of the opening clock-in used as evidence for a rounding owner (1 to 960, default 960). Tightens the existing sixteen-hour clock-state ceiling; it does not change payroll hours, enable the timeclock, or change the handoff grace. Existing owner/org-admin settings access and audit triggers apply.';

CREATE OR REPLACE FUNCTION haven.observation_on_clock_staff (p_facility_id uuid, p_at timestamptz)
  RETURNS TABLE (
    staff_id uuid,
    clocked_in_at timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
  SELECT
    s.id,
    opening.punched_at
  FROM
    public.staff s
    JOIN public.user_profiles p ON p.id = s.user_id
      AND p.organization_id = s.organization_id
    JOIN auth.users au ON au.id = p.id
    -- The in punch that opened the current stint, and where it was made.
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(tp.facility_id, tc.facility_id) AS facility_id,
        e.punched_at
      FROM
        haven.timeclock_effective_punches(s.id, p_at - make_interval(mins => (
          SELECT settings.rounding_clock_evidence_max_age_minutes
          FROM public.timeclock_facility_settings settings
          WHERE settings.organization_id = s.organization_id
            AND settings.facility_id = p_facility_id
        )), p_at + interval '1 second') e
      LEFT JOIN public.time_punches tp ON e.source = 'punch'
        AND tp.id = e.punch_id
      LEFT JOIN public.time_punch_corrections tc ON e.source = 'correction'
        AND tc.id = e.punch_id
    WHERE
      e.punch_type = 'in'
    ORDER BY
      e.punched_at DESC
    LIMIT 1) opening
  WHERE
    s.facility_id = p_facility_id
    AND s.deleted_at IS NULL
    AND s.employment_status = 'active'
    AND p.is_active
    AND p.deleted_at IS NULL
    AND au.deleted_at IS NULL
    AND (au.banned_until IS NULL OR au.banned_until <= now())
    AND p.app_role::text = ANY (COALESCE((
          SELECT
            t.rounding_owner_roles
          FROM public.timeclock_facility_settings t
          WHERE
            t.organization_id = s.organization_id
            AND t.facility_id = p_facility_id), ARRAY['med_tech']))
    AND (p.app_role::text IN ('owner', 'org_admin')
      OR EXISTS (
        SELECT
          1
        FROM
          public.user_facility_access a
        WHERE
          a.user_id = p.id
          AND a.organization_id = s.organization_id
          AND a.facility_id = p_facility_id
          AND a.revoked_at IS NULL))
    AND EXISTS (
      SELECT
        1
      FROM
        public.timeclock_facility_settings t
      WHERE
        t.organization_id = s.organization_id
        AND t.facility_id = p_facility_id
        AND t.timeclock_enabled)
    AND haven.timeclock_state(s.id, p_at) IN ('in', 'meal')
    AND opening.facility_id = p_facility_id;
$func$;

COMMENT ON FUNCTION haven.observation_on_clock_staff (uuid, timestamptz) IS
  'COL-693: staff on the clock (in or on a meal break) at a facility whose timeclock is enabled, whose opening in punch was at that facility, whose role is in the facility''s rounding_owner_roles (default med_tech), and who could complete any check there: active profile and auth user, active staff row at the facility, facility grant unless owner or org_admin. The opening in punch must be within the facility''s rounding_clock_evidence_max_age_minutes. Returns when it was made. Private helper for the rounding owner chain; the existing shared timeclock state and all authority predicates are unchanged.';

REVOKE ALL ON FUNCTION haven.observation_on_clock_staff (uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
