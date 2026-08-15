/**
 * Quiet Operator copy for the new assessment entry page
 * (`/admin/residents/[id]/assessments/new`).
 * Empty states name real gaps — never fabricate scores or risk labels.
 */

export const ASSESSMENT_NEW_NO_SCORE_COPY = "No score posted";

/** True when a live total was computed (null/undefined/NaN are gaps). Real zero counts. */
export function isPostedAssessmentScore(value: number | null | undefined): value is number {
  if (value == null) return false;
  if (typeof value === "number" && Number.isNaN(value)) return false;
  return true;
}

/** Live score strip — keeps real zeros; names a missing total. */
export function formatAssessmentLiveScore(total: number | null | undefined): string {
  if (!isPostedAssessmentScore(total)) return ASSESSMENT_NEW_NO_SCORE_COPY;
  return String(total);
}
