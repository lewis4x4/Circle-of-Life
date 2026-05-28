-- Allow user-management audit log entries for admin password resets.

ALTER TABLE user_management_audit_log
  DROP CONSTRAINT IF EXISTS valid_audit_action;

ALTER TABLE user_management_audit_log
  ADD CONSTRAINT valid_audit_action CHECK (action IN (
    'create',
    'update_profile',
    'update_role',
    'grant_access',
    'revoke_access',
    'soft_delete',
    'reactivate',
    'password_reset'
  ));
