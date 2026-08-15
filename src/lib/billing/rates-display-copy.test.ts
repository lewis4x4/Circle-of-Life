import { describe, expect, it } from "vitest";

import {
  BILLING_RATE_NO_AMOUNT_COPY,
  formatBillingRateSurchargeCents,
} from "./rates-display-copy";

const EM_DASH = "—";

describe("formatBillingRateSurchargeCents", () => {
  it("names the gap when no surcharge cents are posted", () => {
    expect(formatBillingRateSurchargeCents(null)).toBe(BILLING_RATE_NO_AMOUNT_COPY);
    expect(formatBillingRateSurchargeCents(undefined)).toBe(BILLING_RATE_NO_AMOUNT_COPY);
    expect(formatBillingRateSurchargeCents(null)).not.toBe(EM_DASH);
  });

  it("preserves numeric zero as formatted USD", () => {
    expect(formatBillingRateSurchargeCents(0)).toBe("$0.00");
  });

  it("formats posted surcharge cents as USD", () => {
    expect(formatBillingRateSurchargeCents(125000)).toBe("$1,250.00");
  });
});
