/**
 * Quiet Operator copy for the admin time records hub (`/admin/time-records`).
 * Missing clock-out and hours name real gaps — never fabricate punch facts.
 */
import { formatShortDateTime } from "@/lib/format/datetime";


export const TIME_RECORDS_NO_CLOCK_OUT_COPY = "No clock-out posted";
export const TIME_RECORDS_NO_HOURS_COPY = "No hours posted";
export const TIME_RECORDS_NO_STAFF_COPY = "No staff posted";

function formatTimeRecordsDateTime(iso: string): string {
  return formatShortDateTime(iso, { fallback: iso });
}

/** Clock-out column — posted ISO datetime or explicit missing copy. */
export function formatTimeRecordsClockOut(clockOut: string | null | undefined): string {
  if (!clockOut || !clockOut.trim()) return TIME_RECORDS_NO_CLOCK_OUT_COPY;
  return formatTimeRecordsDateTime(clockOut);
}

/** Staff name on a time record row or CSV export when the join is unset or blank. */
export function formatTimeRecordStaffName(name: string | null | undefined): string {
  if (!name) return TIME_RECORDS_NO_STAFF_COPY;
  const trimmed = name.trim();
  if (!trimmed) return TIME_RECORDS_NO_STAFF_COPY;
  return trimmed;
}

/** Actual hours column — real zero stays `0.00`; null/undefined/NaN names the gap. */
export function formatTimeRecordsActualHours(h: number | null | undefined): string {
  if (h == null) return TIME_RECORDS_NO_HOURS_COPY;
  const n = typeof h === "number" ? h : Number(h);
  if (Number.isNaN(n)) return TIME_RECORDS_NO_HOURS_COPY;
  return n.toFixed(2);
}
