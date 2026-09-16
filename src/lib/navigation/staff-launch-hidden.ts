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
  note: string;
};

export const STAFF_LAUNCH_HIDDEN_NAV: readonly StaffLaunchHiddenNavItem[] = [
  {
    key: "discharge",
    pillar: "pipeline",
    menu: "Pipeline",
    label: "Medication reconciliation",
    href: "/admin/discharge",
    note: "Hold med rec until staff are ready for that workflow. Recording a discharge no longer depends on this route — that action lives on the resident record (COL-418), so hiding this does not strand a bed as occupied.",
  },
  {
    key: "med-tech",
    pillar: "clinical",
    menu: "Clinical",
    label: "Med-Tech cockpit",
    href: "/med-tech",
    note: "Hold the dedicated med-tech surface from the Clinical menu.",
  },
  {
    key: "medications",
    pillar: "clinical",
    menu: "Clinical",
    label: "Medications",
    href: "/admin/medications",
    note: "Hold medications from the Clinical menu.",
  },
  {
    key: "medication-errors",
    pillar: "clinical",
    menu: "Clinical",
    label: "Medication errors",
    href: "/admin/medications/errors",
    note: "Hold medication-error review from the Clinical menu.",
  },
  {
    key: "dietary",
    pillar: "clinical",
    menu: "Clinical",
    label: "Dietary & Nutrition",
    href: "/admin/dietary",
    note: "Hold dietary and nutrition from the Clinical menu.",
  },
  {
    key: "finance",
    pillar: "finance",
    menu: "Business",
    label: "Finance",
    href: "/admin/finance",
    note: "Moving finance to Front desk; keep Vendors & AP on Business.",
  },
  {
    key: "insurance",
    pillar: "finance",
    menu: "Business",
    label: "Insurance",
    href: "/admin/insurance",
    note: "Moving insurance to Front desk; keep Vendors & AP on Business.",
  },
] as const;

export const STAFF_LAUNCH_HIDDEN_NAV_KEYS = new Set(
  STAFF_LAUNCH_HIDDEN_NAV.map((item) => item.key),
);

/**
 * Hide a catalog key from staff menus unless it is the role's only
 * allowlisted item (broker → Insurance). Dedicated-role tools stay visible.
 */
export function isStaffLaunchHiddenKey(
  key: string,
  visibleItemKeys?: readonly string[],
): boolean {
  if (!STAFF_LAUNCH_HIDDEN_NAV_KEYS.has(key)) return false;
  if (visibleItemKeys?.length === 1 && visibleItemKeys[0] === key) return false;
  return true;
}

export function filterStaffLaunchHiddenItems<T extends { key: string }>(
  items: readonly T[],
  visibleItemKeys?: readonly string[],
): T[] {
  return items.filter((item) => !isStaffLaunchHiddenKey(item.key, visibleItemKeys));
}

export function staffLaunchHiddenInventory(): StaffLaunchHiddenNavItem[] {
  return [...STAFF_LAUNCH_HIDDEN_NAV];
}
