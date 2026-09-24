/**
 * Temporary staff-launch menu hides.
 *
 * Modules stay in the repo and remain reachable by direct URL. These keys
 * are only removed from operator menus (left rail, pillar tabs, ⌘K, and the
 * all-sections jump list) so the first staff rollout stays smaller.
 *
 * Add rows here as Brian names the next hold-offs. Do not delete routes.
 * Restore by removing the row.
 */

export type StaffLaunchHiddenPillar = "pipeline" | "clinical" | "finance";

export type StaffLaunchHiddenNavItem = {
  key: string;
  pillar: StaffLaunchHiddenPillar;
  /** Top-bar label the item lived under */
  menu: string;
  /** Left-rail / jump-list label */
  label: string;
  href: string;
  /** App roles the hold has been lifted for; everyone else still has it hidden. */
  releasedToRoles?: readonly string[];
};

/** Owner and admin roles (org and facility) — Brian's 2026-09-23 ruling on Finance and Insurance. */
const OWNER_AND_ADMIN_ROLES = ["owner", "org_admin", "facility_admin", "manager"] as const;

export const STAFF_LAUNCH_HIDDEN_NAV: readonly StaffLaunchHiddenNavItem[] = [
  // Hold med rec until staff are ready for that workflow. Recording a discharge no longer
  // depends on this route — that action lives on the resident record (COL-418), so hiding
  // this does not strand a bed as occupied.
  {
    key: "discharge",
    pillar: "pipeline",
    menu: "Pipeline",
    label: "Medication reconciliation",
    href: "/admin/discharge",
  },
  // Hold the dedicated med-tech surface from the Clinical menu.
  {
    key: "med-tech",
    pillar: "clinical",
    menu: "Clinical",
    label: "Med-Tech cockpit",
    href: "/med-tech",
  },
  // Hold medications from the Clinical menu.
  {
    key: "medications",
    pillar: "clinical",
    menu: "Clinical",
    label: "Medications",
    href: "/admin/medications",
  },
  // Hold medication-error review from the Clinical menu.
  {
    key: "medication-errors",
    pillar: "clinical",
    menu: "Clinical",
    label: "Medication errors",
    href: "/admin/medications/errors",
  },
  // Hold dietary and nutrition from the Clinical menu.
  {
    key: "dietary",
    pillar: "clinical",
    menu: "Clinical",
    label: "Dietary & Nutrition",
    href: "/admin/dietary",
  },
  // Moving finance to Front desk; keep Vendors & AP on Business. Released to
  // owners and admins 2026-09-23 (Brian, COL-655).
  {
    key: "finance",
    pillar: "finance",
    menu: "Business",
    label: "Finance",
    href: "/admin/finance",
    releasedToRoles: OWNER_AND_ADMIN_ROLES,
  },
  // Moving insurance to Front desk; keep Vendors & AP on Business. Released to
  // owners and admins 2026-09-23 (Brian, COL-655).
  {
    key: "insurance",
    pillar: "finance",
    menu: "Business",
    label: "Insurance",
    href: "/admin/insurance",
    releasedToRoles: OWNER_AND_ADMIN_ROLES,
  },
] as const;

export const STAFF_LAUNCH_HIDDEN_NAV_KEYS = new Set(
  STAFF_LAUNCH_HIDDEN_NAV.map((item) => item.key),
);

/**
 * Hide a catalog key from staff menus unless it is the role's only
 * allowlisted item (broker → Insurance) or the hold has been lifted for the
 * role. Dedicated-role tools stay visible.
 */
export function isStaffLaunchHiddenKey(
  key: string,
  visibleItemKeys?: readonly string[],
  role?: string | null,
): boolean {
  const hold = STAFF_LAUNCH_HIDDEN_NAV.find((item) => item.key === key);
  if (!hold) return false;
  if (visibleItemKeys?.length === 1 && visibleItemKeys[0] === key) return false;
  if (role && hold.releasedToRoles?.includes(role)) return false;
  return true;
}

export function filterStaffLaunchHiddenItems<T extends { key: string }>(
  items: readonly T[],
  visibleItemKeys?: readonly string[],
  role?: string | null,
): T[] {
  return items.filter((item) => !isStaffLaunchHiddenKey(item.key, visibleItemKeys, role));
}

export function staffLaunchHiddenInventory(): StaffLaunchHiddenNavItem[] {
  return [...STAFF_LAUNCH_HIDDEN_NAV];
}
