-- Homewood Round-2 employee seed (M4: Employees / Users / Roles)
-- Source: Jessica Murphy "Employees Information.xlsx" (Drive 1eWUKm5OcAbW1I9kFPuMmqlAdbYC2-xGq), 2026-05-14.
-- Idempotent insert of 16 Homewood Lodge ALF staff (facility 00000000-0000-0000-0002-000000000003).
-- Source provider = Jessica Murphy; created_by uses the replay-safe system actor.
-- Role mapping (xlsx -> staff_role enum):
--   Administrator            -> administrator
--   Administrative Assistant -> assistant_administrator
--   Universal                -> resident_aide
-- Applied to remote 2026-05-14 via Supabase MCP apply_migration.
--
-- NOTE: the `staff_role` ADD VALUE statements were moved to the earlier
-- migration 20260514180000_staff_role_enum_values.sql so the new enum values
-- commit before this migration's transaction uses them — Postgres forbids using
-- a freshly-added enum value in the same transaction. See that file for why.

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
  ('Synthetic first_name 8962392173',  'Synthetic last_name 42cd302db7',     'synthetic-30974e9122@example.invalid', 'administrator'),
  ('Synthetic first_name 8413841566',    'Synthetic last_name 6c1d84c88f',    'synthetic-41ad1e5dc6@example.invalid',    'assistant_administrator'),
  ('Synthetic first_name 867417e00d',     'Synthetic last_name 73cce42f1f',      'synthetic-289905cba2@example.invalid',         'resident_aide'),
  ('Synthetic first_name 947b311044',  'Synthetic last_name 16c47b6a77',   'synthetic-1e9d1b8def@example.invalid',         'resident_aide'),
  ('Synthetic first_name 3207636635',  'Synthetic last_name 16c47b6a77',   'synthetic-0a6cbf61a9@example.invalid',          'resident_aide'),
  ('Synthetic first_name d0d5f21f94',   'Synthetic last_name 5515ea2b44',    'synthetic-3cb9784654@example.invalid',    'resident_aide'),
  ('Synthetic first_name cf03a41b4d',  'Synthetic last_name 3cbaeb57c6',       'synthetic-03d310c466@example.invalid',           'resident_aide'),
  ('Synthetic first_name a553091565',    'Synthetic last_name 3cbaeb57c6',       'synthetic-109f419729@example.invalid',         'resident_aide'),
  ('Synthetic first_name 1bcb037d00',   'Synthetic last_name f21cc83ae6',     'synthetic-7934561ddc@example.invalid',   'resident_aide'),
  ('Synthetic first_name 9ce8db922a',  'Synthetic last_name db044f19bc',   'synthetic-e9971c8bf3@example.invalid','resident_aide'),
  ('Synthetic first_name b983e26b14',   'Synthetic last_name 9f714d1e5a',    'synthetic-fe650dc2ce@example.invalid',       'resident_aide'),
  ('Synthetic first_name 6bdf0b2dfc',   'Synthetic last_name fbd8dafe1f',       'synthetic-e67b24cfa7@example.invalid',         'resident_aide'),
  ('Synthetic first_name c5420b4378',      'Synthetic last_name cf829ddb6f',      'synthetic-05f00120c2@example.invalid',        'resident_aide'),
  ('Synthetic first_name fbb16e8cde',     'Synthetic last_name 6627835f98',      'synthetic-ace4663b3f@example.invalid',     'resident_aide'),
  ('Synthetic first_name 7e009e413b',      'Synthetic last_name df39347ab3',   'synthetic-ea3d3b1f58@example.invalid',     'resident_aide'),
  ('Synthetic first_name fbb16e8cde',     'Synthetic last_name 80bfc7fb96',  'synthetic-8111366f8e@example.invalid',           'resident_aide')
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
    'synthetic-30974e9122@example.invalid',
    'synthetic-41ad1e5dc6@example.invalid',
    'synthetic-289905cba2@example.invalid',
    'synthetic-1e9d1b8def@example.invalid',
    'synthetic-0a6cbf61a9@example.invalid',
    'synthetic-3cb9784654@example.invalid',
    'synthetic-03d310c466@example.invalid',
    'synthetic-109f419729@example.invalid',
    'synthetic-7934561ddc@example.invalid',
    'synthetic-e9971c8bf3@example.invalid',
    'synthetic-fe650dc2ce@example.invalid',
    'synthetic-e67b24cfa7@example.invalid',
    'synthetic-05f00120c2@example.invalid',
    'synthetic-ace4663b3f@example.invalid',
    'synthetic-ea3d3b1f58@example.invalid',
    'synthetic-8111366f8e@example.invalid'
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
