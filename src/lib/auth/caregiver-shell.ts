import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole } from "@/lib/auth/app-role";

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

export function isCaregiverShellPath(pathname: string): boolean {
  if (pathname === "/caregiver" || pathname.startsWith("/caregiver/")) {
    return true;
  }
  return CAREGIVER_ROOT_ALIAS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Caregiver UI requires a session and `caregiver` role. Other known roles go to their shells.
 */
export function caregiverShellAccessRedirect(request: NextRequest, user: User | null): NextResponse | null {
  const nextUrl = request.nextUrl;

  if (!user) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  const role = getAppRoleFromClaims(user);
  if (role === "caregiver") {
    return null;
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
