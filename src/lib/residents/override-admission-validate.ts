import { isAfter, parseISO, startOfDay, subYears } from "date-fns";

/** Placeholder value for Radix Select until the user chooses explicitly. */
export const OVERRIDE_FORM_PICK = "__pick__";

export const OVERRIDE_BED_UNASSIGNED = "__bed_unassigned__";

export type OverrideAdmissionFields = {
  firstName: string;
  lastName: string;
  preferredName: string;
  dob: string;
  gender: string;
  status: string;
  acuity: string;
  admissionDate: string;
  isActive: boolean;
  bedId: string;
  overrideReason: string;
};

/**
 * Client-side validation for the administrative override resident intake form.
 * Keep messages short; field ids align with `OverrideAdmissionForm` state keys.
 */
export function validateOverrideAdmission(fields: OverrideAdmissionFields): Record<string, string> {
  const e: Record<string, string> = {};
  if (!fields.firstName.trim()) e.firstName = "Required.";
  if (!fields.lastName.trim()) e.lastName = "Required.";
  if (fields.preferredName.length > 60) e.preferredName = "Max 60 characters.";
  if (!fields.dob.trim()) e.dob = "Required.";
  if (fields.dob.trim()) {
    const d = parseISO(`${fields.dob.trim()}T12:00:00`);
    const maxDob = startOfDay(subYears(new Date(), 18));
    if (isAfter(startOfDay(d), maxDob)) {
      e.dob = "Residents must be 18 or older for assisted living intake.";
    }
  }
  if (fields.gender === OVERRIDE_FORM_PICK) e.gender = "Select a value.";
  if (fields.status === OVERRIDE_FORM_PICK) e.status = "Select a value.";
  if (fields.acuity === OVERRIDE_FORM_PICK) e.acuity = "Select a value.";
  if (!fields.admissionDate.trim()) e.admissionDate = "Required.";
  if (
    fields.isActive &&
    (fields.bedId === OVERRIDE_BED_UNASSIGNED || !fields.bedId)
  ) {
    e.bedId = "Select a bed when status is active (admitted).";
  }
  const reason = fields.overrideReason.trim();
  if (reason.length < 50) e.overrideReason = "Enter at least 50 characters.";
  if (reason.length > 500) e.overrideReason = "Maximum 500 characters.";
  return e;
}
