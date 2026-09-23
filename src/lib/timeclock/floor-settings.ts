/**
 * Floor tablet settings for the facility Timeclock tab (COL-690, spec 40 §1, §3).
 * Client-safe. The database is the authority: migration 483's
 * `haven.floor_roster_roles_valid` refuses any role outside current staff login
 * roles, and these lists only keep the form from offering one it would refuse.
 */

import { FLOOR_ROSTER_ELIGIBLE_ROLES, ROLE_LABELS } from "@/lib/rbac";

export const DEVICE_KINDS = ["kiosk", "floor"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === "string" && (DEVICE_KINDS as readonly string[]).includes(value);
}

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  kiosk: "Front-door kiosk",
  floor: "Floor tablet",
};

/** Where the enrollment code is typed on the tablet, by kind. */
export const DEVICE_KIND_SETUP_PATHS: Record<DeviceKind, string> = {
  kiosk: "/kiosk/setup",
  floor: "/floor/setup",
};

export const FLOOR_ROSTER_ROLE_OPTIONS: readonly { value: string; label: string }[] = FLOOR_ROSTER_ELIGIBLE_ROLES
  .map((role) => ({ value: role, label: ROLE_LABELS[role] ?? role }));

const ROSTER_ROLE_VALUES: ReadonlySet<string> = new Set(FLOOR_ROSTER_ROLE_OPTIONS.map((option) => option.value));

export const FLOOR_IDLE_LOCK_MIN = 1;
export const FLOOR_IDLE_LOCK_MAX = 30;

/** Column defaults in migration 483, shown before a facility has a settings row. */
export const FLOOR_SETTINGS_DEFAULTS = { idle_lock_minutes: 3, roster_roles: ["med_tech", "facility_admin"] } as const;

export type FloorSettings = { idle_lock_minutes: number; roster_roles: string[] };

export function isValidIdleLockMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= FLOOR_IDLE_LOCK_MIN && value <= FLOOR_IDLE_LOCK_MAX;
}

/** 1 to 20 distinct roster roles, each one the form offers. */
export function isValidRosterRoles(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  if (new Set(value).size !== value.length) return false;
  return value.every((role) => typeof role === "string" && ROSTER_ROLE_VALUES.has(role));
}

export function rosterRolesLabel(roles: readonly string[]): string {
  return roles.map((role) => ROLE_LABELS[role] ?? role).join(", ");
}
