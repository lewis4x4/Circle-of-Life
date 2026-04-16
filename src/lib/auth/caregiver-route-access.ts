const HOUSEKEEPER_ALLOWED_PREFIXES = [
  "/caregiver/housekeeper",
  "/caregiver/clock",
  "/caregiver/schedules",
  "/caregiver/me",
  "/caregiver/policies",
  "/clock",
  "/me",
] as const;

export function isHousekeeperAllowedPath(pathname: string): boolean {
  return HOUSEKEEPER_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
