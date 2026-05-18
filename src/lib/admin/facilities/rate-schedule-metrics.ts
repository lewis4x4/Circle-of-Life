import { RATE_TYPES, type RateType } from "@/lib/admin/facilities/facility-constants";

/** Room & board monthly rate types — used for KPI "active rate" scope. */
export const FACILITY_ROOM_BOARD_RATE_TYPES = ["private_room", "semi_private_room"] as const;

export function isRoomBoardRateType(rateType: string): boolean {
  return (FACILITY_ROOM_BOARD_RATE_TYPES as readonly string[]).includes(rateType);
}

export function isAncillaryRateType(rateType: string): boolean {
  return RATE_TYPES.includes(rateType as RateType) && !isRoomBoardRateType(rateType);
}

export function facilityDateYmdInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Compare ISO date strings (YYYY-MM-DD). */
export function compareYmd(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isRateCurrentForYmd(
  effectiveFrom: string,
  effectiveTo: string | null,
  todayYmd: string,
): boolean {
  if (compareYmd(effectiveFrom, todayYmd) > 0) return false;
  if (effectiveTo == null || effectiveTo.trim() === "") return true;
  return compareYmd(effectiveTo, todayYmd) >= 0;
}

export function isRateScheduledFuture(effectiveFrom: string, todayYmd: string): boolean {
  return compareYmd(effectiveFrom, todayYmd) > 0;
}

export function isRateSuperseded(effectiveTo: string | null, todayYmd: string): boolean {
  if (effectiveTo == null || effectiveTo.trim() === "") return false;
  return compareYmd(effectiveTo, todayYmd) < 0;
}
