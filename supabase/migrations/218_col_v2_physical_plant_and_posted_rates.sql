-- COL v2 Slice 2: physical plant, posted rates, and Plantation Medicaid provider catalog.
-- This is intentionally additive/idempotent. It does not delete or mutate facility records.

DO $$
DECLARE
  v_col_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_col_facility_count integer;
BEGIN
  SELECT count(*)
    INTO v_col_facility_count
  FROM public.facilities
  WHERE organization_id = v_col_org_id
    AND deleted_at IS NULL
    AND name IN (
      'Oakridge ALF',
      'Rising Oaks ALF',
      'Homewood Lodge ALF',
      'Plantation ALF',
      'Grande Cypress ALF'
    );

  IF v_col_facility_count <> 5 THEN
    RAISE NOTICE 'COL Slice 2 seed skipped: expected 5 active COL facilities, found %', v_col_facility_count;
    RETURN;
  END IF;

  RAISE NOTICE 'COL Slice 2 seed starting for 5 verified active COL facilities.';
END $$;

-- Homewood Lodge ALF: 20 rooms / 36 beds.
WITH homewood AS (
  SELECT id AS facility_id, organization_id
  FROM public.facilities
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND name = 'Homewood Lodge ALF'
    AND deleted_at IS NULL
  LIMIT 1
), homewood_room_seed AS (
  SELECT
    h.organization_id,
    h.facility_id,
    n::text AS room_number,
    CASE WHEN n BETWEEN 1 AND 4 THEN 'private'::public.room_type ELSE 'semi_private'::public.room_type END AS room_type,
    CASE WHEN n BETWEEN 1 AND 4 THEN 1 ELSE 2 END AS max_occupancy,
    1 AS floor_number,
    n AS sort_order,
    CASE WHEN n BETWEEN 1 AND 4 THEN 'COL seed: Homewood private room.' ELSE 'COL seed: Homewood companion room.' END AS notes
  FROM homewood h
  CROSS JOIN generate_series(1, 20) AS n
)
INSERT INTO public.rooms (
  organization_id,
  facility_id,
  room_number,
  room_type,
  max_occupancy,
  floor_number,
  sort_order,
  notes
)
SELECT
  organization_id,
  facility_id,
  room_number,
  room_type,
  max_occupancy,
  floor_number,
  sort_order,
  notes
FROM homewood_room_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.rooms r
  WHERE r.facility_id = s.facility_id
    AND r.room_number = s.room_number
    AND r.deleted_at IS NULL
);

WITH homewood_rooms AS (
  SELECT r.id AS room_id, r.facility_id, r.organization_id, r.room_type
  FROM public.rooms r
  JOIN public.facilities f ON f.id = r.facility_id
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.name = 'Homewood Lodge ALF'
    AND f.deleted_at IS NULL
    AND r.deleted_at IS NULL
    AND r.room_number ~ '^[0-9]+$'
    AND r.room_number::integer BETWEEN 1 AND 20
), homewood_bed_seed AS (
  SELECT room_id, facility_id, organization_id, 'A'::text AS bed_label
  FROM homewood_rooms
  UNION ALL
  SELECT room_id, facility_id, organization_id, 'B'::text AS bed_label
  FROM homewood_rooms
  WHERE room_type = 'semi_private'::public.room_type
)
INSERT INTO public.beds (
  organization_id,
  facility_id,
  room_id,
  bed_label,
  bed_type,
  status
)
SELECT
  organization_id,
  facility_id,
  room_id,
  bed_label,
  'alf_intermediate'::public.bed_type,
  'available'::public.bed_status
FROM homewood_bed_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.beds b
  WHERE b.room_id = s.room_id
    AND b.bed_label = s.bed_label
    AND b.deleted_at IS NULL
);

-- Plantation ALF: 6 wings, 32 companion rooms, 64 beds.
WITH plantation AS (
  SELECT id AS facility_id, organization_id
  FROM public.facilities
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND name = 'Plantation ALF'
    AND deleted_at IS NULL
  LIMIT 1
), wing_seed AS (
  SELECT
    p.organization_id,
    p.facility_id,
    ('Wing ' || n)::text AS name,
    1 AS floor_number,
    n AS sort_order
  FROM plantation p
  CROSS JOIN generate_series(1, 6) AS n
)
INSERT INTO public.units (
  organization_id,
  facility_id,
  name,
  floor_number,
  sort_order
)
SELECT organization_id, facility_id, name, floor_number, sort_order
FROM wing_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.units u
  WHERE u.facility_id = s.facility_id
    AND u.name = s.name
    AND u.deleted_at IS NULL
);

WITH plantation AS (
  SELECT id AS facility_id, organization_id
  FROM public.facilities
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND name = 'Plantation ALF'
    AND deleted_at IS NULL
  LIMIT 1
), plantation_room_seed AS (
  SELECT p.organization_id, p.facility_id, 1 AS wing_sort, n AS room_number
  FROM plantation p CROSS JOIN generate_series(1, 6) AS n
  UNION ALL
  SELECT p.organization_id, p.facility_id, 2 AS wing_sort, n AS room_number
  FROM plantation p CROSS JOIN generate_series(7, 12) AS n
  UNION ALL
  SELECT p.organization_id, p.facility_id, 3 AS wing_sort, n AS room_number
  FROM plantation p CROSS JOIN generate_series(14, 19) AS n
  UNION ALL
  SELECT p.organization_id, p.facility_id, 4 AS wing_sort, n AS room_number
  FROM plantation p CROSS JOIN generate_series(20, 25) AS n
  UNION ALL
  SELECT p.organization_id, p.facility_id, 5 AS wing_sort, n AS room_number
  FROM plantation p CROSS JOIN generate_series(26, 29) AS n
  UNION ALL
  SELECT p.organization_id, p.facility_id, 6 AS wing_sort, n AS room_number
  FROM plantation p CROSS JOIN generate_series(30, 33) AS n
), plantation_room_rows AS (
  SELECT
    s.organization_id,
    s.facility_id,
    u.id AS unit_id,
    s.room_number::text AS room_number,
    'semi_private'::public.room_type AS room_type,
    2 AS max_occupancy,
    1 AS floor_number,
    s.room_number AS sort_order,
    'COL seed: Plantation companion room.'::text AS notes
  FROM plantation_room_seed s
  JOIN public.units u
    ON u.facility_id = s.facility_id
   AND u.name = ('Wing ' || s.wing_sort)::text
   AND u.deleted_at IS NULL
)
INSERT INTO public.rooms (
  organization_id,
  facility_id,
  unit_id,
  room_number,
  room_type,
  max_occupancy,
  floor_number,
  sort_order,
  notes
)
SELECT
  organization_id,
  facility_id,
  unit_id,
  room_number,
  room_type,
  max_occupancy,
  floor_number,
  sort_order,
  notes
FROM plantation_room_rows s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.rooms r
  WHERE r.facility_id = s.facility_id
    AND r.room_number = s.room_number
    AND r.deleted_at IS NULL
);

WITH plantation_rooms AS (
  SELECT r.id AS room_id, r.facility_id, r.organization_id
  FROM public.rooms r
  JOIN public.facilities f ON f.id = r.facility_id
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.name = 'Plantation ALF'
    AND f.deleted_at IS NULL
    AND r.deleted_at IS NULL
    AND r.room_number ~ '^[0-9]+$'
    AND r.room_number::integer IN (
      1,2,3,4,5,6,
      7,8,9,10,11,12,
      14,15,16,17,18,19,
      20,21,22,23,24,25,
      26,27,28,29,
      30,31,32,33
    )
), plantation_bed_seed AS (
  SELECT room_id, facility_id, organization_id, label AS bed_label
  FROM plantation_rooms
  CROSS JOIN (VALUES ('A'), ('B')) AS labels(label)
)
INSERT INTO public.beds (
  organization_id,
  facility_id,
  room_id,
  bed_label,
  bed_type,
  status
)
SELECT
  organization_id,
  facility_id,
  room_id,
  bed_label,
  'alf_intermediate'::public.bed_type,
  'available'::public.bed_status
FROM plantation_bed_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.beds b
  WHERE b.room_id = s.room_id
    AND b.bed_label = s.bed_label
    AND b.deleted_at IS NULL
);

-- Posted private/companion rates. Care surcharge columns are explicitly filled because the legacy table requires them.
WITH posted_rate_seed AS (
  SELECT
    f.organization_id,
    f.id AS facility_id,
    CASE WHEN f.name = 'Plantation ALF' THEN 'Plantation Posted Rates 2026' ELSE 'Standard Posted Rates 2026' END AS name,
    DATE '2026-01-01' AS effective_date,
    CASE WHEN f.name = 'Plantation ALF' THEN 384300 ELSE 555000 END AS base_rate_private,
    CASE WHEN f.name = 'Plantation ALF' THEN 354300 ELSE 400000 END AS base_rate_semi_private,
    'COL v2 posted-rate seed. Values are cents; UI should label semi_private as Companion.'::text AS notes
  FROM public.facilities f
  WHERE f.organization_id = '00000000-0000-0000-0000-000000000001'
    AND f.deleted_at IS NULL
    AND f.name IN ('Oakridge ALF', 'Rising Oaks ALF', 'Homewood Lodge ALF', 'Plantation ALF', 'Grande Cypress ALF')
)
INSERT INTO public.rate_schedules (
  organization_id,
  facility_id,
  name,
  effective_date,
  base_rate_private,
  base_rate_semi_private,
  care_surcharge_level_1,
  care_surcharge_level_2,
  care_surcharge_level_3,
  community_fee,
  pet_fee,
  second_occupant_fee,
  notes
)
SELECT
  organization_id,
  facility_id,
  name,
  effective_date,
  base_rate_private,
  base_rate_semi_private,
  0,
  0,
  0,
  0,
  0,
  0,
  notes
FROM posted_rate_seed s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.rate_schedules rs
  WHERE rs.facility_id = s.facility_id
    AND rs.name = s.name
    AND rs.effective_date = s.effective_date
    AND rs.deleted_at IS NULL
);

-- Plantation Medicaid provider/rate catalog.
WITH plantation AS (
  SELECT id AS facility_id, organization_id
  FROM public.facilities
  WHERE organization_id = '00000000-0000-0000-0000-000000000001'
    AND name = 'Plantation ALF'
    AND deleted_at IS NULL
  LIMIT 1
), provider_seed AS (
  SELECT
    p.organization_id,
    p.facility_id,
    v.provider_name,
    v.provider_type,
    v.default_rate_cents,
    v.rate_unit,
    'Seeded from COL v2 handoff. Bed-hold payer-specific nuance remains unknown until Jessica/provider policies confirm it.'::text AS notes
  FROM plantation p
  CROSS JOIN (VALUES
    ('Florida Community Care', 'LTC', 160000, 'monthly'),
    ('Simply Healthcare',      'LTC', 165000, 'monthly'),
    ('Sunshine Health',        'LTC', 135000, 'monthly'),
    ('Humana',                 'LTC', 120000, 'monthly'),
    ('United Healthcare',      'LTC', 160000, 'monthly'),
    ('Florida Community Care', 'MMA', 1558,   'daily'),
    ('Simply Healthcare',      'MMA', 1558,   'daily'),
    ('Sunshine Health',        'MMA', 1558,   'daily'),
    ('Humana',                 'MMA', 1558,   'daily'),
    ('United Healthcare',      'MMA', 1558,   'daily')
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
  notes
)
SELECT
  organization_id,
  facility_id,
  provider_name,
  provider_type,
  default_rate_cents,
  rate_unit,
  'unknown',
  notes
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

COMMENT ON TABLE public.facility_medicaid_providers IS
  'Facility-level Medicaid provider and default-rate catalog. COL Slice 2 seeds Plantation LTC/MMA provider defaults; per-resident payer records still live in resident_payers.';
