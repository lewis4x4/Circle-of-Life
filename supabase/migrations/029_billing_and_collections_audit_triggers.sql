-- Audit + updated_at triggers for billing and collections (spec 16 + foundation patterns)

CREATE TRIGGER tr_rate_schedules_set_updated_at
  BEFORE UPDATE ON rate_schedules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_rate_schedules_audit
  AFTER INSERT OR UPDATE OR DELETE ON rate_schedules
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_resident_payers_set_updated_at
  BEFORE UPDATE ON resident_payers
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_resident_payers_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_payers
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_invoices_set_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_invoice_line_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_collection_activities_audit
  AFTER INSERT OR UPDATE OR DELETE ON collection_activities
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_invoice_sequences_audit
  AFTER INSERT OR UPDATE OR DELETE ON invoice_sequences
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
