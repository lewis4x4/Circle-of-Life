/**
 * Quiet Operator copy for the survey print pack chooser.
 * Building label names the facility when posted — never says "the selected facility".
 */

export const SURVEY_PACK_NO_FACILITY_NAME_COPY = "No facility name posted";

/** Building label above the print-pack range chooser. */
export function formatSurveyPackBuildingName(
  name: string | null | undefined,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return SURVEY_PACK_NO_FACILITY_NAME_COPY;
}
