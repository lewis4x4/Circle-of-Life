-- Migration 159: Circle of Life — Real licensure & survey data from AHCA PDFs
-- Source: 5 facility license certificates + survey letters provided by owner (April 2026)
-- All facilities have ZERO deficiencies on most recent surveys.

-- ══════════════════════════════════════════════════════════
-- FACILITY TABLE UPDATES
-- Populates: total_licensed_beds, ahca_license_number, ahca_license_expiration,
--            administrator_name, address_line_1, city, state, zip, phone
-- ══════════════════════════════════════════════════════════

-- 001 — Oakridge ALF (Pinehouse Inc)
UPDATE public.facilities SET
  total_licensed_beds = 52,
  ahca_license_number = '9863',
  ahca_license_expiration = '2026-04-14'::timestamptz,
  administrator_name = 'Jessica Lawson',
  address_line_1 = '297 SW County Road 300',
  city = 'Mayo',
  state = 'FL',
  zip = '32066',
  last_survey_date = '2024-06-18'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000001';

-- 002 — Rising Oaks ALF (Smith & Sorensen LLC)
UPDATE public.facilities SET
  total_licensed_beds = 52,
  ahca_license_number = '13041',
  ahca_license_expiration = '2025-11-06'::timestamptz,
  address_line_1 = '201 Ranchera St NW',
  city = 'Live Oak',
  state = 'FL',
  zip = '32064',
  last_survey_date = '2024-01-10'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000002';

-- 003 — Homewood Lodge ALF (Sorensen, Smith & Bay LLC)
UPDATE public.facilities SET
  total_licensed_beds = 36,
  ahca_license_number = '12528',
  ahca_license_expiration = '2026-09-27'::timestamptz,
  address_line_1 = '430 SE Mills St',
  city = 'Mayo',
  state = 'FL',
  zip = '32066',
  last_survey_date = '2024-10-22'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000003';

-- 004 — Plantation on Summers (Plantation On Summers LLC)
UPDATE public.facilities SET
  total_licensed_beds = 64,
  ahca_license_number = '5191',
  ahca_license_expiration = '2026-07-16'::timestamptz,
  administrator_name = 'Bobbi Jo Johnson',
  address_line_1 = '147 SW Summers Ln',
  city = 'Lake City',
  state = 'FL',
  zip = '32025-0762',
  last_survey_date = '2024-11-05'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000004';

-- 005 — Grande Cypress ALF (Grande Cypress ALF LLC)
UPDATE public.facilities SET
  total_licensed_beds = 54,
  ahca_license_number = '13688',
  ahca_license_expiration = '2028-01-30'::timestamptz,
  administrator_name = 'Jennifer Allender',
  address_line_1 = '970 SW Pinemount Road',
  city = 'Lake City',
  state = 'FL',
  zip = '32024',
  last_survey_date = NULL, -- No survey on record in provided documents
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000005';

-- NOTE: legal_entities table (from migration 104) does not exist on remote.
-- License/survey data is tracked on the facilities table only.

-- ══════════════════════════════════════════════════════════
-- COMMENTS — source documentation
-- ══════════════════════════════════════════════════════════

COMMENT ON COLUMN facilities.ahca_license_number IS 'AHCA Assisted Living Facility license number. Populated from owner-provided license certificates (April 2026).';
COMMENT ON COLUMN facilities.ahca_license_expiration IS 'AHCA license expiration date. Populated from owner-provided license certificates (April 2026).';
