import { describe, expect, it } from "vitest";

import { FIRST_BILLING_CYCLE_NO_DATE_COPY } from "./first-billing-cycle-display-copy";
import { labelFirstMonthlyBillingCycle } from "./first-billing-cycle-label";

const EM_DASH = "—";

describe("labelFirstMonthlyBillingCycle", () => {
  it("names unparseable YMD instead of an em dash", () => {
    for (const ymd of ["", "abc", "2026", "2026-01", "2026-01-xx", "2026-xx-01"]) {
      expect(labelFirstMonthlyBillingCycle(ymd)).toBe(FIRST_BILLING_CYCLE_NO_DATE_COPY);
      expect(labelFirstMonthlyBillingCycle(ymd)).not.toBe(EM_DASH);
    }
  });

  it("formats first-of-month effective dates as that month", () => {
    expect(labelFirstMonthlyBillingCycle("2026-01-01")).toBe("Jan 1, 2026");
    expect(labelFirstMonthlyBillingCycle("2026-12-01")).toBe("Dec 1, 2026");
  });

  it("formats mid-month effective dates as the first of the next month", () => {
    expect(labelFirstMonthlyBillingCycle("2026-01-15")).toBe("Feb 1, 2026");
    expect(labelFirstMonthlyBillingCycle("2026-11-30")).toBe("Dec 1, 2026");
  });
});
