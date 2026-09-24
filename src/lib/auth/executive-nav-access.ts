import { isFacilityOperatorRole, isOrgAdminAppRole, isRecruiterRole } from "@/lib/auth/app-role";

export type ExecutiveCommandNav = {
  href: "/admin/executive" | "/admin/executive/standup";
  label: string;
};

export function canOpenExecutiveOverview(role: string): boolean {
  return isOrgAdminAppRole(role);
}

/** Weekly Stand Up: owners, org admins, and every facility operator title (COL-571). */
export function canOpenExecutiveStandup(role: string): boolean {
  return isFacilityOperatorRole(role) || isOrgAdminAppRole(role);
}

/**
 * The Stand Up page itself (/admin/stand-up): everyone who opens the weekly
 * Stand Up, plus recruiters, who attend and read the Thursday meeting (COL-752).
 */
export function canOpenStandUpPage(role: string): boolean {
  return canOpenExecutiveStandup(role) || isRecruiterRole(role);
}

/**
 * Sidebar Command item for Executive. Returns null when the role cannot open
 * any executive surface (redirect would look like a broken link).
 *
 * Facility operators (Administrator / Assistant Administrator / Manager) get no
 * Executive item at all: their Home is facility-scoped and Weekly Stand Up has
 * its own rail entry (COL-593). The standup hub stays reachable by URL.
 */
export function resolveExecutiveCommandNav(role: string): ExecutiveCommandNav | null {
  if (canOpenExecutiveOverview(role)) {
    return { href: "/admin/executive", label: "Executive summary" };
  }
  return null;
}

/** Command rail / palette items: remap or drop the Executive entry by role. */
export function applyExecutiveCommandNavToItems<
  T extends { key: string; href: string; label: string },
>(items: readonly T[], role: string | null, authLoading: boolean): T[] {
  return items.flatMap((item) => {
    if (item.key === "stand-up") return !authLoading && role && canOpenStandUpPage(role) ? [item] : [];
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
  if (href === "/admin/stand-up") return canOpenExecutiveStandup(role);
  if (href === "/admin/executive/standup" || href.startsWith("/admin/executive/standup/")) {
    return canOpenExecutiveStandup(role);
  }
  if (href === "/admin/executive" || href.startsWith("/admin/executive/")) {
    return canOpenExecutiveOverview(role);
  }
  return false;
}
