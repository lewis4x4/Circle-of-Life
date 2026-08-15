/**
 * Quiet Operator copy for the admin time records hub (`/admin/time-records`).
 * Missing clock-out and hours name real gaps — never fabricate punch facts.
 */

export const TIME_RECORDS_NO_CLOCK_OUT_COPY = "No clock-out posted";
export const TIME_RECORDS_NO_HOURS_COPY = "No hours posted";

function formatTimeRecordsDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Clock-out column — posted ISO datetime or explicit missing copy. */
export function formatTimeRecordsClockOut(clockOut: string | null | undefined): string {
  if (!clockOut || !clockOut.trim()) return TIME_RECORDS_NO_CLOCK_OUT_COPY;
  return formatTimeRecordsDateTime(clockOut);
}

/** Actual hours column — real zero stays `0.00`; null/undefined/NaN names the gap. */
export function formatTimeRecordsActualHours(h: number | null | undefined): string {
  if (h == null) return TIME_RECORDS_NO_HOURS_COPY;
  const n = typeof h === "number" ? h : Number(h);
  if (Number.isNaN(n)) return TIME_RECORDS_NO_HOURS_COPY;
  return n.toFixed(2);
}
