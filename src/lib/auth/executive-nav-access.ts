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

/** Command rail / palette items: remap or drop the Executive entry by role. */
export function applyExecutiveCommandNavToItems<
  T extends { key: string; href: string; label: string },
>(items: readonly T[], role: string | null, authLoading: boolean): T[] {
  return items.flatMap((item) => {
    if (item.key !== "executive") return [item];
    if (authLoading || !role) return [];
    const resolved = resolveExecutiveCommandNav(role);
    if (!resolved) return [];
    return [
      {
        ...item,
        href: resolved.href,
        label: resolved.href === "/admin/executive/standup" ? resolved.label : item.label,
      },
    ];
  });
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
