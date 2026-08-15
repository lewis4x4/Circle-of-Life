import { describe, expect, it } from "vitest";

import {
  TRUST_NO_LAST_ENTRY_DATE_COPY,
  formatTrustLastEntryDate,
} from "./trust-display-copy";

const EM_DASH = "—";

describe("formatTrustLastEntryDate", () => {
  it("names a missing last entry date instead of an em dash", () => {
    expect(formatTrustLastEntryDate(null)).toBe(TRUST_NO_LAST_ENTRY_DATE_COPY);
    expect(formatTrustLastEntryDate(undefined)).toBe(TRUST_NO_LAST_ENTRY_DATE_COPY);
    expect(formatTrustLastEntryDate("")).toBe(TRUST_NO_LAST_ENTRY_DATE_COPY);
    expect(formatTrustLastEntryDate("   ")).toBe(TRUST_NO_LAST_ENTRY_DATE_COPY);
    expect(formatTrustLastEntryDate("—")).toBe(TRUST_NO_LAST_ENTRY_DATE_COPY);
    expect(formatTrustLastEntryDate(null)).not.toBe(EM_DASH);
  });

  it("returns a posted date as-is (trim only)", () => {
    expect(formatTrustLastEntryDate("2026-04-08")).toBe("2026-04-08");
    expect(formatTrustLastEntryDate("  2026-04-08  ")).toBe("2026-04-08");
  });
});
