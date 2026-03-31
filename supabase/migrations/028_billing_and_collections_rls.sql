-- RLS for billing and collections (spec 16; helpers = haven.*)

ALTER TABLE rate_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_rate_schedules ON rate_schedules
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY admin_manage_rate_schedules ON rate_schedules
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE resident_payers ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_nurse_see_resident_payers ON resident_payers
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

CREATE POLICY admin_manage_resident_payers ON resident_payers
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_invoices ON invoices
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY family_see_own_invoices ON invoices
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND haven.can_access_resident (resident_id)
    AND EXISTS (
      SELECT
        1
      FROM
        family_resident_links frl
      WHERE
        frl.user_id = auth.uid ()
        AND frl.resident_id = invoices.resident_id
        AND frl.can_view_financial = true
        AND frl.revoked_at IS NULL));

CREATE POLICY admin_manage_invoices ON invoices
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_see_invoice_line_items_when_invoice_is_accessible ON invoice_line_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND EXISTS (
      SELECT
        1
      FROM
        invoices i
      WHERE
        i.id = invoice_line_items.invoice_id
        AND i.organization_id = haven.organization_id ()
        AND i.deleted_at IS NULL
        AND ((haven.app_role () IN ('owner', 'org_admin', 'facility_admin')
            AND i.facility_id IN (
              SELECT
                haven.accessible_facility_ids ()))
          OR (haven.app_role () = 'family'
            AND haven.can_access_resident (i.resident_id)
            AND EXISTS (
              SELECT
                1
              FROM
                family_resident_links frl
              WHERE
                frl.user_id = auth.uid ()
                AND frl.resident_id = i.resident_id
                AND frl.can_view_financial = true
                AND frl.revoked_at IS NULL)))));

CREATE POLICY admin_manage_invoice_line_items ON invoice_line_items
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND invoice_id IN (
      SELECT
        i.id
      FROM
        invoices i
      WHERE
        i.organization_id = haven.organization_id ()
        AND i.facility_id IN (
          SELECT
            haven.accessible_facility_ids ())
        AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin')));

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_payments ON payments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY family_see_own_payments ON payments
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () = 'family'
    AND haven.can_access_resident (resident_id)
    AND EXISTS (
      SELECT
        1
      FROM
        family_resident_links frl
      WHERE
        frl.user_id = auth.uid ()
        AND frl.resident_id = payments.resident_id
        AND frl.can_view_financial = true
        AND frl.revoked_at IS NULL));

CREATE POLICY admin_manage_payments ON payments
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE collection_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_collection_activities ON collection_activities
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY admin_manage_collection_activities ON collection_activities
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_see_invoice_sequences ON invoice_sequences
  FOR SELECT
  USING (
    facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        facilities f
      WHERE
        f.id = invoice_sequences.facility_id
        AND f.organization_id = haven.organization_id ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));

CREATE POLICY admin_manage_invoice_sequences ON invoice_sequences
  FOR ALL
  USING (
    facility_id IN (
      SELECT
        haven.accessible_facility_ids ())
    AND EXISTS (
      SELECT
        1
      FROM
        facilities f
      WHERE
        f.id = invoice_sequences.facility_id
        AND f.organization_id = haven.organization_id ())
    AND haven.app_role () IN ('owner', 'org_admin', 'facility_admin'));
