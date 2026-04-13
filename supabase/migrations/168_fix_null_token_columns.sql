-- Migration 168: Fix NULL token columns that crash GoTrue.
--
-- Root cause found: GoTrue expects empty strings ('') not NULL for
-- recovery_token, email_change_token_new, email_change, and
-- email_change_token_current. Our SQL INSERTs left these as NULL
-- because we didn't specify them. GoTrue's Go code panics on NULL.

-- phone has a UNIQUE constraint so we cannot set multiple rows to ''.
-- GoTrue tolerates NULL phone (only token columns crash on NULL).
UPDATE auth.users
SET
  recovery_token         = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change           = COALESCE(email_change, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  phone_change           = COALESCE(phone_change, ''),
  phone_change_token     = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  updated_at = now()
WHERE id IN (
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000007',
  'a0000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000009',
  'a0000000-0000-0000-0000-000000000010',
  'a0000000-0000-0000-0000-000000000011'
);
