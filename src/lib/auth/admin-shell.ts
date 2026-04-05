import type { User } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, isAdminEligibleAppRole } from "@/lib/auth/app-role";

/**
 * Top-level URL segments served from `src/app/(admin)/` (route group does not appear in URL).
 * `/admin/*` is the canonical shell; short paths are legacy aliases.
 */
const ADMIN_SHELL_SEGMENTS = [
  "/admin",
  "/billing",
  "/finance",
  "/insurance",
  "/vendors",
  "/residents",
  "/staff",
  "/incidents",
  "/schedules",
  "/staffing",
  "/time-records",
  "/certifications",
  "/assessments",
  "/care-plans",
  "/family-messages",
  "/executive",
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
  if (role === "caregiver") {
    return NextResponse.redirect(new URL("/caregiver", nextUrl.origin));
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
