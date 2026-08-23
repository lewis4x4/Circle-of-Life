import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";

export type AuditTabDatePreset = "24h" | "7d" | "30d" | "90d" | "ytd" | "custom";

export function auditTabIsoToday(now: Date = new Date()): string {
  return todayFacilityDateIso(now);
}

/** Facility Eastern calendar presets for the audit log date-only filter. */
export function auditTabRangeFromPreset(
  key: Exclude<AuditTabDatePreset, "custom">,
  now: Date = new Date(),
): { from: string; to: string } {
  const to = todayFacilityDateIso(now);
  if (key === "24h") {
    return { from: addFacilityCalendarDays(to, -1), to };
  }
  if (key === "ytd") {
    return { from: `${to.slice(0, 4)}-01-01`, to };
  }
  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  return { from: addFacilityCalendarDays(to, -days), to };
}
