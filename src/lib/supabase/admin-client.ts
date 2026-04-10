/**
 * Supabase Auth Admin API wrappers.
 * Uses the service role client — server-only (Route Handlers / Server Actions).
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";

// ── Types ─────────────────────────────────────────────────────────

export interface AdminUserResult {
  id: string;
  email: string;
  app_role: string;
  organization_id: string;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Generate a secure random password for initial account creation. */
function generateSecurePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const array = new Uint8Array(20);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

// ── Admin API wrappers ────────────────────────────────────────────

/**
 * Invite a new user via Supabase Auth. Sends a magic-link invite email.
 * The user's app_role and organization_id are set in app_metadata.
 */
export async function adminInviteUser(
  email: string,
  options: { app_role: string; organization_id: string },
): Promise<AdminUserResult> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: {
      app_role: options.app_role,
      organization_id: options.organization_id,
    },
  });

  if (error) {
    throw new Error(`Auth invite error: ${error.message}`);
  }

  return {
    id: data.user.id,
    email: data.user.email ?? email,
    app_role: options.app_role,
    organization_id: options.organization_id,
  };
}

/**
 * Create a new user with a generated password (for cases where invite email is not sent).
 */
export async function adminCreateUser(
  email: string,
  options: { app_role: string; organization_id: string; email_confirm?: boolean },
): Promise<{ user: AdminUserResult; temporary_password: string }> {
  const supabase = createServiceRoleClient();
  const password = generateSecurePassword();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: options.email_confirm ?? false,
    user_metadata: {},
    app_metadata: {
      app_role: options.app_role,
      organization_id: options.organization_id,
    },
  });

  if (error) {
    throw new Error(`Auth create error: ${error.message}`);
  }

  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? email,
      app_role: options.app_role,
      organization_id: options.organization_id,
    },
    temporary_password: password,
  };
}

/**
 * Update a user's app_role in auth.users app_metadata.
 */
export async function adminUpdateUserRole(
  userId: string,
  newRole: string,
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { app_role: newRole },
  });

  if (error) {
    throw new Error(`Auth role update error: ${error.message}`);
  }
}

/**
 * Disable a user account (ban for ~100 years).
 */
export async function adminDisableUser(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });

  if (error) {
    throw new Error(`Auth disable error: ${error.message}`);
  }
}

/**
 * Re-enable a previously disabled user account.
 */
export async function adminEnableUser(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: "0s",
  });

  if (error) {
    throw new Error(`Auth enable error: ${error.message}`);
  }
}
