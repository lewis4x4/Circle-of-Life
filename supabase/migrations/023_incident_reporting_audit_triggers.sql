-- Audit + updated_at triggers for incident module tables (spec 07 + foundation patterns)

CREATE TRIGGER tr_incidents_set_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_incidents_audit
  AFTER INSERT OR UPDATE OR DELETE ON incidents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_incident_followups_set_updated_at
  BEFORE UPDATE ON incident_followups
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_incident_followups_audit
  AFTER INSERT OR UPDATE OR DELETE ON incident_followups
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_incident_photos_audit
  AFTER INSERT OR UPDATE OR DELETE ON incident_photos
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_incident_sequences_audit
  AFTER INSERT OR UPDATE OR DELETE ON incident_sequences
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
