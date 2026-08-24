import { describe, expect, it } from "vitest";

import {
  INSURANCE_POLICY_DETAIL_NOT_FOUND_COPY,
  INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY,
  INSURANCE_POLICY_NO_EFFECTIVE_DATE_COPY,
  formatInsurancePolicyDetailEffectiveDate,
  formatInsurancePolicyDetailPeriodDate,
  resolveInsurancePolicyDetailLoadErrorMessage,
} from "./insurance-policy-detail-display-copy";

describe("resolveInsurancePolicyDetailLoadErrorMessage", () => {
  it("returns null when the policy loaded successfully", () => {
    expect(
      resolveInsurancePolicyDetailLoadErrorMessage({
        queryFailed: false,
        policyFound: true,
      }),
    ).toBeNull();
  });

  it("names a missing policy without surfacing query throw strings", () => {
    expect(
      resolveInsurancePolicyDetailLoadErrorMessage({
        queryFailed: false,
        policyFound: false,
      }),
    ).toBe(INSURANCE_POLICY_DETAIL_NOT_FOUND_COPY);
  });

  it("uses the unexpected fetch copy for query failures", () => {
    expect(
      resolveInsurancePolicyDetailLoadErrorMessage({
        queryFailed: true,
        policyFound: false,
      }),
    ).toBe(INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY);
  });
});

describe("formatInsurancePolicyDetailEffectiveDate", () => {
  it("names a gap when the effective date is missing or invalid", () => {
    expect(formatInsurancePolicyDetailEffectiveDate(null)).toBe(INSURANCE_POLICY_NO_EFFECTIVE_DATE_COPY);
    expect(formatInsurancePolicyDetailEffectiveDate("not-a-date")).toBe(INSURANCE_POLICY_NO_EFFECTIVE_DATE_COPY);
  });

  it("formats a valid effective date", () => {
    expect(formatInsurancePolicyDetailEffectiveDate("2024-03-15")).toBe("Mar 15, 2024");
  });
});

describe("formatInsurancePolicyDetailPeriodDate", () => {
  it("formats allocation period boundaries", () => {
    expect(formatInsurancePolicyDetailPeriodDate("2024-06-01")).toBe("Jun 1, 2024");
  });
});
