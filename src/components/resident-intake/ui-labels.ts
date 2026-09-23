
import { enumLabel } from "@/lib/display/enum-label";export const RESIDENT_DOCUMENT_TYPES = [
  ["demographics_face_sheet", "Demographics / face sheet"],
  ["form_1823", "AHCA Form 1823"],
  ["photo_identification", "Photo identification"],
  ["insurance_card", "Insurance card"],
  ["prescription_benefit_card", "Prescription benefit card"],
  ["physician_orders_medication_list", "Physician orders / medication list"],
  ["advance_directive", "Advance directive"],
  ["authority_instrument", "Authority instrument"],
  ["admission_agreement", "Admission agreement"],
  ["financial_agreement", "Financial agreement"],
  ["arbitration", "Arbitration agreement"],
  ["resident_rights", "Resident rights"],
  ["hipaa_privacy", "HIPAA / privacy"],
  ["photo_release", "Photo release"],
  ["secured_environment_acknowledgment", "Secured-environment acknowledgment"],
  ["medication_assistance_consent", "Medication-assistance consent"],
  ["behavioral_health_consent_referral", "Behavioral-health consent / referral"],
  ["provider_enrollment_consent", "Provider enrollment / consent"],
  ["resident_screening", "Resident screening"],
  ["dietary_evaluation", "Dietary evaluation"],
  ["tb_screening", "TB screening"],
  ["care_plan_service_plan_acknowledgment", "Care-plan / service-plan acknowledgment"],
  ["other_resident_evidence", "Other resident evidence"],
] as const;

export const SOURCE_CLASSIFICATIONS = [
  ["resident", "Resident document"],
  ["facility", "Facility document"],
  ["employee", "Employee document"],
  ["other_resident", "Another resident"],
  ["credential_secret", "Credential or secret"],
  ["unreadable", "Unreadable or unsupported"],
  ["unsupported", "Unsupported file"],
] as const;

export function humanizeToken(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return "Not reviewed";
  return enumLabel(text, { case: "title" });
}
