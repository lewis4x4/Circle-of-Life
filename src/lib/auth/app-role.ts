/**
 * JWT / metadata role helpers. Safe for Edge proxy and client bundles.
 * Aligns with `app_role` enum in supabase/migrations/121_user_management_enum_columns.sql.
 */

export const ADMIN_ELIGIBLE_APP_ROLES = new Set<string>([
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
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

/** Manager or above — user management, staffing, scheduling. */
export function isManagerOrAbove(role: string): boolean {
  return (
    role === "owner" ||
    role === "org_admin" ||
    role === "facility_admin" ||
    role === "manager"
  );
}

/** Med-Tech / Nurse roles — dedicated /med-tech cockpit for medication technicians and nurses. */
export function isMedTechRole(role: string): boolean {
  return role === "med_tech" || role === "nurse";
}

/** Dietary role — dedicated /dietary command deck for Lead Cooks and Dietary Aides. */
export function isDietaryRole(role: string): boolean {
  return role === "dietary" || role === "dietary_aide";
}
