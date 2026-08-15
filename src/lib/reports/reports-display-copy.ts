/**
 * Quiet Operator copy for reports hub surfaces.
 * Missing run timestamps name real gaps — never fabricate report facts.
 */

export const REPORTS_NO_COMPLETE_TIME_COPY = "No complete time posted";
export const REPORTS_NO_NEXT_RUN_COPY = "No next run posted";

/** When a report run completed — never invents a timestamp. */
export function formatReportRunCompletedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return REPORTS_NO_COMPLETE_TIME_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return REPORTS_NO_COMPLETE_TIME_COPY;
  return d.toLocaleString();
}

/** Next scheduled dispatch time — never invents a run time. */
export function formatReportScheduleNextRunAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return REPORTS_NO_NEXT_RUN_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return REPORTS_NO_NEXT_RUN_COPY;
  return d.toLocaleString();
}
