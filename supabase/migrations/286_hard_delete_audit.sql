-- Slice C: allow audited hard-delete of history-free user accounts.
--
-- Hard-delete is only available through the owner-only API route after a
-- protected-history sweep. Audit rows must survive profile deletion, so the
-- target pointer becomes nullable and SET NULL on profile removal. The profile
-- row itself must be removable by deleting auth.users first per the API's
-- ordering contract, so the auth FK becomes ON DELETE CASCADE.

ALTER TABLE public.user_management_audit_log
  DROP CONSTRAINT IF EXISTS valid_audit_action;

ALTER TABLE public.user_management_audit_log
  ADD CONSTRAINT valid_audit_action CHECK (action IN (
    'create',
    'update_profile',
    'update_role',
    'grant_access',
    'revoke_access',
    'soft_delete',
    'reactivate',
    'password_reset',
    'hard_delete'
  ));

ALTER TABLE public.user_management_audit_log
  DROP CONSTRAINT IF EXISTS user_management_audit_log_target_user_id_fkey;

ALTER TABLE public.user_management_audit_log
  ALTER COLUMN target_user_id DROP NOT NULL;

ALTER TABLE public.user_management_audit_log
  ADD CONSTRAINT user_management_audit_log_target_user_id_fkey
  FOREIGN KEY (target_user_id)
  REFERENCES public.user_profiles(id)
  ON DELETE SET NULL;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_id_fkey
  FOREIGN KEY (id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;
