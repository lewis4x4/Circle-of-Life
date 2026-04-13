-- Migration 163: Force PostgREST schema cache reload.
-- Fixes "Database error querying schema" for nurse/caregiver logins.
--
-- Root cause: PostgREST's schema cache may be stale after migrations 155-161
-- added new types (resident_risk_tier, resident_insight_type, etc.) and tables.
-- The NOTIFY in migration 162 may have been missed if PostgREST was not
-- listening at that exact moment.
--
-- Strategy:
-- 1. Ensure USAGE grants on all custom enum types for authenticated role
-- 2. Touch a function to force schema invalidation
-- 3. Send NOTIFY pgrst reload

-- ── 1. Grant usage on all custom enum types added in recent migrations ──
DO $$ BEGIN
  -- Types from migration 155
  EXECUTE 'GRANT USAGE ON TYPE public.resident_risk_tier TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT USAGE ON TYPE public.resident_insight_type TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT USAGE ON TYPE public.resident_insight_status TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Types from other recent migrations that may lack grants
DO $$ BEGIN
  EXECUTE 'GRANT USAGE ON TYPE public.watch_status TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT USAGE ON TYPE public.watch_trigger_source TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT USAGE ON TYPE public.observation_task_status TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  EXECUTE 'GRANT USAGE ON TYPE public.exception_follow_up_status TO authenticated, anon, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ── 2. Touch haven.organization_id() to invalidate schema cache ──
-- Re-create with identical body; forces PostgREST to see a DDL event.
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

GRANT EXECUTE ON FUNCTION haven.organization_id () TO authenticated, service_role;

-- ── 3. Send schema reload notification ──
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
