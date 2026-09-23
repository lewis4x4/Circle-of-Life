import { type NextRequest, NextResponse } from "next/server";

import { getAppRoleFromClaims, type AuthClaimUser } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { FLOOR_LOCK_PATH, FLOOR_SETUP_PATH } from "@/lib/floor/contract";
import { ALL_APP_ROLES, isFloorRosterEligibleRole } from "@/lib/rbac";

/**
 * Shared floor tablet paths (COL-690, spec 40 §6). `/floor/*` sits outside the
 * admin shell and is gated here, in the proxy.
 */
export function isFloorShellPath(pathname: string): boolean {
  return pathname === "/floor" || pathname.startsWith("/floor/");
}

/**
 * The lock and setup screens need no session: the device token lives in
 * IndexedDB, which the proxy cannot read, so those pages check it themselves
 * and send an unenrolled tablet to setup.
 */
export function isFloorSessionlessPath(pathname: string): boolean {
  return [FLOOR_LOCK_PATH, FLOOR_SETUP_PATH].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Every other floor page needs a session whose login role could be on some
 * floor roster (`isFloorRosterEligibleRole`). Which roles a given tablet lists
 * is configuration the database enforces at unlock; this is the outer bound.
 * No session (or a retired or unknown role) goes to the lock screen, never to
 * the password login: a floor tablet has no login form.
 */
export function floorShellAccessRedirect(request: NextRequest, user: AuthClaimUser | null): NextResponse | null {
  const nextUrl = request.nextUrl;
  if (isFloorSessionlessPath(nextUrl.pathname)) return null;

  const role = getAppRoleFromClaims(user);
  if (user && isFloorRosterEligibleRole(role)) return null;

  // A current login role that is never on a roster (family, broker) goes home.
  if (user && (ALL_APP_ROLES as readonly string[]).includes(role)) {
    return NextResponse.redirect(new URL(getDashboardRouteForRole(role), nextUrl.origin));
  }

  const url = nextUrl.clone();
  url.pathname = FLOOR_LOCK_PATH;
  url.search = "";
  return NextResponse.redirect(url);
}
