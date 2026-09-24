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
  // Recruiter opens the admin shell but only its referrals / pipeline / reputation pages
  // (isRecruiterAllowedAdminPath below; owner ruling 2026-09-22).
  "recruiter",
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

/** Recruiter role — referrals, pipeline and reputation only (owner ruling 2026-09-22). */
export function isRecruiterRole(role: string): boolean {
  return role === "recruiter";
}

/**
 * Admin-shell pages a recruiter user may open. Everything else in the admin shell
 * (residents, clinical, billing, payroll, staff, settings, ...) sends them to their home.
 */
const RECRUITER_ADMIN_PATH_PREFIXES = [
  "/admin/referrals",
  // COL-752: recruiters attend the Thursday Stand Up and read it. The page shows
  // them Thursday only, and the server refuses them Monday and every write.
  "/admin/stand-up",
  // Pipeline aliases for the referral CRM. /pipeline/recent-admissions leads into
  // resident records and stays closed, as does /admin/discharge.
  "/pipeline/referrals",
  "/pipeline/referrals-crm",
  "/reputation",
  "/admin/reputation",
] as const;

/**
 * Brian, 2026-09-23: "take away admin finance, payroll and staff pages from
 * med-techs". Med-Tech inherited the retired nurse role's admin-shell access
 * (COL-615); these areas are withdrawn from it. Short aliases (/finance, /payroll,
 * /staff) are the same pages.
 */
const MED_TECH_BLOCKED_ADMIN_PATH_PREFIXES = [
  "/admin/finance",
  "/finance",
  "/admin/payroll",
  "/payroll",
  "/admin/staff",
  "/staff",
] as const;

export function isMedTechBlockedAdminPath(pathname: string): boolean {
  return MED_TECH_BLOCKED_ADMIN_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isRecruiterAllowedAdminPath(pathname: string): boolean {
  return RECRUITER_ADMIN_PATH_PREFIXES.some(
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
