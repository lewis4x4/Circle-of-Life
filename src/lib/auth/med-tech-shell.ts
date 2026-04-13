import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole } from "@/lib/auth/app-role";

/**
 * Med-Tech cockpit path detection.
 */
export function isMedTechShellPath(pathname: string): boolean {
  return pathname === "/med-tech" || pathname.startsWith("/med-tech/");
}

/**
 * Med-Tech UI requires a session and `med_tech` role.
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
  if (role === "med_tech") {
    return null; // allowed
  }
  if (role === "caregiver") {
    return NextResponse.redirect(new URL("/caregiver", nextUrl.origin));
  }
  if (role === "family") {
    return NextResponse.redirect(new URL("/family", nextUrl.origin));
  }
  if (isAdminEligibleAppRole(role)) {
    return NextResponse.redirect(new URL("/admin", nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
