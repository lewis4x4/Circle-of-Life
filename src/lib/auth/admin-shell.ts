import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole, isDietaryRole, isOrgAdminAppRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/**
 * Top-level URL segments served from `src/app/(admin)/` (route group does not appear in URL).
 * `/admin/*` is the canonical shell; short paths are legacy aliases.
 */
const ADMIN_SHELL_SEGMENTS = [
  "/admin",
  "/billing",
  "/finance",
  "/risk",
  "/insurance",
  "/vendors",
  "/residents",
  "/staff",
  "/incidents",
  "/schedules",
  "/staffing",
  "/time-records",
  "/payroll",
  "/certifications",
  "/training",
  "/transportation",
  "/reputation",
  "/assessments",
  "/care-plans",
  "/family-messages",
  "/executive",
  "/search",
  "/reports",
  "/admin/settings/users",
] as const;

export function isAdminShellPath(pathname: string): boolean {
  return ADMIN_SHELL_SEGMENTS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * When the request targets the admin shell: require a Supabase session and a role that may use it.
 * Returns a redirect response, or null to continue with the session refresh response.
 */
export function adminShellAccessRedirect(request: NextRequest, user: User | null): NextResponse | null {
  const nextUrl = request.nextUrl;

  if (!user) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const role = getAppRoleFromClaims(user);
  if (role === "caregiver" || role === "housekeeper") {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }
  if (isDietaryRole(role) && nextUrl.pathname === "/admin/dietary-dashboard") {
    return NextResponse.redirect(new URL("/dietary", nextUrl.origin));
  }
  if (role === "family") {
    return NextResponse.redirect(new URL("/family", nextUrl.origin));
  }
  if (!isAdminEligibleAppRole(role)) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("reason", "forbidden");
    return NextResponse.redirect(url);
  }

  const roleHome = getDashboardRouteForRole(role);
  if (nextUrl.pathname === "/admin" && roleHome !== "/admin") {
    return NextResponse.redirect(new URL(roleHome, nextUrl.origin));
  }

  const isExecutiveShellPath =
    nextUrl.pathname === "/admin/executive" ||
    nextUrl.pathname.startsWith("/admin/executive/") ||
    nextUrl.pathname === "/executive" ||
    nextUrl.pathname.startsWith("/executive/");
  const isExecutiveStandupPath =
    nextUrl.pathname === "/admin/executive/standup" ||
    nextUrl.pathname.startsWith("/admin/executive/standup/") ||
    nextUrl.pathname === "/executive/standup" ||
    nextUrl.pathname.startsWith("/executive/standup/");
  if (isExecutiveShellPath && !isExecutiveStandupPath && !isOrgAdminAppRole(role)) {
    return NextResponse.redirect(new URL(roleHome, nextUrl.origin));
  }
  if (isExecutiveStandupPath && !(role === "facility_admin" || isOrgAdminAppRole(role))) {
    return NextResponse.redirect(new URL(roleHome, nextUrl.origin));
  }

  return null;
}

/** Preserve refreshed auth cookies on redirect responses. */
export function mergeSetCookieHeaders(from: NextResponse, to: NextResponse): void {
  from.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      to.headers.append(key, value);
    }
  });
}
