-- Phase 4: Referral and Inquiry — RLS + audit + updated_at triggers

ALTER TABLE referral_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_sources_select ON referral_sources
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ()))
  );

CREATE POLICY referral_sources_insert ON referral_sources
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY referral_sources_update ON referral_sources
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

ALTER TABLE referral_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY referral_leads_select ON referral_leads
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE POLICY referral_leads_insert ON referral_leads
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY referral_leads_update ON referral_leads
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'))
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ()));

CREATE TRIGGER tr_referral_sources_set_updated_at
  BEFORE UPDATE ON referral_sources
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_referral_sources_audit
  AFTER INSERT OR UPDATE OR DELETE ON referral_sources
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();

CREATE TRIGGER tr_referral_leads_set_updated_at
  BEFORE UPDATE ON referral_leads
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at ();

CREATE TRIGGER tr_referral_leads_audit
  AFTER INSERT OR UPDATE OR DELETE ON referral_leads
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log ();
