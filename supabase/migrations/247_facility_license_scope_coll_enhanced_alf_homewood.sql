-- Expand regulatory license class enumeration (standard → full COL scope incl. enhanced / LM / LNH).
-- Homewood Lodge AHCA packets align with Enhanced ALF Services (Track A compliance accuracy).

ALTER TABLE facilities DROP CONSTRAINT IF EXISTS facilities_alf_license_type_check;

ALTER TABLE facilities ADD CONSTRAINT facilities_alf_license_type_check CHECK (
    alf_license_type IN (
      'standard_alf',
      'enhanced_alf_services',
      'limited_mental_health',
      'limited_nursing'
    )
    );

COMMENT ON COLUMN facilities.alf_license_type IS
  'AHCA-assisted living license class under Ch. 429 / F.A.C. 59A (standard, enhanced limited mental health, limited nursing — mutually exclusive licensure pathway). COL Homewood Lodge operates enhanced scope per owner licensure certificates.';

-- Homewood Lodge ALF — Sorensen, Smith & Bay LLC (facility 003): seed enhanced scope (was standard in legacy defaults).
UPDATE public.facilities
SET
  alf_license_type = 'enhanced_alf_services',
  care_services_offered = ARRAY['enhanced_alf_services']::text[]
WHERE
  id = '00000000-0000-0000-0002-000000000003';
