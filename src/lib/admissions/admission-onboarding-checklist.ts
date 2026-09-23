/**
 * Downstream onboarding checklist on an admission case. Each item is read
 * from a head count; a count that could not be read is `unknown`, never
 * "Missing" or "Complete" (COL-649).
 */
export type AdmissionOnboardingCounts = {
  carePlans: number | null;
  medications: number | null;
  payers: number | null;
  familyConsents: number | null;
};

export type AdmissionOnboardingItemState = "complete" | "missing" | "unknown";

export const ADMISSION_ONBOARDING_STATE_LABEL: Record<AdmissionOnboardingItemState, string> = {
  complete: "Complete",
  missing: "Missing",
  unknown: "Couldn't check",
};

export const EMPTY_ADMISSION_ONBOARDING_COUNTS: AdmissionOnboardingCounts = {
  carePlans: null,
  medications: null,
  payers: null,
  familyConsents: null,
};

function stateFor(count: number | null): AdmissionOnboardingItemState {
  if (count === null) return "unknown";
  return count > 0 ? "complete" : "missing";
}

export function admissionOnboardingChecklist(counts: AdmissionOnboardingCounts) {
  return [
    { key: "care_plan", label: "Care plan workspace has at least one plan", state: stateFor(counts.carePlans) },
    { key: "meds", label: "Medication profile exists", state: stateFor(counts.medications) },
    { key: "billing", label: "Resident payer is configured", state: stateFor(counts.payers) },
    { key: "family", label: "Family consent is on file", state: stateFor(counts.familyConsents) },
  ];
}
