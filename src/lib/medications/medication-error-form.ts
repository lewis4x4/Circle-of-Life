/**
 * Medication error report form: option labels, validation and insert payload.
 *
 * Every classification (type, severity, shift) starts empty — a regulatory
 * record must not arrive pre-classified. Option values mirror the
 * medication_errors CHECK constraints (migration 037) and the shift_type enum.
 */

import type { Database } from "@/types/database";

export const MEDICATION_ERROR_TYPE_OPTIONS = [
  { value: "wrong_medication", label: "Wrong medication" },
  { value: "wrong_dose", label: "Wrong dose" },
  { value: "wrong_time", label: "Wrong time" },
  { value: "wrong_resident", label: "Wrong resident" },
  { value: "wrong_route", label: "Wrong route" },
  { value: "omission", label: "Omission (dose not given)" },
  { value: "unauthorized_medication", label: "Unauthorized medication" },
  { value: "documentation_error", label: "Documentation error" },
  { value: "other", label: "Other" },
] as const;

export const MEDICATION_ERROR_SEVERITY_OPTIONS = [
  { value: "near_miss", label: "Near miss — did not reach the resident" },
  { value: "no_harm", label: "Reached the resident — no harm" },
  { value: "minor_harm", label: "Minor harm" },
  { value: "moderate_harm", label: "Moderate harm" },
  { value: "severe_harm", label: "Severe harm" },
] as const;

export const MEDICATION_ERROR_SHIFT_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "custom", label: "Other / custom shift" },
] as const;

export const MEDICATION_ERROR_FACTOR_OPTIONS = [
  { value: "transcription", label: "Transcription" },
  { value: "communication", label: "Communication" },
  { value: "distraction", label: "Distraction" },
  { value: "staffing", label: "Staffing" },
  { value: "similar_packaging", label: "Similar packaging" },
  { value: "similar_names", label: "Similar names" },
  { value: "workflow_interruption", label: "Workflow interruption" },
] as const;

export type MedicationErrorType = (typeof MEDICATION_ERROR_TYPE_OPTIONS)[number]["value"];
export type MedicationErrorSeverity = (typeof MEDICATION_ERROR_SEVERITY_OPTIONS)[number]["value"];
export type MedicationErrorShift = (typeof MEDICATION_ERROR_SHIFT_OPTIONS)[number]["value"];

export type MedicationErrorFormState = {
  residentId: string;
  errorType: MedicationErrorType | "";
  severity: MedicationErrorSeverity | "";
  shift: MedicationErrorShift | "";
  description: string;
  immediateActions: string;
  contributingFactors: string[];
  physicianNotified: boolean;
};

export const EMPTY_MEDICATION_ERROR_FORM: MedicationErrorFormState = {
  residentId: "",
  errorType: "",
  severity: "",
  shift: "",
  description: "",
  immediateActions: "",
  contributingFactors: [],
  physicianNotified: false,
};

/** Names of the required fields still missing, in form order. Empty when the form can submit. */
export function missingMedicationErrorFields(form: MedicationErrorFormState): string[] {
  const missing: string[] = [];
  if (!form.residentId) missing.push("Resident");
  if (!form.errorType) missing.push("Error type");
  if (!form.severity) missing.push("Outcome");
  if (!form.shift) missing.push("Shift");
  if (!form.description.trim()) missing.push("What happened");
  if (!form.immediateActions.trim()) missing.push("Immediate actions");
  return missing;
}

type MedicationErrorInsert = Database["public"]["Tables"]["medication_errors"]["Insert"];

export function buildMedicationErrorInsert(
  form: MedicationErrorFormState,
  context: { facilityId: string; organizationId: string; userId: string; now?: Date },
): MedicationErrorInsert {
  const missing = missingMedicationErrorFields(form);
  if (missing.length > 0 || !form.errorType || !form.severity || !form.shift) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
  const now = context.now ?? new Date();
  return {
    resident_id: form.residentId,
    facility_id: context.facilityId,
    organization_id: context.organizationId,
    error_type: form.errorType,
    severity: form.severity,
    shift: form.shift,
    discovered_by: context.userId,
    created_by: context.userId,
    description: form.description.trim(),
    immediate_actions: form.immediateActions.trim(),
    contributing_factors: form.contributingFactors.length ? form.contributingFactors : null,
    physician_notified: form.physicianNotified,
    physician_notified_at: form.physicianNotified ? now.toISOString() : null,
  };
}
