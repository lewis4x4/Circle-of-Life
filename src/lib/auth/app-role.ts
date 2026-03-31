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
  const fromApp = user.app_metadata?.app_role;
  const fromUser = user.user_metadata?.app_role;
  const raw = fromApp ?? fromUser;
  return typeof raw === "string" ? raw : "";
}

export function isAdminEligibleAppRole(role: string): boolean {
  return role !== "" && ADMIN_ELIGIBLE_APP_ROLES.has(role);
}
