/**
 * Server-only: sync must-change-password between auth app_metadata and user_profiles.settings.
 */

import { mergeMustChangePasswordSetting } from "@/lib/auth/must-change-password";
import {
  TEMPORARY_PASSWORD_EXPIRES_AT_KEY,
  temporaryPasswordExpiresAt,
} from "@/lib/auth/temporary-password";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function adminSetMustChangePassword(
  userId: string,
  required: boolean,
  options: { expiresAt?: string } = {},
): Promise<{ expires_at: string | null }> {
  const supabase = createServiceRoleClient();
  const expiresAt = required ? (options.expiresAt ?? temporaryPasswordExpiresAt()) : null;

  const { data: authUser, error: authReadErr } = await supabase.auth.admin.getUserById(userId);
  if (authReadErr) {
    throw new Error(`Auth read error: ${authReadErr.message}`);
  }

  const priorMeta =
    authUser.user?.app_metadata && typeof authUser.user.app_metadata === "object"
      ? { ...authUser.user.app_metadata }
      : {};
  // Never leave a deadline behind when the obligation is cleared.
  delete (priorMeta as Record<string, unknown>)[TEMPORARY_PASSWORD_EXPIRES_AT_KEY];

  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...priorMeta,
      must_change_password: required,
      ...(expiresAt ? { [TEMPORARY_PASSWORD_EXPIRES_AT_KEY]: expiresAt } : {}),
    },
  });
  if (metaErr) {
    throw new Error(`Auth metadata update error: ${metaErr.message}`);
  }

  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) {
    throw new Error(`Profile settings read error: ${profileErr.message}`);
  }
  if (!profile) {
    return { expires_at: expiresAt };
  }

  const { error: updateErr } = await supabase
    .from("user_profiles")
    .update({ settings: mergeMustChangePasswordSetting(profile.settings, required, expiresAt) })
    .eq("id", userId);
  if (updateErr) {
    throw new Error(`Profile settings update error: ${updateErr.message}`);
  }

  return { expires_at: expiresAt };
}
