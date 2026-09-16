import type { Json } from "@/types/database";
import { TEMPORARY_PASSWORD_EXPIRES_AT_KEY } from "@/lib/auth/temporary-password";

/** JSON key in `user_profiles.settings` and mirror in auth `app_metadata`. */
export const MUST_CHANGE_PASSWORD_SETTINGS_KEY = "must_change_password";

export function readMustChangePasswordFromSettings(
  settings: unknown,
): boolean {
  if (!settings || typeof settings !== "object") {
    return false;
  }
  return (settings as Record<string, unknown>)[MUST_CHANGE_PASSWORD_SETTINGS_KEY] === true;
}

/** The deadline paired with a forced change, or null when none is recorded. */
export function readMustChangePasswordExpiryFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") {
    return null;
  }
  const value = (settings as Record<string, unknown>)[TEMPORARY_PASSWORD_EXPIRES_AT_KEY];
  return typeof value === "string" ? value : null;
}

export function mergeMustChangePasswordSetting(
  settings: unknown,
  required: boolean,
  expiresAt?: string | null,
): Json {
  const base: Record<string, Json> =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...(settings as Record<string, Json>) }
      : {};
  if (required) {
    base[MUST_CHANGE_PASSWORD_SETTINGS_KEY] = true;
    if (expiresAt) {
      base[TEMPORARY_PASSWORD_EXPIRES_AT_KEY] = expiresAt;
    }
  } else {
    delete base[MUST_CHANGE_PASSWORD_SETTINGS_KEY];
    // Clearing the obligation always clears its deadline — a stale expiry left behind
    // would make a healthy account look like an expired temp credential.
    delete base[TEMPORARY_PASSWORD_EXPIRES_AT_KEY];
  }
  return base;
}

export const CHANGE_PASSWORD_ALLOWED_PATH_PREFIXES = [
  "/change-password",
  "/login",
  "/reset-password",
] as const;

export function isChangePasswordExemptPath(pathname: string | null): boolean {
  if (!pathname) {
    return false;
  }
  return CHANGE_PASSWORD_ALLOWED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
