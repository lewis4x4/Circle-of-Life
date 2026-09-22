-- Brian, 2026-09-22: "make sure Cook and Housekeeper are added" — as login roles and
-- as staff positions. Enum values are added in their own migration: a value added
-- inside a transaction cannot be used until that transaction commits, and 462
-- casts to it throughout.
--
-- app_role: 'housekeeper' already exists (routed to the caregiver app); 'cook' is new
-- and is granted exactly what 'dietary' has, in 462.
-- staff_role: 'housekeeping' exists and is labelled "Housekeeper" in the app;
-- 'cook' is new.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cook';
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'cook';
