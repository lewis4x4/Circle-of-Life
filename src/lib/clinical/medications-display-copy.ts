/**
 * Quiet Operator copy for resident medication lists (`/admin/residents/[id]/medications`).
 * Missing strength and prescriber name real gaps — never fabricate clinical values.
 */

export const MEDICATIONS_NO_STRENGTH_COPY = "No strength posted";
export const MEDICATIONS_NO_PRESCRIBER_COPY = "No prescriber posted";
export const MEDICATIONS_NO_NAME_COPY = "No medication name posted";

function isMissingMedicationField(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return !trimmed || trimmed === "—";
}

/** Medication strength on a resident med row when unset, blank, or a lone em dash. */
export function formatMedicationStrength(strength: string | null | undefined): string {
  if (isMissingMedicationField(strength)) return MEDICATIONS_NO_STRENGTH_COPY;
  return strength!.trim();
}

/** Prescriber name on a resident med row when unset, blank, or a lone em dash. */
export function formatMedicationPrescriber(prescriberName: string | null | undefined): string {
  if (isMissingMedicationField(prescriberName)) return MEDICATIONS_NO_PRESCRIBER_COPY;
  return prescriberName!.trim();
}

/** Medication name on a count or med row when unset, blank, or a lone em dash. */
export function formatMedicationName(medicationName: string | null | undefined): string {
  if (isMissingMedicationField(medicationName)) return MEDICATIONS_NO_NAME_COPY;
  return medicationName!.trim();
}
