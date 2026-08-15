import { describe, expect, it } from "vitest";

import {
  formatInsuranceClaimDateOfLoss,
  formatInsuranceClaimNumber,
  formatInsuranceClaimReportedAt,
  INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY,
  INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY,
  INSURANCE_CLAIM_NO_REPORTED_AT_COPY,
} from "./claims-display-copy";

describe("formatInsuranceClaimNumber", () => {
  it("returns explicit copy when claim number is missing or blank", () => {
    expect(formatInsuranceClaimNumber(null)).toBe(INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY);
    expect(formatInsuranceClaimNumber(undefined)).toBe(INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY);
    expect(formatInsuranceClaimNumber("")).toBe(INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY);
    expect(formatInsuranceClaimNumber("   ")).toBe(INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY);
  });

  it("returns the posted claim number unchanged", () => {
    expect(formatInsuranceClaimNumber("GL-2024-001")).toBe("GL-2024-001");
  });
});

describe("formatInsuranceClaimDateOfLoss", () => {
  it("returns explicit copy when date of loss is missing or invalid", () => {
    expect(formatInsuranceClaimDateOfLoss(null)).toBe(INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY);
    expect(formatInsuranceClaimDateOfLoss(undefined)).toBe(INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY);
    expect(formatInsuranceClaimDateOfLoss("")).toBe(INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY);
    expect(formatInsuranceClaimDateOfLoss("not-a-date")).toBe(INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY);
  });

  it("formats a date-only ISO value", () => {
    expect(formatInsuranceClaimDateOfLoss("2024-03-15")).toBe("Mar 15, 2024");
  });

  it("formats a full ISO timestamp", () => {
    expect(formatInsuranceClaimDateOfLoss("2024-03-15T08:30:00.000Z")).toBe("Mar 15, 2024");
  });
});

describe("formatInsuranceClaimReportedAt", () => {
  it("returns explicit copy when reported timestamp is missing or invalid", () => {
    expect(formatInsuranceClaimReportedAt(null)).toBe(INSURANCE_CLAIM_NO_REPORTED_AT_COPY);
    expect(formatInsuranceClaimReportedAt(undefined)).toBe(INSURANCE_CLAIM_NO_REPORTED_AT_COPY);
    expect(formatInsuranceClaimReportedAt("")).toBe(INSURANCE_CLAIM_NO_REPORTED_AT_COPY);
    expect(formatInsuranceClaimReportedAt("not-a-date")).toBe(INSURANCE_CLAIM_NO_REPORTED_AT_COPY);
  });

  it("formats a valid reported timestamp", () => {
    const formatted = formatInsuranceClaimReportedAt("2024-03-15T14:30:00.000Z");
    expect(formatted).not.toBe(INSURANCE_CLAIM_NO_REPORTED_AT_COPY);
    expect(formatted).toMatch(/2024/);
  });
});
