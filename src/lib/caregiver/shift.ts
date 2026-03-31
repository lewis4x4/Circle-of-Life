import type { Database } from "@/types/database";

export type ShiftType = Database["public"]["Enums"]["shift_type"];

/** Infer facility-local shift bucket from wall clock (spec-aligned with admin dashboard). */
export function currentShiftForTimezone(timeZone: string): ShiftType {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const safeHour = Number.isNaN(hour) ? 12 : hour;
  if (safeHour >= 7 && safeHour < 15) return "day";
  if (safeHour >= 15 && safeHour < 23) return "evening";
  return "night";
}
