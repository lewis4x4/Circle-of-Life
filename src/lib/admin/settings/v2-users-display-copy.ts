/**
 * Quiet Operator copy for the v2 settings users roster table.
 * Missing name, email, role, title, and last-login values name real gaps — never silent em dashes.
 */

export const V2_USERS_NO_NAME_COPY = "No name posted";
export const V2_USERS_NO_EMAIL_COPY = "No email posted";
export const V2_USERS_NO_ROLE_COPY = "No role posted";
export const V2_USERS_NO_TITLE_COPY = "No title posted";
export const V2_USERS_NO_LAST_LOGIN_COPY = "No last login posted";

/** Name column when unset or blank. Posted names return trimmed text as-is. */
export function formatV2UsersNameDisplay(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return V2_USERS_NO_NAME_COPY;
  return trimmed;
}

/** Email column when unset or blank. Posted emails return trimmed text as-is. */
export function formatV2UsersEmailDisplay(email: string | null | undefined): string {
  const trimmed = email?.trim() ?? "";
  if (!trimmed) return V2_USERS_NO_EMAIL_COPY;
  return trimmed;
}

/** Role column when unset or blank. Posted roles return trimmed text as-is. */
export function formatV2UsersRoleDisplay(role: string | null | undefined): string {
  const trimmed = role?.trim() ?? "";
  if (!trimmed) return V2_USERS_NO_ROLE_COPY;
  return trimmed;
}

/** Job title column when unset or blank. Posted titles return trimmed text as-is. */
export function formatV2UsersJobTitleDisplay(jobTitle: string | null | undefined): string {
  const trimmed = jobTitle?.trim() ?? "";
  if (!trimmed) return V2_USERS_NO_TITLE_COPY;
  return trimmed;
}

/** Last login column when unset or blank. Posted timestamps use replace("T", " ").slice(0, 19). */
export function formatV2UsersLastLoginDisplay(
  lastLoginAt: string | null | undefined,
): string {
  const trimmed = lastLoginAt?.trim() ?? "";
  if (!trimmed) return V2_USERS_NO_LAST_LOGIN_COPY;
  return trimmed.replace("T", " ").slice(0, 19);
}
