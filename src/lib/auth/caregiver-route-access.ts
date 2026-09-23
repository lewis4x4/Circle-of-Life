const HOUSEKEEPER_ALLOWED_PREFIXES = [
  "/caregiver/housekeeper",
  "/caregiver/clock",
  "/caregiver/schedules",
  "/caregiver/me",
  "/caregiver/policies",
  "/caregiver/acknowledgments",
  "/caregiver/shift-swaps",
  "/clock",
  "/me",
] as const;

export function isHousekeeperAllowedPath(pathname: string): boolean {
  return HOUSEKEEPER_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Floor pages that read only the signed-in user, not a staff record, so they
 * stay open while a login is waiting to be linked (COL-661).
 */
const STAFF_LINK_OPTIONAL_PREFIXES = ["/caregiver/acknowledgments", "/caregiver/policies"] as const;

export function isStaffLinkOptionalPath(pathname: string): boolean {
  return STAFF_LINK_OPTIONAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
