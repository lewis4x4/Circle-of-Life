-- Rollback script for UI-V2 tables. Commit in S2, but do not apply during
-- normal migration replay or db push. To execute during an S12 abort, run this
-- migration with `SET haven.apply_ui_v2_rollback = 'true';`.

DO $$
BEGIN
  IF current_setting('haven.apply_ui_v2_rollback', true) = 'true' THEN
    EXECUTE 'DROP TABLE IF EXISTS public.alert_audit_log CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.facility_metric_targets CASCADE';
    EXECUTE 'DROP TABLE IF EXISTS public.user_dashboard_preferences CASCADE';
  END IF;
END
$$;
