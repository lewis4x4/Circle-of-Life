import { describe, expect, it } from "vitest";

import {
  USD_MONTHLY_NO_AMOUNT_POSTED_COPY,
  formatUsdMonthlyFromCents,
} from "./usd-monthly";

const EM_DASH = "—";

describe("formatUsdMonthlyFromCents", () => {
  it("names non-finite cents instead of an em dash", () => {
    expect(formatUsdMonthlyFromCents(NaN)).toBe(USD_MONTHLY_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdMonthlyFromCents(Infinity)).toBe(USD_MONTHLY_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdMonthlyFromCents(-Infinity)).toBe(USD_MONTHLY_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdMonthlyFromCents(NaN)).not.toBe(EM_DASH);
  });

  it("formats zero cents as a monthly zero dollar rate", () => {
    expect(formatUsdMonthlyFromCents(0)).toBe("$0 / mo");
  });

  it("formats whole-dollar monthly rates without cents", () => {
    expect(formatUsdMonthlyFromCents(125_000)).toBe("$1,250 / mo");
  });

  it("formats fractional monthly rates with cents", () => {
    expect(formatUsdMonthlyFromCents(125_050)).toBe("$1,250.50 / mo");
  });
});
