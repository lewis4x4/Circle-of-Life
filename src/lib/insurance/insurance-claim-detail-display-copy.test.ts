import { describe, expect, it } from "vitest";

import {
  INSURANCE_CLAIM_DETAIL_NOT_FOUND_COPY,
  INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY,
  formatInsuranceClaimDetailReportedAt,
  resolveInsuranceClaimDetailLoadErrorMessage,
} from "./insurance-claim-detail-display-copy";

describe("resolveInsuranceClaimDetailLoadErrorMessage", () => {
  it("returns null when the claim loaded successfully", () => {
    expect(
      resolveInsuranceClaimDetailLoadErrorMessage({
        queryFailed: false,
        claimFound: true,
      }),
    ).toBeNull();
  });

  it("names a missing claim without surfacing query throw strings", () => {
    expect(
      resolveInsuranceClaimDetailLoadErrorMessage({
        queryFailed: false,
        claimFound: false,
      }),
    ).toBe(INSURANCE_CLAIM_DETAIL_NOT_FOUND_COPY);
  });

  it("uses the unexpected fetch copy for query failures", () => {
    expect(
      resolveInsuranceClaimDetailLoadErrorMessage({
        queryFailed: true,
        claimFound: false,
      }),
    ).toBe(INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY);
  });
});

describe("formatInsuranceClaimDetailReportedAt", () => {
  it("formats reported timestamps in Eastern wall clock", () => {
    const formatted = formatInsuranceClaimDetailReportedAt("2024-03-15T14:30:00.000Z");
    expect(formatted).toMatch(/Mar 15/);
    expect(formatted).toMatch(/10:30/);
    expect(formatted).not.toBe("No reported date posted");
  });
});
