import { isOrgAdminAppRole } from "@/lib/auth/app-role";

export type ExecutiveCommandNav = {
  href: "/admin/executive" | "/admin/executive/standup";
  label: string;
};

export function canOpenExecutiveOverview(role: string): boolean {
  return isOrgAdminAppRole(role);
}

export function canOpenExecutiveStandup(role: string): boolean {
  return role === "facility_admin" || isOrgAdminAppRole(role);
}

/**
 * Sidebar Command item for Executive. Returns null when the role cannot open
 * any executive surface (redirect would look like a broken link).
 */
export function resolveExecutiveCommandNav(role: string): ExecutiveCommandNav | null {
  if (canOpenExecutiveOverview(role)) {
    return { href: "/admin/executive", label: "Executive summary" };
  }
  if (canOpenExecutiveStandup(role)) {
    return { href: "/admin/executive/standup", label: "Standup" };
  }
  return null;
}

export function canOpenExecutiveHubHref(role: string, href: string): boolean {
  if (href === "/admin/executive/standup" || href.startsWith("/admin/executive/standup/")) {
    return canOpenExecutiveStandup(role);
  }
  if (href === "/admin/executive" || href.startsWith("/admin/executive/")) {
    return canOpenExecutiveOverview(role);
  }
  return false;
}
