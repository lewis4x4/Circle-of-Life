import { describe, expect, it } from "vitest";

import type { ResidentTrustRow } from "./load-trust-data";
import { TRUST_NO_RECORDS_COPY, describeTrustSummary } from "./trust-summary-display";

const row = (over: Partial<ResidentTrustRow> = {}): ResidentTrustRow => ({
  residentId: "r1",
  residentName: "A",
  currentBalanceCents: 12_500,
  legacyBalanceCents: null,
  legacyReviewRequired: false,
  ledgerMatchesBalance: true,
  facilityId: "f1",
  lastEntryDate: null,
  entriesCount: 1,
  ...over,
});

describe("describeTrustSummary (COL-649)", () => {
  it("does not present $0.00 / 0 / 0 when there are no resident-money records", () => {
    const s = describeTrustSummary([], null);
    expect(s.recordedFunds).toBe(TRUST_NO_RECORDS_COPY);
    expect(s.legacyReview).toBe(TRUST_NO_RECORDS_COPY);
    expect(s.ledgerDifferences).toBe(TRUST_NO_RECORDS_COPY);
    expect(s.ledgerDifferencesCount).toBeNull();
  });

  it("says Unavailable when the read failed", () => {
    expect(describeTrustSummary([], "boom").recordedFunds).toBe("Unavailable");
  });

  it("totals real records and keeps real zeros", () => {
    const s = describeTrustSummary([row()], null);
    expect(s.recordedFunds).toBe("$125.00");
    expect(s.legacyReview).toBe("0");
    expect(s.ledgerDifferencesCount).toBe(0);
  });

  it("does not total a balance that was never established as $0", () => {
    expect(describeTrustSummary([row({ currentBalanceCents: null })], null).recordedFunds).toMatch(/not established/);
  });
});
