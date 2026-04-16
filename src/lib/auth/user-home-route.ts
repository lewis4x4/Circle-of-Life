import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";

type ClaimsUser = Parameters<typeof getAppRoleFromClaims>[0];

export function getDashboardRouteForUser(user: ClaimsUser, fallback: string): string {
  const role = getAppRoleFromClaims(user);
  return role ? getDashboardRouteForRole(role) : fallback;
}
