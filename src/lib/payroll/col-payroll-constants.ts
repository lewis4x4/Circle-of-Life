/**
 * COL payroll / HR constants (handoff parity — not a substitute for vendor payroll rules).
 */

export const PAYROLL_FREQUENCY_WEEKLY = "weekly" as const;

export const PAID_HOLIDAYS = [
  "New Year's Day",
  "Memorial Day",
  "Independence Day",
  "Labor Day",
] as const;

export const PTO_DAYS_ADMIN = 10;
export const PTO_DAYS_LINE = 0;

export const BEREAVEMENT_HOURS_FT = 24;

export const FMLA_ELIGIBILITY_HOURS = 1250;

export const DPC_BENEFIT_LABEL = "Direct Primary Care (DPC) — enrollment optional";

export const HR_MAIN_PHONE = "386-339-1634";
