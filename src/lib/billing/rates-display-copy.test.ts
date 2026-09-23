import { describe, expect, it } from "vitest";

import {
  BILLING_RATE_NO_AMOUNT_COPY,
  BILLING_RATE_ZERO_COPY,
  formatBillingRateSurchargeCents,
} from "./rates-display-copy";

const EM_DASH = "—";

describe("formatBillingRateSurchargeCents", () => {
  it("names the gap when no surcharge cents are posted", () => {
    expect(formatBillingRateSurchargeCents(null)).toBe(BILLING_RATE_NO_AMOUNT_COPY);
    expect(formatBillingRateSurchargeCents(undefined)).toBe(BILLING_RATE_NO_AMOUNT_COPY);
    expect(formatBillingRateSurchargeCents(null)).not.toBe(EM_DASH);
  });

  it("says a stored zero is not set, not a bare $0.00 (COL-649)", () => {
    expect(formatBillingRateSurchargeCents(0)).toBe(BILLING_RATE_ZERO_COPY);
    expect(BILLING_RATE_ZERO_COPY).toContain("$0.00");
  });

  it("formats posted surcharge cents as USD", () => {
    expect(formatBillingRateSurchargeCents(125000)).toBe("$1,250.00");
  });
});
