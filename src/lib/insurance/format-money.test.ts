import { describe, expect, it } from "vitest";

import {
  FORMAT_USD_NO_AMOUNT_POSTED_COPY,
  formatUsdFromCents,
} from "./format-money";

const EM_DASH = "—";

describe("formatUsdFromCents", () => {
  it("names missing cents instead of an em dash", () => {
    expect(formatUsdFromCents(null)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdFromCents(undefined)).toBe(FORMAT_USD_NO_AMOUNT_POSTED_COPY);
    expect(formatUsdFromCents(null)).not.toBe(EM_DASH);
    expect(formatUsdFromCents(undefined)).not.toBe(EM_DASH);
  });

  it("formats zero cents as a dollar zero", () => {
    expect(formatUsdFromCents(0)).toBe("$0.00");
  });

  it("formats positive integer cents as USD currency", () => {
    expect(formatUsdFromCents(12345)).toBe("$123.45");
    expect(formatUsdFromCents(1)).toBe("$0.01");
  });

  it("formats negative integer cents as USD currency", () => {
    expect(formatUsdFromCents(-500)).toBe("-$5.00");
  });
});
