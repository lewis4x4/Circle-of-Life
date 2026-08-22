/**
 * Quiet Operator copy for the survey-readiness binder evidence strip.
 * Missing survey history names a real gap — never a silent blank or fabricated visit.
 */

export const SURVEY_BINDER_NO_SURVEY_HISTORY_COPY = "No survey history recorded.";

export type BinderLastSurveyFields = {
  date: string;
  type: string;
  result: string;
};

/** Last survey KPI line — posted visit fields or a named gap when none on record. */
export function formatBinderLastSurveyLine(
  lastSurvey: BinderLastSurveyFields | null | undefined,
): string {
  if (!lastSurvey) return SURVEY_BINDER_NO_SURVEY_HISTORY_COPY;
  const type = lastSurvey.type.replace(/_/g, " ");
  const result = lastSurvey.result.replace(/_/g, " ");
  return `${lastSurvey.date} · ${type} · ${result}`;
}
