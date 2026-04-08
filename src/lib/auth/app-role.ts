/**
 * JWT / metadata role helpers. Safe for Edge proxy and client bundles.
 * Aligns with `app_role` enum in supabase/migrations/001_enum_types.sql.
 */

export const ADMIN_ELIGIBLE_APP_ROLES = new Set<string>([
  "owner",
  "org_admin",
  "facility_admin",
  "nurse",
  "dietary",
  "maintenance_role",
  "broker",
]);

export function getAppRoleFromClaims(user: {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
} | null): string {
  if (!user) return "";
  // Only trust app_metadata for authorization — user_metadata is user-editable
  // in many Supabase configurations and must not be used for role decisions.
  const raw = user.app_metadata?.app_role;
  return typeof raw === "string" ? raw : "";
}

export function isAdminEligibleAppRole(role: string): boolean {
  return role !== "" && ADMIN_ELIGIBLE_APP_ROLES.has(role);
}

export function isOnboardingAppRole(role: string): boolean {
  return role === "onboarding";
}

/** Owner / org admin — onboarding JSON import, question pack upload, markdown export. */
export function isOrgAdminAppRole(role: string): boolean {
  return role === "owner" || role === "org_admin";
}
