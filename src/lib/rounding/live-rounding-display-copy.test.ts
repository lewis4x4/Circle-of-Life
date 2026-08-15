import { describe, expect, it } from "vitest";

import {
  LIVE_ROUNDING_NO_DUE_DATE_COPY,
  LIVE_ROUNDING_NO_SHIFT_TYPE_COPY,
  formatLiveRoundingDueLabel,
  formatLiveRoundingShiftType,
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
