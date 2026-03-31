-- Audit + updated_at for daily operations tables (spec 04 + foundation patterns)

CREATE TRIGGER tr_daily_logs_set_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_daily_logs_audit
  AFTER INSERT OR UPDATE OR DELETE ON daily_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_adl_logs_audit
  AFTER INSERT OR UPDATE OR DELETE ON adl_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_medications_set_updated_at
  BEFORE UPDATE ON resident_medications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_medications_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_medications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_emar_records_set_updated_at
  BEFORE UPDATE ON emar_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_emar_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON emar_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_behavioral_logs_audit
  AFTER INSERT OR UPDATE OR DELETE ON behavioral_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_condition_changes_audit
  AFTER INSERT OR UPDATE OR DELETE ON condition_changes
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_shift_handoffs_set_updated_at
  BEFORE UPDATE ON shift_handoffs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_shift_handoffs_audit
  AFTER INSERT OR UPDATE OR DELETE ON shift_handoffs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_activities_set_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_activities_audit
  AFTER INSERT OR UPDATE OR DELETE ON activities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_activity_sessions_audit
  AFTER INSERT OR UPDATE OR DELETE ON activity_sessions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_activity_attendance_audit
  AFTER INSERT OR UPDATE OR DELETE ON activity_attendance
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
