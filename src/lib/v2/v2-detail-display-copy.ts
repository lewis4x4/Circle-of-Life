/**
 * Quiet Operator copy for v2 detail identifier fields when values are absent.
 * Copy reflects real data gaps — never fabricates clinical or metric values.
 */

export const V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY = "No diagnosis posted";
export const V2_DETAIL_NO_SEVERITY_POSTED_COPY = "No severity posted";
export const V2_DETAIL_NO_CATEGORY_POSTED_COPY = "No category posted";
export const V2_DETAIL_NO_METRIC_POSTED_COPY = "No metric posted";
export const V2_DETAIL_NO_DATE_POSTED_COPY = "No date posted";

function isBlankString(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === "";
}

function formatPostedStringOrGap(
  value: string | null | undefined,
  gapCopy: string,
): string {
  if (isBlankString(value)) return gapCopy;
  return String(value).trim();
}

/** Resident primary diagnosis — trimmed when posted; explicit gap copy when missing. */
export function formatV2DetailDiagnosis(value: string | null | undefined): string {
  return formatPostedStringOrGap(value, V2_DETAIL_NO_DIAGNOSIS_POSTED_COPY);
}

/** Incident or alert severity — trimmed when posted; explicit gap copy when missing. */
export function formatV2DetailSeverity(value: string | null | undefined): string {
  return formatPostedStringOrGap(value, V2_DETAIL_NO_SEVERITY_POSTED_COPY);
}

/** Incident or alert category — trimmed when posted; explicit gap copy when missing. */
export function formatV2DetailCategory(value: string | null | undefined): string {
  return formatPostedStringOrGap(value, V2_DETAIL_NO_CATEGORY_POSTED_COPY);
}

/** Alert source metric code — trimmed when posted; explicit gap copy when missing. */
export function formatV2DetailSourceMetric(value: string | null | undefined): string {
  return formatPostedStringOrGap(value, V2_DETAIL_NO_METRIC_POSTED_COPY);
}

/**
 * v2 detail identifier dates (discharge, updated, occurred, first triggered, etc.).
 * Date-only YMD stays as-is; timestamps use ISO slice through minutes with a space separator.
 */
export function formatV2DetailDate(value: unknown): string {
  if (value == null) return V2_DETAIL_NO_DATE_POSTED_COPY;
  const s = String(value).trim();
  if (!s || s === "—") return V2_DETAIL_NO_DATE_POSTED_COPY;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`);
    if (Number.isNaN(d.getTime())) return V2_DETAIL_NO_DATE_POSTED_COPY;
    return s;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return V2_DETAIL_NO_DATE_POSTED_COPY;
  return d.toISOString().slice(0, 16).replace("T", " ");
}
