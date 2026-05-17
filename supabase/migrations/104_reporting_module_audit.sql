-- Module 26 - Reporting module triggers and audit coverage

CREATE TRIGGER tr_report_templates_set_updated_at
  BEFORE UPDATE ON report_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_report_saved_views_set_updated_at
  BEFORE UPDATE ON report_saved_views
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_saved_views_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_saved_views
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_report_schedules_set_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_schedules_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_schedules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_report_packs_set_updated_at
  BEFORE UPDATE ON report_packs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_packs_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_packs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_report_permissions_set_updated_at
  BEFORE UPDATE ON report_permissions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_permissions_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_permissions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_report_benchmarks_set_updated_at
  BEFORE UPDATE ON report_benchmarks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_benchmarks_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_benchmarks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_report_nlq_mappings_set_updated_at
  BEFORE UPDATE ON report_nlq_mappings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_report_nlq_mappings_audit
  AFTER INSERT OR UPDATE OR DELETE ON report_nlq_mappings
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
