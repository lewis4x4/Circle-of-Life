/**
 * Staff illness log form (`/admin/infection-control/staff-illness/new`):
 * option labels, validation and insert payload for `staff_illness_records`.
 *
 * Option values mirror the CHECK constraint in migration 038. Nothing is
 * pre-selected — illness type and absence dates start empty.
 */

import type { Database } from "@/types/database";

export type StaffIllnessType = Database["public"]["Tables"]["staff_illness_records"]["Row"]["illness_type"];

export const STAFF_ILLNESS_TYPE_OPTIONS: ReadonlyArray<{ value: StaffIllnessType; label: string }> = [
  { value: "respiratory", label: "Respiratory" },
  { value: "gi", label: "Gastrointestinal (GI)" },
  { value: "covid", label: "COVID-19" },
  { value: "influenza", label: "Influenza" },
  { value: "skin", label: "Skin" },
  { value: "other", label: "Other illness" },
  { value: "personal", label: "Personal (not reportable)" },
];

export const STAFF_ILLNESS_SYMPTOM_OPTIONS = [
  { value: "fever", label: "Fever" },
  { value: "cough", label: "Cough" },
  { value: "sore_throat", label: "Sore throat" },
  { value: "shortness_of_breath", label: "Shortness of breath" },
  { value: "vomiting", label: "Vomiting" },
  { value: "diarrhea", label: "Diarrhea" },
  { value: "rash", label: "Rash" },
] as const;

export type StaffIllnessFormState = {
  staffId: string;
  illnessType: StaffIllnessType | "";
  symptoms: string[];
  absentFrom: string;
  absentTo: string;
};

export const EMPTY_STAFF_ILLNESS_FORM: StaffIllnessFormState = {
  staffId: "",
  illnessType: "",
  symptoms: [],
  absentFrom: "",
  absentTo: "",
};

/** Human messages for what still blocks submit, in form order. Empty when the form can submit. */
export function staffIllnessFormProblems(form: StaffIllnessFormState): string[] {
  const problems: string[] = [];
  if (!form.staffId) problems.push("Choose the staff member");
  if (!form.illnessType) problems.push("Choose the illness type");
  if (!form.absentFrom) problems.push("Enter the first day absent");
  if (form.absentFrom && form.absentTo && form.absentTo < form.absentFrom) {
    problems.push("Return date cannot be before the first day absent");
  }
  return problems;
}

type StaffIllnessInsert = Database["public"]["Tables"]["staff_illness_records"]["Insert"];

export function buildStaffIllnessInsert(
  form: StaffIllnessFormState,
  context: { facilityId: string; organizationId: string; userId: string; reportedDate: string },
): StaffIllnessInsert {
  const problems = staffIllnessFormProblems(form);
  if (problems.length > 0 || !form.illnessType) {
    throw new Error(problems.join("; "));
  }
  return {
    staff_id: form.staffId,
    facility_id: context.facilityId,
    organization_id: context.organizationId,
    reported_date: context.reportedDate,
    illness_type: form.illnessType,
    symptoms: form.symptoms.length ? form.symptoms : null,
    absent_from: form.absentFrom,
    absent_to: form.absentTo || null,
    created_by: context.userId,
  };
}
