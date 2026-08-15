/**
 * Quiet Operator copy for the discharge med reconciliation detail page.
 * Missing or legacy placeholder timestamps name real gaps — never fabricate dates.
 */

export const DISCHARGE_DETAIL_NO_DATE_COPY = "No date posted";

const DISCHARGE_DETAIL_PLACEHOLDER_TIMESTAMP_VALUES = new Set(["—", "unknown"]);

function parseDischargeDetailTimestamp(iso: string | null | undefined): Date | null {
  const trimmed = (iso ?? "").trim();
  if (!trimmed) return null;
  if (DISCHARGE_DETAIL_PLACEHOLDER_TIMESTAMP_VALUES.has(trimmed.toLowerCase())) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Detail-page timestamp — toLocaleString when posted; named gap otherwise. */
export function formatDischargeDetailTimestamp(iso: string | null | undefined): string {
  const parsed = parseDischargeDetailTimestamp(iso);
  if (!parsed) return DISCHARGE_DETAIL_NO_DATE_COPY;
  return parsed.toLocaleString();
}
