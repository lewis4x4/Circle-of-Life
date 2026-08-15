/**
 * Quiet Operator copy for compliance audit-export job surfaces.
 * Missing row counts name real gaps — never fabricate export facts.
 */

export const AUDIT_EXPORT_NO_ROW_COUNT_COPY = "No row count posted";

/** Row count — real zero stays `0`; null/undefined uses explicit missing copy. */
export function formatAuditExportRowCount(value: number | null | undefined): string | number {
  if (value == null) return AUDIT_EXPORT_NO_ROW_COUNT_COPY;
  return value;
}
