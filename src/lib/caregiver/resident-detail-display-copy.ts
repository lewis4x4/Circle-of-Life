/**
 * Quiet Operator copy for caregiver resident quick profile metric pills.
 * Names real gaps — never fabricates acuity, mood, or other clinical values.
 */

const SILENT_PLACEHOLDER_DASH = "—";

export const CAREGIVER_RESIDENT_NO_ACUITY_COPY = "No acuity posted";
export const CAREGIVER_RESIDENT_NO_MOOD_COPY = "No mood posted";

function caregiverResidentMetricIsMissing(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return false;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === SILENT_PLACEHOLDER_DASH;
}

/** Acuity pill value — posted levels stay as posted; missing data names the gap. */
export function formatCaregiverResidentAcuity(
  value: string | number | null | undefined,
): string {
  if (caregiverResidentMetricIsMissing(value)) {
    return CAREGIVER_RESIDENT_NO_ACUITY_COPY;
  }
  if (typeof value === "number") return String(value);
  return value.trim();
}

/** Mood pill value — posted moods stay as posted; missing data names the gap. */
export function formatCaregiverResidentMood(value: string | null | undefined): string {
  if (caregiverResidentMetricIsMissing(value)) {
    return CAREGIVER_RESIDENT_NO_MOOD_COPY;
  }
  return value.trim();
}
