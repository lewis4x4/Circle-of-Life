import { describe, expect, it } from "vitest";

import {
  LIVE_ROUNDING_NO_SHIFT_TYPE_COPY,
  formatLiveRoundingShiftType,
} from "./live-rounding-display-copy";

const EM_DASH = "—";

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
