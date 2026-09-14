-- COL-252 forward repair for verified recorded-but-absent schema effects.
-- Generated with supabase migration new; normalized to next source slot381.
-- Existing referral migrations remain separate from this additive repair.
-- Preserve clinical/business rows, existing permissions and historical ledgers.
-- Transaction owns only additive schema repairs; no old seed UPDATEs replayed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.vendor_facilities
  ADD COLUMN IF NOT EXISTS coi_on_file boolean,
  ADD COLUMN IF NOT EXISTS coi_expiration date,
  ADD COLUMN IF NOT EXISTS service_contract_status text,
  ADD COLUMN IF NOT EXISTS service_contract_expiration date,
  ADD COLUMN IF NOT EXISTS last_invoice_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_at timestamptz;

COMMENT ON COLUMN public.vendor_facilities.coi_on_file IS
  'Certificate of insurance on file flag (facility-scoped).';
COMMENT ON COLUMN public.vendor_facilities.coi_expiration IS
  'Facility-scoped COI expiration (canonical directory still lives in vendors module).';

-- Do not use new enum values to relabel existing vendors in this transaction.
ALTER TYPE public.vendor_category ADD VALUE IF NOT EXISTS 'government_partner';
ALTER TYPE public.vendor_category ADD VALUE IF NOT EXISTS 'community_partner';

DO $repair$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.facilities'::regclass
      AND conname = 'facilities_alf_license_type_check'
      AND pg_get_constraintdef(oid, true) <>
        'CHECK (alf_license_type = ANY (ARRAY[''standard_alf''::text, ''enhanced_alf_services''::text, ''limited_mental_health''::text, ''limited_nursing''::text]))'
  ) THEN
    RAISE EXCEPTION 'COL252 unexpected existing facility license constraint';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.facilities'::regclass
      AND conname = 'facilities_alf_license_type_check'
  ) THEN
    ALTER TABLE public.facilities
      ADD CONSTRAINT facilities_alf_license_type_check CHECK (
        alf_license_type IN ('standard_alf', 'enhanced_alf_services',
                             'limited_mental_health', 'limited_nursing')
      ) NOT VALID;
  END IF;
END
$repair$;
ALTER TABLE public.facilities
  VALIDATE CONSTRAINT facilities_alf_license_type_check;

CREATE OR REPLACE TRIGGER tr_fl_statutes_set_updated_at
  BEFORE UPDATE ON public.fl_statutes
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE OR REPLACE TRIGGER tr_fl_statutes_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.fl_statutes
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- IF NOT EXISTS alone cannot establish that a pre-existing column is correct.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('coi_on_file','boolean'), ('coi_expiration','date'),
      ('service_contract_status','text'), ('service_contract_expiration','date'),
      ('last_invoice_at','timestamp with time zone'),
      ('last_payment_at','timestamp with time zone')) expected(name,type)
    LEFT JOIN pg_attribute a ON a.attrelid='public.vendor_facilities'::regclass
      AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.type
      OR a.attnotnull OR d.oid IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'COL252 vendor compliance column postcondition failed';
  END IF;
END
$verify$;

-- No fl_statutes_manage policy: historical283 would broaden deleted-row access.
-- No facility_overrides backfill, occupancy rewrite, flow key replacement,
-- Homewood licensure reclassification, or vendor category/name seed updates.
