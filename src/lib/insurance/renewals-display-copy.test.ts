import { describe, expect, it } from "vitest";

import {
  formatInsuranceRenewalTargetDate,
  INSURANCE_RENEWAL_NO_DATE_COPY,
} from "./renewals-display-copy";

describe("formatInsuranceRenewalTargetDate", () => {
  it("returns explicit copy when target effective date is missing or blank", () => {
    expect(formatInsuranceRenewalTargetDate(null)).toBe(INSURANCE_RENEWAL_NO_DATE_COPY);
    expect(formatInsuranceRenewalTargetDate(undefined)).toBe(INSURANCE_RENEWAL_NO_DATE_COPY);
    expect(formatInsuranceRenewalTargetDate("")).toBe(INSURANCE_RENEWAL_NO_DATE_COPY);
    expect(formatInsuranceRenewalTargetDate("   ")).toBe(INSURANCE_RENEWAL_NO_DATE_COPY);
  });

  it("formats a date-only ISO value", () => {
    expect(formatInsuranceRenewalTargetDate("2024-06-01")).toBe("Jun 1, 2024");
  });

  it("formats a full ISO timestamp", () => {
    expect(formatInsuranceRenewalTargetDate("2024-06-01T08:30:00.000Z")).toBe("Jun 1, 2024");
  });
});
