/**
 * Quiet Operator copy for the observation plan editor resident combobox.
 * Missing acuity names the gap — never a silent em dash. Real zero stays "0".
 */

export const OBSERVATION_PLAN_NO_ACUITY_COPY = "No acuity posted";

/** Acuity value for display or search keywords — score, stripped level, or named gap. */
export function formatObservationPlanAcuityDisplay(
  acuityScore: number | null | undefined,
  acuityLevel: string | null | undefined,
): string {
  if (acuityScore != null) return Number(acuityScore).toLocaleString("en-US");
  if (acuityLevel) return acuityLevel.replace("level_", "");
  return OBSERVATION_PLAN_NO_ACUITY_COPY;
}

/** Combobox label segment — omits "Acuity" prefix when acuity is missing. */
export function formatObservationPlanAcuitySegment(
  acuityScore: number | null | undefined,
  acuityLevel: string | null | undefined,
): string {
  const display = formatObservationPlanAcuityDisplay(acuityScore, acuityLevel);
  if (display === OBSERVATION_PLAN_NO_ACUITY_COPY) return OBSERVATION_PLAN_NO_ACUITY_COPY;
  return `Acuity ${display}`;
}
