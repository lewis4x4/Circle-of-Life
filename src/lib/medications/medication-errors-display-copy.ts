/**
 * Quiet Operator copy for medication error reporting surfaces.
 * Missing review timestamps name real gaps — never fabricate review facts.
 */

export const MEDICATION_ERRORS_NO_REVIEW_TIME_COPY = "No review time posted";
export const MEDICATION_ERRORS_NO_SEVERITY_IN_VIEW_COPY = "No severity breakdown in view";

/** Reviewed-at column — posted ISO datetime or explicit missing copy. */
export function formatMedicationErrorReviewedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return MEDICATION_ERRORS_NO_REVIEW_TIME_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MEDICATION_ERRORS_NO_REVIEW_TIME_COPY;
  return d.toLocaleString();
}

/** Severity breakdown strip — joined counts when present, named gap when empty. */
export function formatMedicationErrorsSeverityInView(bySeverity: Record<string, number>): string {
  const entries = Object.entries(bySeverity);
  if (entries.length === 0) return MEDICATION_ERRORS_NO_SEVERITY_IN_VIEW_COPY;
  return entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
}
