-- Track E — E2: Facility ALF license class (COL = standard ALF; distinct from bed_type)

ALTER TABLE facilities
ADD COLUMN IF NOT EXISTS alf_license_type text NOT NULL DEFAULT 'standard_alf'
  CHECK (alf_license_type IN ('standard_alf'));

COMMENT ON COLUMN facilities.alf_license_type IS 'Regulatory license class for the facility (COL: standard_alf for all five sites). Not the same as bed_type.';

UPDATE facilities
SET
  alf_license_type = 'standard_alf'
WHERE
  alf_license_type IS DISTINCT FROM 'standard_alf';
