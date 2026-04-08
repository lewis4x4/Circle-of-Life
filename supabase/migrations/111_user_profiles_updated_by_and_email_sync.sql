-- haven_set_updated_at() (006) assigns NEW.updated_by; user_profiles lacked the column, so any UPDATE failed.
-- Add the column to match org hierarchy tables, then align demo emails with auth.users (094).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users (id);

COMMENT ON COLUMN public.user_profiles.updated_by IS 'Last updater; set by haven_set_updated_at trigger.';

UPDATE public.user_profiles p
SET
  email = u.email,
  updated_at = now()
FROM auth.users u
WHERE
  p.id = u.id
  AND p.id IN (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007'
  );
