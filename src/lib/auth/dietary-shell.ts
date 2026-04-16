import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole, isDietaryRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

export function isDietaryShellPath(pathname: string): boolean {
  return pathname === "/dietary" || pathname.startsWith("/dietary/");
}

export function dietaryShellAccessRedirect(
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
  if (isDietaryRole(role) || isAdminEligibleAppRole(role)) {
    return null;
  }
  if (role === "med_tech") {
    return NextResponse.redirect(new URL("/med-tech", nextUrl.origin));
  }
  if (role === "caregiver" || role === "housekeeper") {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }
  if (role === "family") {
    return NextResponse.redirect(new URL("/family", nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
