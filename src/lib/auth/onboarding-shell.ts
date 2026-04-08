import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole, isOnboardingAppRole } from "@/lib/auth/app-role";

/** Onboarding portal lives under `src/app/(onboarding)/onboarding/`. */
export function isOnboardingShellPath(pathname: string): boolean {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

/**
 * Onboarding UI requires a session and onboarding/admin-eligible role.
 * Caregiver/family roles are routed to their dedicated shells.
 */
export function onboardingShellAccessRedirect(request: NextRequest, user: User | null): NextResponse | null {
  const nextUrl = request.nextUrl;

  if (!user) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const role = getAppRoleFromClaims(user);
  if (isOnboardingAppRole(role) || isAdminEligibleAppRole(role)) {
    return null;
  }
  if (role === "caregiver") {
    return NextResponse.redirect(new URL("/caregiver", nextUrl.origin));
  }
  if (role === "family") {
    return NextResponse.redirect(new URL("/family", nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
