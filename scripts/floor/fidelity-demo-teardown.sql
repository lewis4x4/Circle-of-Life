-- Remove the floor tablet and kiosk fidelity demo from Haven HFO Staging.
--
-- Spec: docs/specs/40-floor-tablet-and-kiosk.md section 10, DESIGN.md section 6 (COL-694).
-- What it removes: everything scripts/floor/seed-prototype-demo.mjs and the floor-kiosk
-- Playwright project created, and nothing else. That is one organization, "Haven Demo
-- Workspace (Fidelity)", its one entity and its one facility, "Fidelity Demo - Floor
-- Kiosk", every row under them, and the auth users with an @fidelity-demo.invalid
-- address. Staging only: the seed never runs against production and neither does this.
--
-- Commands (from the repository root, in a checkout linked to Haven HFO Staging):
--
--   Dry run (read only; prints what would be deleted, table by table, and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "iwcnajanvjvynolltflw" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/fidelity-demo-teardown.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "iwcnajanvjvynolltflw" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col695_apply = 'fidelity-demo-teardown';"; cat scripts/floor/fidelity-demo-teardown.sql; } > /tmp/fidelity-demo-teardown-apply.sql
--     supabase db query --linked -f /tmp/fidelity-demo-teardown-apply.sql
--
-- Plain SQL, the same shape as the Part 7 scripts: `supabase db query` goes through the
-- Management API, which runs no psql meta-commands. The apply switch is a session setting
-- whose value must name this script. The final statement is the report.
--
-- Scope and refusals. The organization and facility are the seed's fixed ids AND must
-- carry the seed's names; the organization must hold exactly that one facility and that
-- one entity; every profile in it must use the reserved address domain; and every auth
-- user on that domain must belong to it (or to nobody). Anything else stops the script
-- before a row changes. Every delete below is keyed by the demo organization id, the demo
-- facility id or the demo user ids, on indexed columns, over a named list of tables: no
-- catalog-driven scan runs here. The final DELETE of the organization row is the loud
-- backstop: a table this list does not know about still references the organization, the
-- foreign key refuses, and the whole transaction rolls back.
--
-- Append-only ledgers. time_punches, timeclock_sync_rejections, floor_unlocks,
-- resident_observation_logs and rounding_completion_receipts refuse DELETE for every role by trigger. The apply follows the
-- documented staging cleanup pattern (scripts/benefits/staging-smoke-cleanup.sql): those
-- named guard triggers are disabled inside this one transaction, only rows keyed to the
-- demo organization are deleted, and the triggers are enabled again before COMMIT. ALTER
-- TABLE is transactional and holds an exclusive lock until the end, so no other session
-- ever writes to those tables while a guard is off. The apply re-checks that every guard
-- is enabled before it commits. audit_log has no delete trigger; its rows for the demo
-- organization and the demo users (and the rows this teardown's own deletes write) are
-- removed last, because audit_log.user_id references auth.users and would otherwise keep
-- the demo auth users alive. Nothing outside the demo organization's audit trail is touched.
--
-- Safe to run twice: a second apply finds nothing and says so.

DROP TABLE IF EXISTS pg_temp.fidelity_teardown_report;
CREATE TEMP TABLE fidelity_teardown_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);

BEGIN;
SET LOCAL statement_timeout = '110s';

DO $teardown$
DECLARE
  c_script CONSTANT text := 'fidelity-demo-teardown';
  c_org CONSTANT uuid := 'f1de0677-dbc2-43a3-8d61-8ccac32e7f5c';
  c_entity CONSTANT uuid := 'f1de0677-32f8-4574-8db1-85c70a05736b';
  c_fac CONSTANT uuid := 'f1de0677-c6b1-4cc1-838a-6a05e090fe83';
  c_org_name CONSTANT text := 'Haven Demo Workspace (Fidelity)';
  c_fac_name CONSTANT text := 'Fidelity Demo - Floor Kiosk';
  c_domain CONSTANT text := '@fidelity-demo.invalid';
  c_col_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  v_apply boolean := coalesce(current_setting('haven.col695_apply', true), '') = c_script;
  v_users uuid[];
  v_n bigint;
  v_total bigint := 0;
  v_step record;
  v_guard record;
BEGIN
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END);

  -- ---------------------------------------------------------------------------
  -- Scope checks. Any surprise stops here.
  -- ---------------------------------------------------------------------------
  IF c_org = c_col_org THEN
    RAISE EXCEPTION 'Refusing: the demo organization id is the Circle of Life organization';
  END IF;
  IF current_database() IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'haven') THEN
    RAISE EXCEPTION 'Refusing: this is not a Haven database';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c_org) THEN
    INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('result', 'nothing to do', 'The demo organization does not exist.');
    SELECT count(*) INTO v_n FROM auth.users u WHERE u.email LIKE '%' || c_domain;
    IF v_n > 0 THEN
      INSERT INTO fidelity_teardown_report (section, item, detail)
        VALUES ('result', 'auth users on ' || c_domain, v_n || ' left without an organization; the apply removes them');
      IF v_apply THEN
        IF EXISTS (SELECT 1 FROM auth.users u JOIN public.user_profiles p ON p.id = u.id WHERE u.email LIKE '%' || c_domain) THEN
          RAISE EXCEPTION 'Refusing: a % auth user still has a profile', c_domain;
        END IF;
        DELETE FROM public.audit_log a USING auth.users u WHERE a.user_id = u.id AND u.email LIKE '%' || c_domain;
        DELETE FROM auth.users u WHERE u.email LIKE '%' || c_domain;
      END IF;
    END IF;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = c_org AND o.name = c_org_name) THEN
    RAISE EXCEPTION 'Refusing: organization % is not named %', c_org, c_org_name;
  END IF;
  SELECT count(*) INTO v_n FROM public.facilities f WHERE f.organization_id = c_org;
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = c_fac AND f.organization_id = c_org AND f.name = c_fac_name) THEN
    RAISE EXCEPTION 'Refusing: the demo organization holds % facilities; expected exactly %', v_n, c_fac_name;
  END IF;
  SELECT count(*) INTO v_n FROM public.entities e WHERE e.organization_id = c_org;
  IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.id = c_entity AND e.organization_id = c_org) THEN
    RAISE EXCEPTION 'Refusing: the demo organization holds % entities; expected exactly the seed''s one', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.organization_id = c_org AND p.email NOT LIKE '%' || c_domain) THEN
    RAISE EXCEPTION 'Refusing: the demo organization has a profile outside %', c_domain;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u JOIN public.user_profiles p ON p.id = u.id
             WHERE u.email LIKE '%' || c_domain AND p.organization_id IS DISTINCT FROM c_org) THEN
    RAISE EXCEPTION 'Refusing: a % auth user belongs to another organization', c_domain;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_facility_access a JOIN auth.users u ON u.id = a.user_id
             WHERE u.email LIKE '%' || c_domain AND a.facility_id <> c_fac) THEN
    RAISE EXCEPTION 'Refusing: a % user has access to another facility', c_domain;
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff s JOIN auth.users u ON u.id = s.user_id
             WHERE u.email LIKE '%' || c_domain AND s.organization_id <> c_org) THEN
    RAISE EXCEPTION 'Refusing: a % user has a staff row in another organization', c_domain;
  END IF;
  SELECT coalesce(array_agg(u.id), '{}') INTO v_users FROM auth.users u WHERE u.email LIKE '%' || c_domain;

  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES
    ('scope', 'organization', c_org::text || ' ' || c_org_name),
    ('scope', 'facility', c_fac::text || ' ' || c_fac_name),
    ('scope', 'auth users on ' || c_domain, cardinality(v_users)::text);

  -- ---------------------------------------------------------------------------
  -- The named list, children first. key: org = organization_id, fac = facility_id,
  -- user = user_id among the demo users, id = the row id itself.
  -- ---------------------------------------------------------------------------
  CREATE TEMP TABLE IF NOT EXISTS fidelity_teardown_steps (ord integer PRIMARY KEY, tbl text NOT NULL, keycol text NOT NULL, keyval text NOT NULL) ON COMMIT DROP;
  DELETE FROM fidelity_teardown_steps;
  INSERT INTO fidelity_teardown_steps (ord, tbl, keycol, keyval) VALUES
    (10, 'public.floor_unlocks', 'organization_id', 'org'),
    (20, 'public.visitor_log_entries', 'organization_id', 'org'),
    (30, 'public.time_punches', 'organization_id', 'org'),
    (40, 'public.timeclock_sync_rejections', 'organization_id', 'org'),
    (44, 'public.incident_followups', 'organization_id', 'org'),
    (50, 'public.care_events', 'organization_id', 'org'),
    (55, 'public.incidents', 'organization_id', 'org'),
    (58, 'public.shift_handoff_notes', 'organization_id', 'org'),
    (60, 'public.resident_observation_escalations', 'organization_id', 'org'),
    (65, 'public.resident_observation_integrity_flags', 'organization_id', 'org'),
    (68, 'public.rounding_completion_receipts', 'organization_id', 'org'),
    (70, 'public.resident_observation_logs', 'organization_id', 'org'),
    (80, 'public.resident_observation_tasks', 'organization_id', 'org'),
    (85, 'public.resident_monitoring_order_events', 'organization_id', 'org'),
    (90, 'public.resident_monitoring_orders', 'organization_id', 'org'),
    (100, 'public.resident_watch_instances', 'organization_id', 'org'),
    (110, 'public.resident_watch_protocols', 'organization_id', 'org'),
    (120, 'public.observation_vocab', 'organization_id', 'org'),
    (130, 'public.facility_observation_thresholds', 'facility_id', 'fac'),
    (140, 'public.facility_shift_definitions', 'facility_id', 'fac'),
    (145, 'public.facility_observation_shift_history', 'facility_id', 'fac'),
    (150, 'public.exec_alerts', 'organization_id', 'org'),
    (160, 'public.resident_status_history', 'organization_id', 'org'),
    (170, 'public.residents', 'organization_id', 'org'),
    (180, 'public.beds', 'organization_id', 'org'),
    (190, 'public.rooms', 'organization_id', 'org'),
    (200, 'public.units', 'organization_id', 'org'),
    (210, 'public.timeclock_enrollment_codes', 'organization_id', 'org'),
    (220, 'public.timeclock_devices', 'organization_id', 'org'),
    (230, 'public.timeclock_credentials', 'organization_id', 'org'),
    (240, 'public.timeclock_facility_settings', 'organization_id', 'org'),
    (250, 'public.staff', 'organization_id', 'org'),
    (260, 'public.user_facility_access', 'organization_id', 'org'),
    (270, 'public.user_profiles', 'organization_id', 'org'),
    (272, 'public.incident_sequences', 'facility_id', 'fac'),
    (275, 'public.search_documents', 'organization_id', 'org'),
    (280, 'public.facilities', 'id', 'fac'),
    (285, 'public.staff_certification_settings', 'organization_id', 'org'),
    (286, 'public.operating_rules', 'organization_id', 'org'),
    (290, 'public.entities', 'organization_id', 'org'),
    (300, 'public.organizations', 'id', 'org');

  FOR v_step IN SELECT * FROM fidelity_teardown_steps ORDER BY ord LOOP
    IF to_regclass(v_step.tbl) IS NULL THEN
      INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('would delete', v_step.tbl, 'table not present');
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_step.tbl, v_step.keycol)
      INTO v_n USING CASE v_step.keyval WHEN 'org' THEN c_org ELSE c_fac END;
    v_total := v_total + v_n;
    INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('would delete', v_step.tbl, v_n::text);
  END LOOP;
  SELECT count(*) INTO v_n FROM auth.users u WHERE u.id = ANY (v_users);
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('would delete', 'auth.users (' || c_domain || ')', v_n::text);
  SELECT count(*) INTO v_n FROM public.audit_log a WHERE a.organization_id = c_org;
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('would delete', 'public.audit_log (demo organization)', v_n::text);
  SELECT count(*) INTO v_n FROM public.audit_log a WHERE a.user_id = ANY (v_users) AND a.organization_id IS DISTINCT FROM c_org;
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('would delete', 'public.audit_log (demo users, no organization)', v_n::text);
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('would delete', 'total rows in listed tables', v_total::text);

  IF NOT v_apply THEN
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Apply.
  -- ---------------------------------------------------------------------------
  ALTER TABLE public.floor_unlocks DISABLE TRIGGER tr_floor_unlocks_guard;
  ALTER TABLE public.time_punches DISABLE TRIGGER tr_time_punches_append_only;
  ALTER TABLE public.timeclock_sync_rejections DISABLE TRIGGER tr_timeclock_sync_rejections_append_only;
  ALTER TABLE public.resident_observation_logs DISABLE TRIGGER tr_rounding_logs_immutable;
  ALTER TABLE public.rounding_completion_receipts DISABLE TRIGGER tr_rounding_completion_receipts_immutable;

  -- Cycles the ordered list cannot express: a check points at its log, a bed at its resident.
  UPDATE public.resident_observation_tasks SET completed_log_id = NULL WHERE organization_id = c_org AND completed_log_id IS NOT NULL;
  UPDATE public.beds SET current_resident_id = NULL WHERE organization_id = c_org AND current_resident_id IS NOT NULL;
  UPDATE public.user_profiles SET manager_user_id = NULL WHERE organization_id = c_org AND manager_user_id IS NOT NULL;

  FOR v_step IN SELECT * FROM fidelity_teardown_steps ORDER BY ord LOOP
    CONTINUE WHEN to_regclass(v_step.tbl) IS NULL;
    EXECUTE format('DELETE FROM %s WHERE %I = $1', v_step.tbl, v_step.keycol)
      USING CASE v_step.keyval WHEN 'org' THEN c_org ELSE c_fac END;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('deleted', v_step.tbl, v_n::text);
  END LOOP;

  ALTER TABLE public.floor_unlocks ENABLE TRIGGER tr_floor_unlocks_guard;
  ALTER TABLE public.time_punches ENABLE TRIGGER tr_time_punches_append_only;
  ALTER TABLE public.timeclock_sync_rejections ENABLE TRIGGER tr_timeclock_sync_rejections_append_only;
  ALTER TABLE public.resident_observation_logs ENABLE TRIGGER tr_rounding_logs_immutable;
  ALTER TABLE public.rounding_completion_receipts ENABLE TRIGGER tr_rounding_completion_receipts_immutable;

  -- The audit trail of the demo organization (including what the deletes above just
  -- wrote), then the demo users. audit_log.user_id references auth.users.
  DELETE FROM public.audit_log a WHERE a.organization_id = c_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('deleted', 'public.audit_log (demo organization)', v_n::text);
  DELETE FROM public.audit_log a WHERE a.user_id = ANY (v_users);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('deleted', 'public.audit_log (demo users)', v_n::text);
  DELETE FROM auth.users u WHERE u.id = ANY (v_users) AND u.email LIKE '%' || c_domain;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('deleted', 'auth.users (' || c_domain || ')', v_n::text);

  -- Before commit: every guard is back on, and nothing of the demo is left.
  FOR v_guard IN SELECT t.tgname, t.tgenabled FROM pg_catalog.pg_trigger t
                 WHERE t.tgname IN ('tr_floor_unlocks_guard', 'tr_time_punches_append_only',
                                    'tr_timeclock_sync_rejections_append_only', 'tr_rounding_logs_immutable',
                                    'tr_rounding_completion_receipts_immutable') LOOP
    IF v_guard.tgenabled = 'D' THEN
      RAISE EXCEPTION 'Guard % is still disabled; rolled back', v_guard.tgname;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = c_org) OR EXISTS (SELECT 1 FROM public.facilities WHERE id = c_fac)
     OR EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%' || c_domain) THEN
    RAISE EXCEPTION 'The demo is still present after the deletes; rolled back';
  END IF;
  INSERT INTO fidelity_teardown_report (section, item, detail) VALUES ('applied', 'verified', 'demo organization, facility and users gone; guards enabled');
END
$teardown$;

COMMIT;

RESET haven.col695_apply;

SELECT section, item, detail FROM fidelity_teardown_report ORDER BY seq;
