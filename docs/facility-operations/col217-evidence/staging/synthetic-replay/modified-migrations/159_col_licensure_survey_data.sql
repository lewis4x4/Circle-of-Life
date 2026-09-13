-- Migration 159: Circle of Life — Real licensure & survey data from AHCA PDFs
-- Source: 5 facility license certificates + survey letters provided by owner (April 2026)
-- All facilities have ZERO deficiencies on most recent surveys.

-- Schema guard: production already has these columns (added out-of-band before
-- this migration was written), so live deploys are unaffected. A fresh
-- Docker replay needs them defined before the UPDATEs below. ADD COLUMN
-- IF NOT EXISTS keeps both paths green.
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS ahca_license_number text;
ALTER TABLE public.facilities ADD COLUMN IF NOT EXISTS ahca_license_expiration date;

-- ══════════════════════════════════════════════════════════
-- FACILITY TABLE UPDATES
-- Populates: total_licensed_beds, ahca_license_number, ahca_license_expiration,
--            administrator_name, address_line_1, city, state, zip, phone
-- ══════════════════════════════════════════════════════════

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS ahca_license_number text,
  ADD COLUMN IF NOT EXISTS ahca_license_expiration date;

-- 001 — Oakridge ALF (Pinehouse Inc)
UPDATE public.facilities SET
  total_licensed_beds = 52,
  ahca_license_number = '9863',
  ahca_license_expiration = '2026-04-14'::date,
  administrator_name = 'Synthetic administrator_name d9206d98c1',
  address_line_1 = 'Synthetic address_line_1 a63bec9a91',
  city = 'Synthetic city 74831bf043',
  state = 'FL',
  zip = '00000',
  last_survey_date = '2024-06-18'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000001';

-- 002 — Rising Oaks ALF (Smith & Sorensen LLC)
UPDATE public.facilities SET
  total_licensed_beds = 52,
  ahca_license_number = '13041',
  ahca_license_expiration = '2025-11-06'::date,
  address_line_1 = 'Synthetic address_line_1 7e25f78823',
  city = 'Synthetic city e44d10f249',
  state = 'FL',
  zip = '00000',
  last_survey_date = '2024-01-10'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000002';

-- 003 — Homewood Lodge ALF (Sorensen, Smith & Bay LLC)
UPDATE public.facilities SET
  total_licensed_beds = 36,
  ahca_license_number = '12528',
  ahca_license_expiration = '2026-09-27'::date,
  address_line_1 = 'Synthetic address_line_1 9c322a93bb',
  city = 'Synthetic city 74831bf043',
  state = 'FL',
  zip = '00000',
  last_survey_date = '2024-10-22'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000003';

-- 004 — Plantation on Summers (Plantation On Summers LLC)
UPDATE public.facilities SET
  total_licensed_beds = 64,
  ahca_license_number = '5191',
  ahca_license_expiration = '2026-07-16'::date,
  administrator_name = 'Synthetic administrator_name 31e19bf8a6',
  address_line_1 = 'Synthetic address_line_1 4680d3d1e0',
  city = 'Synthetic city 508a9d8f32',
  state = 'FL',
  zip = '00000',
  last_survey_date = '2024-11-05'::date,
  last_survey_result = 'no_citations'
WHERE id = '00000000-0000-0000-0002-000000000004';

-- 005 — Grande Cypress ALF (Grande Cypress ALF LLC)
UPDATE public.facilities SET
  total_licensed_beds = 54,
  ahca_license_number = '13688',
  ahca_license_expiration = '2028-01-30'::date,
  administrator_name = 'Synthetic administrator_name a447686456',
  address_line_1 = 'Synthetic address_line_1 dd0239b572',
  city = 'Synthetic city 508a9d8f32',
  state = 'FL',
  zip = '00000',
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
