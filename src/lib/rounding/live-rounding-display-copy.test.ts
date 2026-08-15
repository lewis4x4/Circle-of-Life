import { describe, expect, it } from "vitest";

import {
  LIVE_ROUNDING_NO_DUE_DATE_COPY,
  LIVE_ROUNDING_NO_SHIFT_TYPE_COPY,
  LIVE_ROUNDING_NO_TIME_COPY,
  formatLiveRoundingDueLabel,
  formatLiveRoundingShiftType,
  formatLiveRoundingTimeOfDay,
} from "./live-rounding-display-copy";

const EM_DASH = "—";
const FIXED_NOW = Date.UTC(2026, 7, 15, 12, 0, 0);

describe("formatLiveRoundingShiftType", () => {
  it("names a missing shift type instead of an em dash", () => {
    expect(formatLiveRoundingShiftType(null)).toBe(LIVE_ROUNDING_NO_SHIFT_TYPE_COPY);
    expect(formatLiveRoundingShiftType(undefined)).toBe(LIVE_ROUNDING_NO_SHIFT_TYPE_COPY);
    expect(formatLiveRoundingShiftType("")).toBe(LIVE_ROUNDING_NO_SHIFT_TYPE_COPY);
    expect(formatLiveRoundingShiftType("   ")).toBe(LIVE_ROUNDING_NO_SHIFT_TYPE_COPY);
    expect(formatLiveRoundingShiftType(null)).not.toBe(EM_DASH);
  });

  it("does not append a dangling shift word when missing", () => {
    expect(formatLiveRoundingShiftType(null)).not.toMatch(/shift shift/i);
    expect(formatLiveRoundingShiftType(null)).toBe("No shift posted");
  });

  it("keeps posted shift types as posted with shift suffix", () => {
    expect(formatLiveRoundingShiftType("night")).toBe("night shift");
    expect(formatLiveRoundingShiftType("  day  ")).toBe("day shift");
    expect(formatLiveRoundingShiftType("evening")).toBe("evening shift");
  });
});

describe("formatLiveRoundingDueLabel", () => {
  it("names a missing due-at instead of Unknown or an em dash", () => {
    expect(formatLiveRoundingDueLabel(null)).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel(undefined)).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel("")).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel("   ")).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel(EM_DASH)).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel("Unknown")).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel("not-a-date")).toBe(LIVE_ROUNDING_NO_DUE_DATE_COPY);
    expect(formatLiveRoundingDueLabel(null)).not.toBe("Unknown");
    expect(formatLiveRoundingDueLabel(null)).not.toBe(EM_DASH);
  });

  it("keeps relative labels for parseable due-at timestamps", () => {
    const now = FIXED_NOW;
    expect(formatLiveRoundingDueLabel("2026-08-15T12:00:00.000Z", now)).toBe("Now");
    expect(formatLiveRoundingDueLabel("2026-08-15T12:05:00.000Z", now)).toBe("in 5m");
    expect(formatLiveRoundingDueLabel("2026-08-15T11:55:00.000Z", now)).toBe("5m ago");
  });

  it("does not replace posted parseable dates with the no-date gap copy", () => {
    const now = FIXED_NOW;
    expect(formatLiveRoundingDueLabel("2026-08-15T12:10:00.000Z", now)).not.toBe(
      LIVE_ROUNDING_NO_DUE_DATE_COPY,
    );
    expect(formatLiveRoundingDueLabel("2026-08-15T11:50:00.000Z", now)).not.toBe(
      LIVE_ROUNDING_NO_DUE_DATE_COPY,
    );
  });
});

describe("formatLiveRoundingTimeOfDay", () => {
  it("names a missing due-at clock time instead of Unknown or an em dash", () => {
    expect(formatLiveRoundingTimeOfDay(null)).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay(undefined)).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay("")).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay("   ")).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay(EM_DASH)).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay("Unknown")).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay("not-a-date")).toBe(LIVE_ROUNDING_NO_TIME_COPY);
    expect(formatLiveRoundingTimeOfDay(null)).not.toBe("Unknown");
    expect(formatLiveRoundingTimeOfDay(null)).not.toBe(EM_DASH);
  });

  it("formats parseable due-at timestamps as hour:minute in America/New_York", () => {
    const formatted = formatLiveRoundingTimeOfDay("2026-08-15T16:30:00.000Z");
    const expected = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(new Date("2026-08-15T16:30:00.000Z"));
    expect(formatted).toBe(expected);
    expect(formatted).not.toBe(LIVE_ROUNDING_NO_TIME_COPY);
  });
});
