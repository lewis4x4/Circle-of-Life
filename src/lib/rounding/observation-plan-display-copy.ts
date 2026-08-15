/**
 * Quiet Operator copy for the observation plan editor resident combobox.
 * Missing acuity names the gap — never a silent em dash. Real zero stays "0".
 * Missing resident names name the gap — never legacy "Unnamed resident" or fabricated names.
 */

export const OBSERVATION_PLAN_NO_ACUITY_COPY = "No acuity posted";
export const OBSERVATION_PLAN_NO_NAME_COPY = "No name posted";

const OBSERVATION_PLAN_PLACEHOLDER_RESIDENT_NAMES = new Set([
  "—",
  "unknown",
  "unknown resident",
  "unnamed",
  "unnamed resident",
]);

export type ObservationPlanResidentNameFields = {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
};

function isMissingObservationPlanResidentName(combined: string): boolean {
  const trimmed = combined.trim();
  if (trimmed.length === 0) return true;
  return OBSERVATION_PLAN_PLACEHOLDER_RESIDENT_NAMES.has(trimmed.toLowerCase());
}

function joinObservationPlanResidentName(fields: ObservationPlanResidentNameFields): string {
  const given = (fields.preferred_name ?? fields.first_name ?? "").trim();
  const last = (fields.last_name ?? "").trim();
  return [given, last].filter((part) => part.length > 0).join(" ");
}

/** Resident name for combobox labels — preferred-then-first plus last; blank/legacy → named gap. */
export function formatObservationPlanResidentName(
  fieldsOrJoined: ObservationPlanResidentNameFields | string | null | undefined,
): string {
  const combined =
    typeof fieldsOrJoined === "string"
      ? fieldsOrJoined.trim()
      : joinObservationPlanResidentName(fieldsOrJoined ?? {});

  if (isMissingObservationPlanResidentName(combined)) return OBSERVATION_PLAN_NO_NAME_COPY;
  return combined;
}

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
