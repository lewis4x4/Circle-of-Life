-- Update COL facility administrator contacts per owner-provided contact refresh

-- Facility-level display names
UPDATE public.facilities
SET administrator_name = 'Synthetic administrator_name 39481c44de'
WHERE id = '00000000-0000-0000-0002-000000000001';

UPDATE public.facilities
SET administrator_name = 'Synthetic administrator_name bbafc663a6'
WHERE id = '00000000-0000-0000-0002-000000000002';

UPDATE public.facilities
SET administrator_name = 'Synthetic administrator_name e04c8fe4f9'
WHERE id = '00000000-0000-0000-0002-000000000003';

UPDATE public.facilities
SET administrator_name = 'Synthetic administrator_name 6989f7175a'
WHERE id = '00000000-0000-0000-0002-000000000004';

UPDATE public.facilities
SET administrator_name = 'Synthetic administrator_name 131cb0666a'
WHERE id = '00000000-0000-0000-0002-000000000005';

-- Seeded administrator staff rows
UPDATE public.staff
SET first_name = 'Synthetic first_name 2281eff428',
    last_name = 'Synthetic last_name 878f7fc93e',
    phone = '202-555-0169'
WHERE facility_id = '00000000-0000-0000-0002-000000000001'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Synthetic first_name 60a0f78b50',
    last_name = 'Synthetic last_name 8b81d7c89e',
    phone = '202-555-0137'
WHERE facility_id = '00000000-0000-0000-0002-000000000002'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Synthetic first_name 8962392173',
    last_name = 'Synthetic last_name 42cd302db7',
    phone = '202-555-0130'
WHERE facility_id = '00000000-0000-0000-0002-000000000003'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Synthetic first_name 27b0c80888',
    last_name = 'Synthetic last_name e39f1cde9e',
    phone = '202-555-0118'
WHERE facility_id = '00000000-0000-0000-0002-000000000004'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Synthetic first_name 9ce8db922a',
    last_name = 'Synthetic last_name 6627835f98',
    phone = '202-555-0119'
WHERE facility_id = '00000000-0000-0000-0002-000000000005'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;
