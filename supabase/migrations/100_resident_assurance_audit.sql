-- Resident Assurance Engine (Module 25) — updated_at + audit triggers

CREATE TRIGGER tr_resident_observation_plans_set_updated_at
  BEFORE UPDATE ON resident_observation_plans
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_plan_rules_set_updated_at
  BEFORE UPDATE ON resident_observation_plan_rules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_watch_protocols_set_updated_at
  BEFORE UPDATE ON resident_watch_protocols
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_watch_instances_set_updated_at
  BEFORE UPDATE ON resident_watch_instances
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_tasks_set_updated_at
  BEFORE UPDATE ON resident_observation_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_logs_set_updated_at
  BEFORE UPDATE ON resident_observation_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_exceptions_set_updated_at
  BEFORE UPDATE ON resident_observation_exceptions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_escalations_set_updated_at
  BEFORE UPDATE ON resident_observation_escalations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_integrity_flags_set_updated_at
  BEFORE UPDATE ON resident_observation_integrity_flags
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_templates_set_updated_at
  BEFORE UPDATE ON resident_observation_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_observation_plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_plans
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_plan_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_plan_rules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_watch_protocols_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_watch_protocols
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_watch_instances_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_watch_instances
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_tasks_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_tasks
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_logs_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_exceptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_exceptions
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_assignments_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_assignments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_escalations_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_escalations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_integrity_flags_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_integrity_flags
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_observation_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_observation_templates
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_watch_events_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_watch_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
