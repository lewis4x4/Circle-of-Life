import { describe, expect, it } from "vitest";

import {
  USD_MONTHLY_NO_AMOUNT_POSTED_COPY,
  formatUsdCurrencyFromCents,
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

describe("formatUsdCurrencyFromCents", () => {
  it("names non-finite cents instead of an em dash", () => {
    expect(formatUsdCurrencyFromCents(NaN)).toBe(USD_MONTHLY_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdCurrencyFromCents(Infinity)).toBe(USD_MONTHLY_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdCurrencyFromCents(-Infinity)).toBe(USD_MONTHLY_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdCurrencyFromCents(NaN)).not.toBe(EM_DASH);
  });

  it("formats zero cents as a zero dollar amount without monthly suffix", () => {
    expect(formatUsdCurrencyFromCents(0)).toBe("$0");
  });

  it("formats whole-dollar amounts without cents", () => {
    expect(formatUsdCurrencyFromCents(125_000)).toBe("$1,250");
  });

  it("formats fractional amounts with cents", () => {
    expect(formatUsdCurrencyFromCents(125_050)).toBe("$1,250.50");
  });
});
