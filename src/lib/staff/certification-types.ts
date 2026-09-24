import { enumLabel } from "@/lib/display/enum-label";

/**
 * Certification types offered when recording a certification or a
 * requirement. `staff_certifications.certification_type` is free text; these
 * are the values the forms write, so a requirement for `bls_cpr` matches a
 * certification recorded as "BLS / CPR".
 */
export const CERT_TYPE_PRESETS = [
  { value: "bls_cpr", label: "BLS / CPR" },
  { value: "first_aid", label: "First aid" },
  { value: "cna", label: "CNA" },
  { value: "lpn", label: "LPN license" },
  { value: "rn", label: "RN license" },
  { value: "medication_administration", label: "Medication administration" },
  { value: "fire_safety", label: "Fire / safety training" },
  { value: "hipaa", label: "HIPAA / privacy" },
  { value: "dementia_care", label: "Dementia care" },
  { value: "other", label: "Other (describe in name)" },
] as const;

const PRESET_LABELS: Record<string, string> = Object.fromEntries(CERT_TYPE_PRESETS.map((t) => [t.value, t.label]));

export function certificationTypeLabel(type: string): string {
  return enumLabel(type, { overrides: PRESET_LABELS });
}
