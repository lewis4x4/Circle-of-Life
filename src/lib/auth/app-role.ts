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
  "med_tech",
  "maintenance_role",
  "broker",
  // Marketing opens the admin shell but only its referrals / pipeline / reputation pages
  // (isMarketingAllowedAdminPath below; owner ruling 2026-09-22).
  "marketing",
]);

export type AuthClaimUser = {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

export function getAppRoleFromClaims(user: AuthClaimUser | null): string {
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

/**
 * Med-Tech role — dedicated /med-tech cockpit for medication technicians.
 * Owner ruling 2026-09-22: the legacy `nurse` app role is not used; Med-Tech holds
 * everything nurse had (migration 468 converted every nurse user to med_tech).
 */
export function isMedTechRole(role: string): boolean {
  return role === "med_tech";
}

/**
 * Dietary role — dedicated /dietary command deck for Cooks.
 * Owner ruling 2026-09-22: `dietary` (Lead Cook) and `dietary_aide` are retired and folded
 * into `cook` (migration 468); the legacy values are still accepted so a stale token routes sanely.
 */
export function isDietaryRole(role: string): boolean {
  return role === "cook" || role === "dietary" || role === "dietary_aide";
}

/** Marketing role — referrals, pipeline and reputation only (owner ruling 2026-09-22). */
export function isMarketingRole(role: string): boolean {
  return role === "marketing";
}

/**
 * Admin-shell pages a marketing user may open. Everything else in the admin shell
 * (residents, clinical, billing, payroll, staff, settings, ...) sends them to their home.
 */
const MARKETING_ADMIN_PATH_PREFIXES = [
  "/admin/referrals",
  // Pipeline aliases for the referral CRM. /pipeline/recent-admissions and
  // /pipeline/discharge-management lead into resident records and stay closed.
  "/pipeline/referrals",
  "/pipeline/referrals-crm",
  "/reputation",
  "/admin/reputation",
] as const;

export function isMarketingAllowedAdminPath(pathname: string): boolean {
  return MARKETING_ADMIN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Facility operator titles — Administrator, Assistant Administrator, Manager —
 * share one permission set and one Home (DEC-2026-09-22-02 / COL-571). The
 * `manager` app_role value is kept only until it is retired.
 */
export function isFacilityOperatorRole(role: string): boolean {
  return role === "facility_admin" || role === "manager";
}
