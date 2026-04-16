import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import {
  getAppRoleFromClaims,
  isDietaryRole,
  isMedTechRole,
  isOnboardingAppRole,
  isOrgAdminAppRole,
} from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

/** Onboarding portal lives under `src/app/(onboarding)/onboarding/`. */
export function isOnboardingShellPath(pathname: string): boolean {
  return pathname === "/onboarding" || pathname.startsWith("/onboarding/");
}

/**
 * Onboarding UI requires a session and either:
 * - the dedicated `onboarding` role, or
 * - an org-level admin role (`owner`, `org_admin`)
 *
 * Everyone else is routed to their dedicated home.
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
  if (isOnboardingAppRole(role) || isOrgAdminAppRole(role)) {
    return null;
  }
  if (
    role === "caregiver" ||
    role === "housekeeper" ||
    role === "family" ||
    isDietaryRole(role) ||
    isMedTechRole(role) ||
    role === "facility_admin" ||
    role === "manager" ||
    role === "admin_assistant" ||
    role === "coordinator" ||
    role === "nurse" ||
    role === "maintenance_role" ||
    role === "broker"
  ) {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("reason", "forbidden");
  return NextResponse.redirect(url);
}
