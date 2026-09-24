-- Reconcile Workforce clock evidence with the released floor timeclock helper.
-- Migration 501 tightened the age of rounding evidence but independently
-- reimplemented the opening-punch read. Keep floor/rounding shift identity in
-- one helper and apply the configurable freshness cutoff to its result.
-- Existing setting defaults to 960 minutes; no facility flag or device changes.
BEGIN;

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
    opening.clocked_in_at
  FROM
    public.staff s
    JOIN public.user_profiles p ON p.id = s.user_id
      AND p.organization_id = s.organization_id
    JOIN auth.users au ON au.id = p.id
    -- The in punch that opened the current stint, from the timeclock domain:
    -- null unless the person is in or on a meal break and that punch was made
    -- at this facility. The timeclock owns the shift window; rounding does not
    -- restate it.
    CROSS JOIN LATERAL (
      SELECT
        haven.floor_clocked_in_at (s.id, p_facility_id, p_at) AS clocked_in_at) opening
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
    AND opening.clocked_in_at >= p_at - make_interval(mins => (
      SELECT t.rounding_clock_evidence_max_age_minutes
      FROM public.timeclock_facility_settings t
      WHERE t.organization_id = s.organization_id
        AND t.facility_id = p_facility_id
    ));
$func$;

COMMENT ON FUNCTION haven.observation_on_clock_staff (uuid, timestamptz) IS
  'COL-693: staff on the clock (in or on a meal break) at a facility whose timeclock is enabled, whose opening in punch was at that facility, whose role is in the facility''s rounding_owner_roles (default med_tech), and who could complete any check there: active profile and auth user, active staff row at the facility, facility grant unless owner or org_admin. Returns when the opening in punch was made. On-clock state, the opening punch and its facility come from haven.floor_clocked_in_at (the timeclock domain); the returned opening punch also must be within rounding_clock_evidence_max_age_minutes, default 960. Private helper for the rounding owner chain.';

REVOKE ALL ON FUNCTION haven.observation_on_clock_staff (uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
