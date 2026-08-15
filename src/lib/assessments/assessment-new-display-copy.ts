/**
 * Quiet Operator copy for the new assessment entry page
 * (`/admin/residents/[id]/assessments/new`).
 * Empty states name real gaps — never fabricate scores or risk labels.
 */

export const ASSESSMENT_NEW_NO_SCORE_COPY = "No score posted";
export const ASSESSMENT_NEW_NO_RISK_COPY = "No risk posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

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

/** True when a risk level was posted (null/undefined/blank/em dash are gaps). */
export function isPostedAssessmentRiskLevel(value: string | null | undefined): value is string {
  return !isBlankOrEmDash(value);
}

/** Risk level label for lists — names a missing level; posted values keep underscore spacing. */
export function formatAssessmentRiskLevelLabel(riskLevel: string | null | undefined): string {
  if (!isPostedAssessmentRiskLevel(riskLevel)) return ASSESSMENT_NEW_NO_RISK_COPY;
  return riskLevel.replace(/_/g, " ");
}
