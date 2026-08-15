import { describe, expect, it } from "vitest";

import {
  RATES_STRIP_NO_SCHEDULED_CHANGE_COPY,
  formatRatesStripNextScheduledChange,
  ratesStripNextScheduledChangeIsMissing,
} from "./rates-metrics-strip-display-copy";

const EM_DASH = "—";
const TZ = "America/New_York";

describe("formatRatesStripNextScheduledChange", () => {
  it("names a missing scheduled change instead of an em dash", () => {
    expect(formatRatesStripNextScheduledChange(null, TZ)).toBe(RATES_STRIP_NO_SCHEDULED_CHANGE_COPY);
    expect(formatRatesStripNextScheduledChange(undefined, TZ)).toBe(RATES_STRIP_NO_SCHEDULED_CHANGE_COPY);
    expect(formatRatesStripNextScheduledChange(null, TZ)).not.toBe(EM_DASH);
  });

  it("formats a future-dated rate row", () => {
    const formatted = formatRatesStripNextScheduledChange("2027-06-01", TZ);
    expect(formatted).not.toBe(RATES_STRIP_NO_SCHEDULED_CHANGE_COPY);
    expect(formatted).toMatch(/Jun/);
  });
});

describe("ratesStripNextScheduledChangeIsMissing", () => {
  it("flags nullish scheduled dates as missing", () => {
    expect(ratesStripNextScheduledChangeIsMissing(null)).toBe(true);
    expect(ratesStripNextScheduledChangeIsMissing(undefined)).toBe(true);
  });

  it("does not flag a posted YMD as missing", () => {
    expect(ratesStripNextScheduledChangeIsMissing("2027-06-01")).toBe(false);
  });
});
