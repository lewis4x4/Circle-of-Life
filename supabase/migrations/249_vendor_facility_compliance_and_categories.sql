-- Facility vendor linkage compliance signals + taxonomy for survey-facing UI.
ALTER TABLE vendor_facilities
ADD COLUMN IF NOT EXISTS coi_on_file boolean;

ALTER TABLE vendor_facilities
ADD COLUMN IF NOT EXISTS coi_expiration date;

ALTER TABLE vendor_facilities
ADD COLUMN IF NOT EXISTS service_contract_status text;

ALTER TABLE vendor_facilities
ADD COLUMN IF NOT EXISTS service_contract_expiration date;

ALTER TABLE vendor_facilities
ADD COLUMN IF NOT EXISTS last_invoice_at timestamptz;

ALTER TABLE vendor_facilities
ADD COLUMN IF NOT EXISTS last_payment_at timestamptz;

COMMENT ON COLUMN vendor_facilities.coi_on_file IS 'Certificate of insurance on file flag (facility-scoped).';
COMMENT ON COLUMN vendor_facilities.coi_expiration IS 'Facility-scoped COI expiration (canonical directory still lives in vendors module).';

ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'government_partner';
ALTER TYPE vendor_category ADD VALUE IF NOT EXISTS 'community_partner';

UPDATE vendors
SET
  category = 'community_partner'::vendor_category,
  updated_at = now()
WHERE
  deleted_at IS NULL
  AND lower(trim(name)) = lower(trim('Suwannee River Economic Council'));

UPDATE vendors
SET
  category = 'government_partner'::vendor_category,
  updated_at = now()
WHERE
  deleted_at IS NULL
  AND lower(trim(name)) LIKE lower('%lafayette county%');

UPDATE vendors
SET
  name = 'Parrish MediVan',
  updated_at = now()
WHERE
  deleted_at IS NULL
  AND lower(trim(name)) = lower('Parrish Medivan');
