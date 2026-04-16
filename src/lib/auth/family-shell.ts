import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/** Family portal lives under `src/app/(family)/family/`. */
export function isFamilyShellPath(pathname: string): boolean {
  return pathname === "/family" || pathname.startsWith("/family/");
}

/**
 * Family UI requires a session and `family` role. Other known roles go to their shells.
 */
export function familyShellAccessRedirect(request: NextRequest, user: User | null): NextResponse | null {
  const nextUrl = request.nextUrl;

  if (!user) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const role = getAppRoleFromClaims(user);
  if (role === "family") {
    return null;
  }
  if (role === "caregiver" || role === "housekeeper") {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }
  if (isAdminEligibleAppRole(role)) {
    return NextResponse.redirect(new URL("/admin", nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
