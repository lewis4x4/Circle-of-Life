import { describe, expect, it } from "vitest";

import {
  formatInsuranceRenewalTargetDate,
  INSURANCE_RENEWAL_NO_DATE_COPY,
  INSURANCE_RENEWAL_NO_ENTITY_COPY,
  INSURANCE_RENEWAL_NO_POLICY_COPY,
  insuranceRenewalScope,
  insuranceRenewalSubject,
  type InsuranceRenewalSubject,
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

describe("insuranceRenewalSubject / insuranceRenewalScope (COL-527)", () => {
  const row = (over: Partial<InsuranceRenewalSubject> = {}): InsuranceRenewalSubject => ({
    insurance_policies: { policy_number: "NSC101045", carrier_name: "National Fire & Marine", policy_type: "general_liability" },
    entities: { name: "Grande Cypress ALF LLC" },
    ...over,
  });

  it("names the line, the policy number and the carrier", () => {
    expect(insuranceRenewalSubject(row())).toBe("General liability — NSC101045 · National Fire & Marine");
  });

  it("distinguishes the two workers comp programmes that used to look identical", () => {
    const technology = insuranceRenewalSubject(
      row({ insurance_policies: { policy_number: "WC 99 00 01 B", carrier_name: "Technology Insurance Company, Inc.", policy_type: "workers_comp" } }),
    );
    const normandy = insuranceRenewalSubject(
      row({ insurance_policies: { policy_number: "NHFL0200092025", carrier_name: "Normandy Insurance Company", policy_type: "workers_comp" } }),
    );
    expect(technology).toBe("Workers comp — WC 99 00 01 B · Technology Insurance Company, Inc.");
    expect(normandy).toBe("Workers comp — NHFL0200092025 · Normandy Insurance Company");
    expect(technology).not.toBe(normandy);
  });

  it("falls back to the number alone when the line is missing", () => {
    expect(
      insuranceRenewalSubject(row({ insurance_policies: { policy_number: "X-1", carrier_name: null, policy_type: null } })),
    ).toBe("X-1");
  });

  it("names the gap rather than guessing when no policy is joined", () => {
    expect(insuranceRenewalSubject(row({ insurance_policies: null }))).toBe(INSURANCE_RENEWAL_NO_POLICY_COPY);
  });

  it("treats a blank policy number as no policy", () => {
    expect(
      insuranceRenewalSubject(row({ insurance_policies: { policy_number: "   ", carrier_name: "Anyone", policy_type: "auto" } })),
    ).toBe(INSURANCE_RENEWAL_NO_POLICY_COPY);
  });

  it("names the entity, and names its absence", () => {
    expect(insuranceRenewalScope(row())).toBe("Grande Cypress ALF LLC");
    expect(insuranceRenewalScope(row({ entities: null }))).toBe(INSURANCE_RENEWAL_NO_ENTITY_COPY);
    expect(insuranceRenewalScope(row({ entities: { name: "  " } }))).toBe(INSURANCE_RENEWAL_NO_ENTITY_COPY);
  });
});
