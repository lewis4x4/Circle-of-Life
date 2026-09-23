import { NextRequest } from "next/server";

import { adminShellAccessRedirect, isAdminShellPath } from "@/lib/auth/admin-shell";
import { caregiverShellAccessRedirect, isCaregiverShellPath } from "@/lib/auth/caregiver-shell";
import { dietaryShellAccessRedirect, isDietaryShellPath } from "@/lib/auth/dietary-shell";
import { familyShellAccessRedirect, isFamilyShellPath } from "@/lib/auth/family-shell";
import { floorShellAccessRedirect, isFloorShellPath } from "@/lib/auth/floor-shell";
import { isMedTechShellPath, medTechShellAccessRedirect } from "@/lib/auth/med-tech-shell";

/**
 * The route-level role matrix (COL-627, after the COL-615 role model).
 *
 * This is the SHELL layer only: what the proxy does when a signed-in role asks
 * for a route — let it through, send it to its own home, or send it to login.
 * A page may still refuse a role it lets through, and what a role can read is
 * decided by RLS (see supabase/tests/review_housekeeper_access.sql and friends).
 *
 * `scripts/homewood/rbac-matrix.json` is the reviewed copy the live verifier
 * (`npm run homewood:verify-rbac`) checks the deployed app against, and
 * `rbac-matrix.test.ts` fails if it drifts from these functions.
 */
export const RBAC_MATRIX_ROLES = ["owner", "facility_admin", "med_tech", "cook", "housekeeper", "recruiter", "family"] as const;

export type RbacMatrixRole = (typeof RBAC_MATRIX_ROLES)[number];

export const RBAC_MATRIX_ROUTES = [
  "/admin",
  "/admin/residents",
  "/admin/incidents",
  "/admin/staff",
  "/admin/finance",
  "/admin/payroll",
  "/admin/training",
  "/admin/transportation",
  "/admin/reputation",
  "/admin/referrals",
  "/admin/executive",
  "/caregiver",
  "/caregiver/tasks",
  "/caregiver/housekeeper",
  "/med-tech",
  "/floor",
  "/floor/lock",
  "/dietary",
  "/family",
] as const;

/** allow: served. redirect: sent to another in-app route. deny: sent to login. */
export type RbacOutcome = "allow" | "redirect" | "deny";

export type RbacCell = { outcome: RbacOutcome; location?: string };

function asUser(role: string) {
  return { app_metadata: { app_role: role } };
}

/** The proxy's shell decision for one role and route, in proxy.ts dispatch order. */
export function shellOutcome(role: string, route: string): RbacCell {
  const request = new NextRequest(`https://haven.test${route}`);
  const user = asUser(role);
  let response: Response | null = null;
  if (isAdminShellPath(route)) response = adminShellAccessRedirect(request, user);
  else if (isCaregiverShellPath(route)) response = caregiverShellAccessRedirect(request, user);
  else if (isDietaryShellPath(route)) response = dietaryShellAccessRedirect(request, user);
  else if (isMedTechShellPath(route)) response = medTechShellAccessRedirect(request, user);
  else if (isFamilyShellPath(route)) response = familyShellAccessRedirect(request, user);
  else if (isFloorShellPath(route)) response = floorShellAccessRedirect(request, user);
  if (!response) return { outcome: "allow" };
  const location = response.headers.get("location") ?? "";
  const pathname = location ? new URL(location).pathname : "";
  if (pathname === "/login" || pathname === "/unauthorized") return { outcome: "deny", location: pathname };
  return { outcome: "redirect", location: pathname };
}

export function computeRbacMatrix(): Record<string, Record<RbacMatrixRole, RbacCell>> {
  const matrix: Record<string, Record<RbacMatrixRole, RbacCell>> = {};
  for (const route of RBAC_MATRIX_ROUTES) {
    matrix[route] = {} as Record<RbacMatrixRole, RbacCell>;
    for (const role of RBAC_MATRIX_ROLES) matrix[route][role] = shellOutcome(role, route);
  }
  return matrix;
}
