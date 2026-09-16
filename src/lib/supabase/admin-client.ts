/**
 * Supabase Auth Admin API wrappers.
 * Uses the service role client — server-only (Route Handlers / Server Actions).
 */

import { createClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { adminSetMustChangePassword } from "@/lib/supabase/must-change-password-admin";
import type { Database } from "@/types/database";

// ── Types ─────────────────────────────────────────────────────────

export interface AdminUserResult {
  id: string;
  email: string;
  app_role: string;
  organization_id: string;
}

export type AuthAdminLookupResult = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
};

type AuthAdminSnapshot = {
  id: string;
  email: string;
  last_sign_in_at: string | null;
  app_role: string | null;
  auth_claim_version: number | null;
  banned_until: string | null;
};

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

  // Always inspect the invite result. GoTrue can answer without an `error` and still
  // hand back no user; the old code fell through to `data.user.id` and died with a raw
  // TypeError that surfaced as a generic 500, which is how a non-invite came to look
  // like a sent invite (COL-362).
  const invitedUserId = data?.user?.id;
  if (!invitedUserId) {
    throw new Error("Auth invite error: invite returned no user; treat the invite as not sent");
  }

  // inviteUserByEmail only writes user_metadata. Mirror the role + org into
  // app_metadata so `getAppRoleFromClaims` (which only trusts app_metadata)
  // can route the user correctly on first sign-in.
  const { error: metaError } = await supabase.auth.admin.updateUserById(invitedUserId, {
    app_metadata: {
      app_role: options.app_role,
      organization_id: options.organization_id,
    },
  });

  if (metaError) {
    // The invite already went out. If the metadata write fails, we'd produce
    // the same bug we're fixing — surface clearly so the admin can react.
    throw new Error(`Invite sent but app_metadata write failed: ${metaError.message}`);
  }

  return {
    id: invitedUserId,
    email: data.user?.email ?? email,
    app_role: options.app_role,
    organization_id: options.organization_id,
  };
}

/**
 * Find an existing auth user by email.
 * Uses paginated admin listing because GoTrue has no direct getUserByEmail API.
 */
/** @deprecated Use adminFindAuthUserByEmail */
export async function adminFindUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const match = await adminFindAuthUserByEmail(email);
  if (!match) {
    return null;
  }
  return { id: match.id, email: match.email };
}

export async function adminFindAuthUserByEmail(email: string): Promise<AuthAdminLookupResult | null> {
  const users = await adminListAuthUsers();
  const normalized = email.trim().toLowerCase();
  const match = users.find(
    (user) => (user.email ?? "").trim().toLowerCase() === normalized,
  );
  if (!match?.email) {
    return null;
  }
  return {
    id: match.id,
    email: match.email,
    email_confirmed_at: match.email_confirmed_at ?? null,
    last_sign_in_at: match.last_sign_in_at ?? null,
  };
}

async function adminListAuthUsers() {
  const supabase = createServiceRoleClient();
  let page = 1;
  const users: Array<{
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    last_sign_in_at?: string | null;
    app_metadata?: Record<string, unknown>;
    banned_until?: string | null;
  }> = [];

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      throw new Error(`Auth lookup error: ${error.message}`);
    }

    users.push(...(data.users ?? []));

    if (!data.nextPage || data.users.length === 0) {
      return users;
    }
    page = data.nextPage;
  }
}

export async function adminGetAuthSnapshotsByIds(
  userIds: string[],
): Promise<Record<string, AuthAdminSnapshot>> {
  if (userIds.length === 0) {
    return {};
  }

  const wanted = new Set(userIds);
  const users = await adminListAuthUsers();
  return users.reduce<Record<string, AuthAdminSnapshot>>((acc, user) => {
    if (!wanted.has(user.id)) {
      return acc;
    }
    acc[user.id] = {
      id: user.id,
      email: user.email ?? "",
      last_sign_in_at: user.last_sign_in_at ?? null,
      app_role: typeof user.app_metadata?.app_role === "string" ? user.app_metadata.app_role : null,
      auth_claim_version:
        typeof user.app_metadata?.auth_claim_version === "number"
          ? user.app_metadata.auth_claim_version
          : null,
      banned_until: user.banned_until ?? null,
    };
    return acc;
  }, {});
}

/**
 * Create a new user with a generated password (for cases where invite email is not sent).
 */
/**
 * Confirm email and set a fresh temporary password so the user can sign in immediately.
 */
export async function adminSetUserSignInReadyWithTemporaryPassword(
  userId: string,
): Promise<{ temporary_password: string }> {
  const supabase = createServiceRoleClient();
  const password = generateSecurePassword();

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Auth sign-in ready update error: ${error.message}`);
  }

  await adminSetMustChangePassword(userId, true);

  return { temporary_password: password };
}

function createPasswordResetAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** Sends Supabase password-reset email (same channel as admin reset-password route). */
export async function adminSendPasswordResetEmail(email: string): Promise<void> {
  const resetClient = createPasswordResetAnonClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://circleoflifealf.com";
  const { error } = await resetClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/reset-password`,
  });
  if (error) {
    throw new Error(`Password reset email error: ${error.message}`);
  }
}

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
  if (!data?.user?.id) {
    throw new Error("Auth create error: create returned no user");
  }

  await adminSetMustChangePassword(data.user.id, true);

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
 * Update auth app_metadata for an existing user.
 */
export async function adminUpdateUserAccessMetadata(
  userId: string,
  updates: { app_role: string; organization_id: string; auth_claim_version?: number },
): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      app_role: updates.app_role,
      organization_id: updates.organization_id,
      ...(updates.auth_claim_version === undefined
        ? {}
        : { auth_claim_version: updates.auth_claim_version }),
    },
  });

  if (error) {
    throw new Error(`Auth metadata update error: ${error.message}`);
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

/**
 * Permanently remove a user from Supabase Auth.
 * Caller must complete all product-level role/history gates first.
 */
export async function adminHardDeleteUser(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { error } = await supabase.auth.admin.deleteUser(userId);

  if (error) {
    throw new Error(`Auth hard delete error: ${error.message}`);
  }
}
