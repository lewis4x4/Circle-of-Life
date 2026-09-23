-- COL-664 probe. RLS helpers that do not depend on the row must be wrapped in
-- (SELECT ...) so Postgres evaluates them once per statement (an InitPlan)
-- rather than once per row. A bare haven.app_role() / haven.organization_id()
-- re-runs haven.current_authorized_actor() for every row read, which made
-- observation_compliance_for_range ~25x slower for signed-in users.
--
-- Runs inside a transaction that rolls back; replay-only (reads local catalogs).

BEGIN;

SET LOCAL client_min_messages = warning;

DO $probe$
DECLARE
  v_bad text;
  v_src text;
BEGIN
  -- Every restrictive housekeeper policy (migration 473, re-shaped by 474).
  SELECT string_agg(p.tablename, ', ' ORDER BY p.tablename)
    INTO v_bad
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.policyname = 'Housekeepers see resident name and room only'
    AND p.qual NOT LIKE '%( SELECT haven.app_role()%';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'COL-664: housekeeper policy evaluates haven.app_role() per row on: %', v_bad;
  END IF;

  -- The SELECT policies on the tables observation_compliance_for_range reads.
  SELECT string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname)
    INTO v_bad
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.cmd IN ('SELECT', 'ALL')
    AND p.tablename IN ('resident_observation_tasks', 'resident_observation_logs', 'resident_monitoring_orders',
      'resident_status_history', 'facility_observation_shift_history', 'facility_cadence_versions',
      'facility_cadence_windows', 'facilities')
    AND (replace(p.qual, '( SELECT haven.organization_id()', '') LIKE '%haven.organization_id()%'
      OR replace(p.qual, '( SELECT haven.app_role()', '') LIKE '%haven.app_role()%'
      OR p.qual LIKE '%haven.can_manage_observation_facility(%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'COL-664: per-row RLS helper call in: %', v_bad;
  END IF;

  -- Window projection is resolved once per facility-day, not per resident-day.
  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'observation_compliance_for_range';
  IF v_src NOT LIKE '%date_windows AS MATERIALIZED%' OR v_src NOT LIKE '%cadence_in_force AS MATERIALIZED%' THEN
    RAISE EXCEPTION 'COL-664: observation_compliance_for_range projects windows per resident-day again';
  END IF;

  IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'observation_compliance_for_range') THEN
    RAISE EXCEPTION 'COL-664: observation_compliance_for_range must keep invoker rights (COL-37)';
  END IF;
END
$probe$;

ROLLBACK;
