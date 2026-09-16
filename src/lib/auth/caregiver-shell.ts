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
 * The "Something happened" flow (spec 07A). Every signed-in staff role may
 * open it so the admin shell's "Report incident" button lands here; the RPC
 * still decides who may submit.
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
 * Any signed-in staff role that is not `family` or `onboarding` may open the
 * report flow. Housekeepers keep their own allow-list (the report path is not on it).
 */
export function isStaffRoleAllowedOnReportPath(role: string): boolean {
  if (!role) return false;
  if (role === "family" || isOnboardingAppRole(role)) return false;
  if (role === "housekeeper") return isHousekeeperAllowedPath(REPORT_PATH_PREFIX);
  return true;
}

/**
 * Caregiver UI requires a session and a floor role (`caregiver` or `housekeeper`).
 * Other known roles go to their shells, except on `/caregiver/report` where every
 * non-family staff role is allowed (spec 07A §6.3).
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
