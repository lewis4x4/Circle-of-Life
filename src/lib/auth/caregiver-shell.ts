import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole, isOnboardingAppRole, type AuthClaimUser } from "@/lib/auth/app-role";
import { isHousekeeperAllowedPath } from "@/lib/auth/caregiver-route-access";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/**
 * Root-level aliases for `src/app/(caregiver)/` routes (same pages as under `/caregiver/*`).
 */
const CAREGIVER_ROOT_ALIAS_PREFIXES = [
  "/clock",
  "/followups",
  "/handoff",
  "/incident-draft",
  "/me",
  "/meds",
  "/prn-followup",
  "/tasks",
  "/resident",
] as const;

/**
 * The "Something happened" flow (spec 07A). The nine capture roles below may
 * open it, which is how the admin shell's "Report incident" button lands here;
 * the RPC still decides who may submit.
 */
const REPORT_PATH_PREFIX = "/caregiver/report";

export function isCaregiverShellPath(pathname: string): boolean {
  if (pathname === "/caregiver" || pathname.startsWith("/caregiver/")) {
    return true;
  }
  return CAREGIVER_ROOT_ALIAS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isCaregiverReportPath(pathname: string): boolean {
  return pathname === REPORT_PATH_PREFIX || pathname.startsWith(`${REPORT_PATH_PREFIX}/`);
}

/**
 * The nine capture roles that migration 401 lets report a care event may open
 * the report flow (spec 07A §6.3). Family, onboarding, broker, dietary,
 * maintenance and housekeeper roles never reach the census on the Who step.
 */
const REPORT_PATH_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "caregiver",
  "med_tech",
]);

export function isStaffRoleAllowedOnReportPath(role: string): boolean {
  if (!role) return false;
  if (role === "family" || isOnboardingAppRole(role)) return false;
  if (role === "housekeeper") return isHousekeeperAllowedPath(REPORT_PATH_PREFIX);
  return REPORT_PATH_ROLES.has(role);
}

/**
 * Caregiver UI requires a session and a floor role (`caregiver` or `housekeeper`).
 * Other known roles go to their shells, except on `/caregiver/report` where the
 * nine capture roles in REPORT_PATH_ROLES are allowed (spec 07A §6.3).
 */
export function caregiverShellAccessRedirect(request: NextRequest, user: AuthClaimUser | null): NextResponse | null {
  const nextUrl = request.nextUrl;

  if (!user) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const role = getAppRoleFromClaims(user);
  if (role === "caregiver" || role === "housekeeper") {
    if (role === "housekeeper" && !isHousekeeperAllowedPath(nextUrl.pathname)) {
      return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
    }
    return null;
  }
  if (role === "family") {
    return NextResponse.redirect(new URL("/family", nextUrl.origin));
  }
  if (isCaregiverReportPath(nextUrl.pathname) && isStaffRoleAllowedOnReportPath(role)) {
    return null;
  }
  if (isAdminEligibleAppRole(role)) {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
