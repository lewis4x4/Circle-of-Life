-- Idempotent monthly invoice generation: at most one open invoice per resident per billing period per facility.
CREATE UNIQUE INDEX uq_invoices_facility_resident_period_open
ON invoices (facility_id, resident_id, period_start)
WHERE
  deleted_at IS NULL;

COMMENT ON INDEX uq_invoices_facility_resident_period_open IS
  'Ensures generate-monthly-invoices (UI or Edge) does not duplicate rows for the same facility, resident, and period_start.';
