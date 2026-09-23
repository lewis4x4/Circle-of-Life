import { describe, expect, it } from "vitest";

import {
  COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY,
  compliancePolicyListCountLabel,
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

describe("compliancePolicyListCountLabel (COL-649)", () => {
  const base = { facilityReady: true, loading: false, error: null, count: 0 };

  it("shows no count without a facility or after a failed read", () => {
    expect(compliancePolicyListCountLabel({ ...base, facilityReady: false })).toBeNull();
    expect(compliancePolicyListCountLabel({ ...base, error: "403" })).toBeNull();
  });

  it("counts loaded policies", () => {
    expect(compliancePolicyListCountLabel(base)).toBe("0 shown");
    expect(compliancePolicyListCountLabel({ ...base, count: 3 })).toBe("3 shown");
    expect(compliancePolicyListCountLabel({ ...base, loading: true })).toBe("Loading…");
  });
});

describe("COMPLIANCE_POLICY_LIBRARY_EMPTY (COL-710)", () => {
  it("does not read as 'no policies' and points at the knowledge base", async () => {
    const { COMPLIANCE_POLICY_LIBRARY_EMPTY } = await import("./policies-display-copy");
    expect(COMPLIANCE_POLICY_LIBRARY_EMPTY.title).not.toBe("No policies");
    expect(COMPLIANCE_POLICY_LIBRARY_EMPTY.description).toMatch(/knowledge base/i);
    expect(COMPLIANCE_POLICY_LIBRARY_EMPTY.knowledgeBaseHref).toBe("/admin/knowledge/admin");
  });
});
