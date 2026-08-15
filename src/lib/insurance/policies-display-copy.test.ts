import { describe, expect, it } from "vitest";

import {
  formatInsurancePolicyExpirationDate,
  INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY,
} from "./policies-display-copy";

describe("formatInsurancePolicyExpirationDate", () => {
  it("returns explicit copy when expiration date is missing or invalid", () => {
    expect(formatInsurancePolicyExpirationDate(null)).toBe(INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY);
    expect(formatInsurancePolicyExpirationDate(undefined)).toBe(INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY);
    expect(formatInsurancePolicyExpirationDate("")).toBe(INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY);
    expect(formatInsurancePolicyExpirationDate("not-a-date")).toBe(INSURANCE_POLICY_NO_EXPIRATION_DATE_COPY);
  });

  it("formats a date-only ISO value", () => {
    expect(formatInsurancePolicyExpirationDate("2024-03-15")).toBe("Mar 15, 2024");
  });

  it("formats a full ISO timestamp", () => {
    expect(formatInsurancePolicyExpirationDate("2024-03-15T08:30:00.000Z")).toBe("Mar 15, 2024");
  });
});
