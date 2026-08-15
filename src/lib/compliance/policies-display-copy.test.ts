import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
  formatCompliancePolicyPublishedDate,
} from "./policies-display-copy";

const EM_DASH = "—";

describe("formatCompliancePolicyPublishedDate", () => {
  it("names a missing publish date instead of an em dash", () => {
    expect(formatCompliancePolicyPublishedDate(null)).toBe(
      COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
    );
    expect(formatCompliancePolicyPublishedDate(undefined)).toBe(
      COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
    );
    expect(formatCompliancePolicyPublishedDate("")).toBe(
      COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
    );
    expect(formatCompliancePolicyPublishedDate("   ")).toBe(
      COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
    );
    expect(formatCompliancePolicyPublishedDate(null)).not.toBe(EM_DASH);
  });

  it("returns missing copy for unparseable values", () => {
    expect(formatCompliancePolicyPublishedDate("not-a-date")).toBe(
      COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
    );
    expect(formatCompliancePolicyPublishedDate("not-a-date")).not.toBe(EM_DASH);
  });

  it("formats date-only strings without calendar-day shift", () => {
    expect(formatCompliancePolicyPublishedDate("2026-03-15")).toBe("Mar 15, 2026");
  });

  it("formats a full ISO timestamp", () => {
    expect(formatCompliancePolicyPublishedDate("2026-03-15T18:45:00.000Z")).toBe(
      "Mar 15, 2026",
    );
  });
});
