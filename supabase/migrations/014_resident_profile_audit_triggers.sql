-- Audit + updated_at triggers for resident profile tables (spec 03 + foundation patterns)

CREATE TRIGGER tr_residents_set_updated_at
  BEFORE UPDATE ON residents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_residents_audit
  AFTER INSERT OR UPDATE OR DELETE ON residents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_care_plans_set_updated_at
  BEFORE UPDATE ON care_plans
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_care_plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON care_plans
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_care_plan_items_set_updated_at
  BEFORE UPDATE ON care_plan_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_care_plan_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON care_plan_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_assessments_set_updated_at
  BEFORE UPDATE ON assessments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_assessments_audit
  AFTER INSERT OR UPDATE OR DELETE ON assessments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_photos_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_photos
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_contacts_set_updated_at
  BEFORE UPDATE ON resident_contacts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_contacts_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_contacts
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_documents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
