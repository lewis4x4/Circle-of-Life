-- Audit + updated_at triggers for staff management module (spec 11 + foundation patterns)

CREATE TRIGGER tr_staff_set_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_staff_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_staff_certifications_set_updated_at
  BEFORE UPDATE ON staff_certifications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_staff_certifications_audit
  AFTER INSERT OR UPDATE OR DELETE ON staff_certifications
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_schedules_set_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_schedules_audit
  AFTER INSERT OR UPDATE OR DELETE ON schedules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_shift_assignments_set_updated_at
  BEFORE UPDATE ON shift_assignments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_shift_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON shift_assignments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_time_records_set_updated_at
  BEFORE UPDATE ON time_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_time_records_audit
  AFTER INSERT OR UPDATE OR DELETE ON time_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_shift_swap_requests_set_updated_at
  BEFORE UPDATE ON shift_swap_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_shift_swap_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON shift_swap_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_staffing_ratio_snapshots_audit
  AFTER INSERT OR UPDATE OR DELETE ON staffing_ratio_snapshots
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
