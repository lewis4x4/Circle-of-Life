-- Approved new staging only; pre-commit migration174's enum addition.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dietary_aide';
