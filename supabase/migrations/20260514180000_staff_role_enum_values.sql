-- Widen the staff_role enum ahead of the Homewood Round-2 employee seed.
--
-- Postgres forbids using a newly-added enum value in the SAME transaction that
-- added it ("unsafe use of new value of enum type"). The seed migration
-- (20260514180707_homewood_round2_employee_seed.sql) casts text to staff_role
-- using these values, so the ADD VALUE statements must commit in an EARLIER
-- migration. This file sorts before the seed and runs in its own transaction,
-- so the values are committed before the seed's INSERT references them.
--
-- Idempotent (ADD VALUE IF NOT EXISTS): a no-op on any database where these
-- values already exist (e.g. production, where the original seed already ran).

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
