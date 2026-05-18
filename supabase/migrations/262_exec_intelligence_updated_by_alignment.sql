-- Align Executive Intelligence v1 tables with haven_set_updated_at().
--
-- The shared timestamp trigger assigns NEW.updated_by on every update. Several
-- Executive Intelligence v1 tables had updated_at triggers but no updated_by
-- column, causing updates such as Executive Settings saves to fail with:
-- "record \"new\" has no field \"updated_by\"".

ALTER TABLE public.exec_dashboard_configs
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

ALTER TABLE public.exec_alerts
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

ALTER TABLE public.exec_alert_user_state
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

ALTER TABLE public.benchmark_cohorts
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

ALTER TABLE public.exec_saved_reports
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);
