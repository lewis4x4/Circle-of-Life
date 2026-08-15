/**
 * Quiet Operator copy for GL period close (`/admin/finance/period-close`).
 * Missing close timestamps name real gaps — never fabricate dates.
 */

export const PERIOD_CLOSE_NO_CLOSED_AT_COPY = "No close date posted";

/** When a period was closed — posted timestamp as formatted local time, or explicit gap copy. */
export function formatPeriodClosedAt(closedAt: string | null | undefined): string {
  if (closedAt == null) return PERIOD_CLOSE_NO_CLOSED_AT_COPY;
  const trimmed = closedAt.trim();
  if (!trimmed || trimmed === "—") return PERIOD_CLOSE_NO_CLOSED_AT_COPY;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return PERIOD_CLOSE_NO_CLOSED_AT_COPY;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
