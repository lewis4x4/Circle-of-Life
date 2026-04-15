-- Update COL facility administrator contacts per owner-provided contact refresh

-- Facility-level display names
UPDATE public.facilities
SET administrator_name = 'Sulma Estrada'
WHERE id = '00000000-0000-0000-0002-000000000001';

UPDATE public.facilities
SET administrator_name = 'Crystal Ducksworth'
WHERE id = '00000000-0000-0000-0002-000000000002';

UPDATE public.facilities
SET administrator_name = 'Charlene Elmore'
WHERE id = '00000000-0000-0000-0002-000000000003';

UPDATE public.facilities
SET administrator_name = 'Bobbi Jo Hare'
WHERE id = '00000000-0000-0000-0002-000000000004';

UPDATE public.facilities
SET administrator_name = 'Jennifer Smith'
WHERE id = '00000000-0000-0000-0002-000000000005';

-- Seeded administrator staff rows
UPDATE public.staff
SET first_name = 'Sulma',
    last_name = 'Estrada',
    phone = '386-294-5050'
WHERE facility_id = '00000000-0000-0000-0002-000000000001'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Crystal',
    last_name = 'Ducksworth',
    phone = '386-364-2273'
WHERE facility_id = '00000000-0000-0000-0002-000000000002'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Charlene',
    last_name = 'Elmore',
    phone = '386-294-2273'
WHERE facility_id = '00000000-0000-0000-0002-000000000003'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Bobbi Jo',
    last_name = 'Hare',
    phone = '386-755-2737'
WHERE facility_id = '00000000-0000-0000-0002-000000000004'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;

UPDATE public.staff
SET first_name = 'Jennifer',
    last_name = 'Smith',
    phone = '386-287-5551'
WHERE facility_id = '00000000-0000-0000-0002-000000000005'
  AND staff_role = 'administrator'
  AND deleted_at IS NULL;
