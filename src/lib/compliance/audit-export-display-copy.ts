/**
 * Quiet Operator copy for compliance audit-export job surfaces.
 * Missing row counts, date ranges, and job lists name real gaps — never fabricate export facts.
 */

export const AUDIT_EXPORT_LOADING_PROFILE_COPY = "Loading profile…";
export const AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY = "Waiting for profile…";
export const AUDIT_EXPORT_LOADING_JOBS_COPY = "Loading export jobs…";
export const AUDIT_EXPORT_NO_JOBS_COPY = "No export jobs yet.";
export const AUDIT_EXPORT_NO_ROW_COUNT_COPY = "No row count posted";
export const AUDIT_EXPORT_OPEN_DATE_RANGE_COPY = "All dates";

/** Row count — real zero stays `0`; null/undefined uses explicit missing copy. */
export function formatAuditExportRowCount(value: number | null | undefined): string | number {
  if (value == null) return AUDIT_EXPORT_NO_ROW_COUNT_COPY;
  return value;
}

/** Job table range column — open filter uses named copy instead of silent ellipses. */
export function formatAuditExportJobDateRange(
  dateFrom: string | null,
  dateTo: string | null,
): string {
  if (!dateFrom && !dateTo) return AUDIT_EXPORT_OPEN_DATE_RANGE_COPY;
  return `${dateFrom ?? "…"} → ${dateTo ?? "…"}`;
}
