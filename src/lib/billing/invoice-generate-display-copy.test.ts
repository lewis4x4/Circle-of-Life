import { describe, expect, it } from "vitest";

import {
  GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY,
  GENERATE_PREVIEW_NO_CONCESSION_POSTED_COPY,
  formatGeneratePreviewBillingPeriodRange,
  formatGeneratePreviewConcessionCents,
} from "./invoice-generate-display-copy";

const EM_DASH = "—";

describe("formatGeneratePreviewConcessionCents", () => {
  it("names the gap when concession cents are unset", () => {
    expect(formatGeneratePreviewConcessionCents(null)).toBe(
      GENERATE_PREVIEW_NO_CONCESSION_POSTED_COPY,
    );
    expect(formatGeneratePreviewConcessionCents(undefined)).toBe(
      GENERATE_PREVIEW_NO_CONCESSION_POSTED_COPY,
    );
    expect(formatGeneratePreviewConcessionCents(null)).not.toBe(EM_DASH);
  });

  it("preserves numeric zero as formatted USD", () => {
    expect(formatGeneratePreviewConcessionCents(0)).toBe("$0.00");
  });

  it("formats non-zero concession cents as USD", () => {
    expect(formatGeneratePreviewConcessionCents(12_500)).toBe("$125.00");
    expect(formatGeneratePreviewConcessionCents(-3_000)).toBe("-$30.00");
  });
});

describe("formatGeneratePreviewBillingPeriodRange", () => {
  it("names the gap when the billing period is not loaded", () => {
    expect(formatGeneratePreviewBillingPeriodRange(null, null)).toBe(
      GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY,
    );
    expect(formatGeneratePreviewBillingPeriodRange("", "2026-05-31")).toBe(
      GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY,
    );
    expect(formatGeneratePreviewBillingPeriodRange("2026-05-01", "")).toBe(
      GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY,
    );
    expect(formatGeneratePreviewBillingPeriodRange("—", "2026-05-31")).toBe(
      GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY,
    );
  });

  it("formats a posted billing period range", () => {
    const formatted = formatGeneratePreviewBillingPeriodRange(
      "2026-05-01",
      "2026-05-31",
    );
    expect(formatted).toContain("May");
    expect(formatted).toContain("1");
    expect(formatted).toContain("31");
    expect(formatted).toContain("2026");
    expect(formatted).not.toBe(GENERATE_PREVIEW_NO_BILLING_PERIOD_COPY);
  });
});
