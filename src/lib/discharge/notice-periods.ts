/** Includes migration 142 enum values + legacy reasons. */
export type HandoffDischargeReason =
  | "resident_voluntary"
  | "facility_with_cause"
  | "facility_immediate"
  | "medicaid_relocation"
  | "higher_level_of_care"
  | "hospital_permanent"
  | "another_alf"
  | "home"
  | "death"
  | "non_payment"
  | "behavioral"
  | "other";

/** Notice periods in days by discharge category (handoff defaults). */
export const NOTICE_PERIOD_DAYS: Record<HandoffDischargeReason, number | null> = {
  resident_voluntary: 30,
  facility_with_cause: 45,
  facility_immediate: 0,
  medicaid_relocation: 0,
  higher_level_of_care: 30,
  hospital_permanent: 30,
  another_alf: 30,
  home: 30,
  death: null,
  non_payment: 45,
  behavioral: 45,
  other: 30,
};
