-- BH-2 / BH-4 / BH-6 foundation: Michelle Medicaid defaults, unlimited bed-hold,
-- hold notification + decline-return fields, Form 1823 helper comment.
-- Policy: docs/specs/COL-RESPONSE-LOG-2026-07-michelle-bed-hold.md

BEGIN;

-- ---------------------------------------------------------------------------
-- BH-4: hold event columns on residents (snapshot) + status history (episode)
-- ---------------------------------------------------------------------------
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS hold_case_manager_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_decline_return_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_decline_return_notes text;

COMMENT ON COLUMN public.residents.hold_case_manager_notified_at IS
  'When the Medicaid case manager was notified of hospital admission (Michelle BH-4). Billing hold clock starts here for Medicaid.';
COMMENT ON COLUMN public.residents.hold_decline_return_at IS
  'When resident/family notified facility they will not return (private-pay hold release).';
COMMENT ON COLUMN public.residents.hold_decline_return_notes IS
  'Optional notes for decline-return / hold release.';

ALTER TABLE public.resident_status_history
  ADD COLUMN IF NOT EXISTS hold_case_manager_notified_at timestamptz;

COMMENT ON COLUMN public.resident_status_history.hold_case_manager_notified_at IS
  'Per-episode case-manager notification timestamp when status is hospital_hold.';

-- ---------------------------------------------------------------------------
-- BH-2: seed / refresh LTC Medicaid defaults for all COL facilities
-- ---------------------------------------------------------------------------
WITH col_facilities AS (
  SELECT id AS facility_id, organization_id
  FROM public.facilities
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND deleted_at IS NULL
),
provider_seed AS (
  SELECT
    f.organization_id,
    f.facility_id,
    v.provider_name,
    v.provider_type,
    v.default_rate_cents,
    v.rate_unit,
    'Michelle COL policy 2026-07 — unlimited bed hold; full_rate pending authorization.'::text AS notes
  FROM col_facilities f
  CROSS JOIN (VALUES
    ('Florida Community Care', 'LTC', 165000, 'monthly'),
    ('Simply Healthcare',      'LTC', 160000, 'monthly'),
    ('United Healthcare',      'LTC', 160000, 'monthly'),
    ('Sunshine Health',        'LTC', 135000, 'monthly'),
    ('Humana',                 'LTC', 125000, 'monthly')
  ) AS v(provider_name, provider_type, default_rate_cents, rate_unit)
)
INSERT INTO public.facility_medicaid_providers (
  organization_id,
  facility_id,
  provider_name,
  provider_type,
  default_rate_cents,
  rate_unit,
  bed_hold_hospital_billing,
  bed_hold_max_days,
  notes,
  active
)
SELECT
  s.organization_id,
  s.facility_id,
  s.provider_name,
  s.provider_type,
  s.default_rate_cents,
  s.rate_unit,
  'full_rate',
  NULL,
  s.notes,
  true
FROM provider_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.facility_medicaid_providers p
  WHERE p.facility_id = s.facility_id
    AND p.provider_name = s.provider_name
    AND p.provider_type = s.provider_type
    AND p.active = true
    AND p.deleted_at IS NULL
);

WITH col_facilities AS (
  SELECT id AS facility_id
  FROM public.facilities
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND deleted_at IS NULL
),
provider_seed AS (
  SELECT
    f.facility_id,
    v.provider_name,
    v.provider_type,
    v.default_rate_cents,
    v.rate_unit
  FROM col_facilities f
  CROSS JOIN (VALUES
    ('Florida Community Care', 'LTC', 165000, 'monthly'),
    ('Simply Healthcare',      'LTC', 160000, 'monthly'),
    ('United Healthcare',      'LTC', 160000, 'monthly'),
    ('Sunshine Health',        'LTC', 135000, 'monthly'),
    ('Humana',                 'LTC', 125000, 'monthly')
  ) AS v(provider_name, provider_type, default_rate_cents, rate_unit)
)
UPDATE public.facility_medicaid_providers p
SET
  default_rate_cents = s.default_rate_cents,
  rate_unit = s.rate_unit,
  bed_hold_hospital_billing = 'full_rate',
  bed_hold_max_days = NULL,
  notes = COALESCE(
    p.notes,
    'Michelle COL policy 2026-07 — unlimited bed hold; full_rate pending authorization.'
  ),
  updated_at = now()
FROM provider_seed s
WHERE p.facility_id = s.facility_id
  AND p.provider_name = s.provider_name
  AND p.provider_type = s.provider_type
  AND p.active = true
  AND p.deleted_at IS NULL;

-- Also match common "UnitedHealthcare" spelling if already seeded that way
UPDATE public.facility_medicaid_providers
SET
  default_rate_cents = 160000,
  rate_unit = 'monthly',
  bed_hold_hospital_billing = 'full_rate',
  bed_hold_max_days = NULL,
  updated_at = now()
WHERE provider_type = 'LTC'
  AND active = true
  AND deleted_at IS NULL
  AND provider_name IN ('UnitedHealthcare', 'United Health Care')
  AND organization_id = '00000000-0000-0000-0000-000000000001';

COMMIT;
