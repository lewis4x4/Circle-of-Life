import { describe, expect, it } from "vitest";

import {
  PERIOD_CLOSE_NO_CLOSED_AT_COPY,
  formatPeriodClosedAt,
} from "./finance-period-close-display-copy";

const EM_DASH = "—";

describe("formatPeriodClosedAt", () => {
  it("names a missing close timestamp instead of an em dash", () => {
    expect(formatPeriodClosedAt(null)).toBe(PERIOD_CLOSE_NO_CLOSED_AT_COPY);
    expect(formatPeriodClosedAt(undefined)).toBe(PERIOD_CLOSE_NO_CLOSED_AT_COPY);
    expect(formatPeriodClosedAt("")).toBe(PERIOD_CLOSE_NO_CLOSED_AT_COPY);
    expect(formatPeriodClosedAt("   ")).toBe(PERIOD_CLOSE_NO_CLOSED_AT_COPY);
    expect(formatPeriodClosedAt("—")).toBe(PERIOD_CLOSE_NO_CLOSED_AT_COPY);
    expect(formatPeriodClosedAt(null)).not.toBe(EM_DASH);
  });

  it("formats a posted close timestamp", () => {
    const formatted = formatPeriodClosedAt("2026-04-08T15:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).not.toBe(PERIOD_CLOSE_NO_CLOSED_AT_COPY);
  });
});
