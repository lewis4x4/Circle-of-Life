-- RLS helpers live in schema haven (Supabase reserves auth.* for platform use).
-- Spec referenced auth.organization_id(); we use haven.organization_id() equivalently.

CREATE SCHEMA IF NOT EXISTS haven;

GRANT USAGE ON SCHEMA haven TO authenticated, service_role;

CREATE OR REPLACE FUNCTION haven.organization_id ()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    organization_id
  FROM
    public.user_profiles
  WHERE
    id = auth.uid ()
  LIMIT 1
$func$;

CREATE OR REPLACE FUNCTION haven.app_role ()
  RETURNS public.app_role
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    app_role
  FROM
    public.user_profiles
  WHERE
    id = auth.uid ()
  LIMIT 1
$func$;

CREATE OR REPLACE FUNCTION haven.has_facility_access (p_facility_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    EXISTS (
      SELECT
        1
      FROM
        public.user_facility_access
      WHERE
        user_id = auth.uid ()
        AND facility_id = p_facility_id
        AND revoked_at IS NULL) OR (haven.app_role () IN ('owner', 'org_admin'))
$func$;

CREATE OR REPLACE FUNCTION haven.accessible_facility_ids ()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    f.id
  FROM
    public.facilities f
  WHERE
    f.organization_id = haven.organization_id ()
    AND f.deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  UNION
  SELECT
    ufa.facility_id
  FROM
    public.user_facility_access ufa
  WHERE
    ufa.user_id = auth.uid ()
    AND ufa.revoked_at IS NULL
    AND haven.app_role () NOT IN ('owner', 'org_admin')
$func$;

CREATE OR REPLACE FUNCTION haven.can_access_resident (p_resident_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $func$
  SELECT
    CASE WHEN haven.app_role () != 'family' THEN
      TRUE
    ELSE
      EXISTS (
        SELECT
          1
        FROM
          public.family_resident_links
        WHERE
          user_id = auth.uid ()
          AND resident_id = p_resident_id
          AND revoked_at IS NULL)
    END
$func$;

GRANT EXECUTE ON FUNCTION haven.organization_id () TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION haven.app_role () TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION haven.has_facility_access (uuid) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION haven.accessible_facility_ids () TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION haven.can_access_resident (uuid) TO authenticated, service_role;
