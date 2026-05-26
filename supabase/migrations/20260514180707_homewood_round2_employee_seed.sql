-- Homewood Round-2 employee seed (M4: Employees / Users / Roles)
-- Source: Jessica Murphy "Employees Information.xlsx" (Drive 1eWUKm5OcAbW1I9kFPuMmqlAdbYC2-xGq), 2026-05-14.
-- Idempotent insert of 16 Homewood Lodge ALF staff (facility 00000000-0000-0000-0002-000000000003).
-- Source provider = Jessica Murphy; created_by uses the replay-safe system actor.
-- Role mapping (xlsx -> staff_role enum):
--   Administrator            -> administrator
--   Administrative Assistant -> assistant_administrator
--   Universal                -> resident_aide
-- Applied to remote 2026-05-14 via Supabase MCP apply_migration.

ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'ceo';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'coo';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'cfo';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'assistant_administrator';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'admin_support_coordinator';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'marketing_consultant';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'maintenance_director';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'maintenance_standby';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'medication_tech';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'resident_aide';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'dietary_aide';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'activity_aide';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'resident_services_coordinator';

INSERT INTO public.staff
  (facility_id, organization_id, first_name, last_name, email, staff_role, employment_status, hire_date, created_by)
SELECT
  '00000000-0000-0000-0002-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  v.first_name, v.last_name, v.email,
  v.role::staff_role,
  'active'::employment_status,
  CURRENT_DATE,
  '00000000-0000-0000-0000-000000000001'::uuid
FROM (VALUES
  ('Charlene',  'Elmore',     'celmore.homewoodalf@gmail.com', 'administrator'),
  ('Malida',    'Gaskins',    'aa.homewoodlodge@gmail.com',    'assistant_administrator'),
  ('Holly',     'Berry',      'hjberry1969@gmail.com',         'resident_aide'),
  ('Kymeisha',  'Coverson',   'liltwin2018@gmail.com',         'resident_aide'),
  ('Kyneisha',  'Coverson',   'kycoverson@gmail.com',          'resident_aide'),
  ('Na-shia',   'Freeman',    'nashiafreeman123@gmail.com',    'resident_aide'),
  ('Abbigail',  'Hall',       'Abbigail@icloud.com',           'resident_aide'),
  ('Kimora',    'Hall',       'kimora1404@icloud.com',         'resident_aide'),
  ('Kristin',   'Hurley',     'kristinhurley1585@gmail.com',   'resident_aide'),
  ('Jennifer',  'Martinez',   'jenny2025blue.amen22@gmail.com','resident_aide'),
  ('Cecilia',   'Ramirez',    'ramirez5179.a@gmail.com',       'resident_aide'),
  ('Rebecca',   'Ross',       'rebeccaross01@aim.com',         'resident_aide'),
  ('Rita',      'Salas',      'ritatrejosal@gmail.com',        'resident_aide'),
  ('Kayla',     'Smith',      'kaylasmith1800@icloud.com',     'resident_aide'),
  ('Kaci',      'Vicencio',   'kacivicencio220@gmail.com',     'resident_aide'),
  ('Kayla',     'Winberley',  'kawimb15@icloud.com',           'resident_aide')
) AS v(first_name, last_name, email, role)
WHERE NOT EXISTS (
  SELECT 1 FROM public.staff s
   WHERE s.facility_id = '00000000-0000-0000-0002-000000000003'::uuid
     AND s.email       = v.email
     AND s.deleted_at  IS NULL
);

DO $$
DECLARE
  v_seed_emails text[] := ARRAY[
    'celmore.homewoodalf@gmail.com',
    'aa.homewoodlodge@gmail.com',
    'hjberry1969@gmail.com',
    'liltwin2018@gmail.com',
    'kycoverson@gmail.com',
    'nashiafreeman123@gmail.com',
    'Abbigail@icloud.com',
    'kimora1404@icloud.com',
    'kristinhurley1585@gmail.com',
    'jenny2025blue.amen22@gmail.com',
    'ramirez5179.a@gmail.com',
    'rebeccaross01@aim.com',
    'ritatrejosal@gmail.com',
    'kaylasmith1800@icloud.com',
    'kacivicencio220@gmail.com',
    'kawimb15@icloud.com'
  ];
  v_total int;
  v_admin int;
  v_aa int;
  v_aide int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.staff WHERE facility_id='00000000-0000-0000-0002-000000000003' AND email = ANY(v_seed_emails) AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_admin FROM public.staff WHERE facility_id='00000000-0000-0000-0002-000000000003' AND email = ANY(v_seed_emails) AND staff_role='administrator' AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_aa    FROM public.staff WHERE facility_id='00000000-0000-0000-0002-000000000003' AND email = ANY(v_seed_emails) AND staff_role='assistant_administrator' AND deleted_at IS NULL;
  SELECT COUNT(*) INTO v_aide  FROM public.staff WHERE facility_id='00000000-0000-0000-0002-000000000003' AND email = ANY(v_seed_emails) AND staff_role='resident_aide' AND deleted_at IS NULL;
  RAISE NOTICE 'Homewood round-2 staff: total=%, administrator=%, assistant_administrator=%, resident_aide=%', v_total, v_admin, v_aa, v_aide;
  IF v_admin <> 1 OR v_aa <> 1 OR v_aide <> 14 OR v_total <> 16 THEN
    RAISE EXCEPTION 'Homewood seed verification failed: total=%, admin=%, aa=%, aide=%', v_total, v_admin, v_aa, v_aide;
  END IF;
END $$;
