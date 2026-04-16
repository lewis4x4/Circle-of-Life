import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole, isMedTechRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/**
 * Med-Tech cockpit path detection.
 */
export function isMedTechShellPath(pathname: string): boolean {
  return pathname === "/med-tech" || pathname.startsWith("/med-tech/");
}

/**
 * Med-Tech UI requires a session and a medication role (`med_tech` or `nurse`).
 * Other known roles redirect to their shells.
 */
export function medTechShellAccessRedirect(
  request: NextRequest,
  user: User | null,
): NextResponse | null {
  const nextUrl = request.nextUrl;

  if (!user) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const role = getAppRoleFromClaims(user);
  if (isMedTechRole(role)) {
    return null;
  }
  if (role === "caregiver" || role === "housekeeper") {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }
  if (role === "family") {
    return NextResponse.redirect(new URL("/family", nextUrl.origin));
  }
  if (isAdminEligibleAppRole(role)) {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
