import { describe, expect, it } from "vitest";

import {
  ACTIVITIES_NO_END_TIME_COPY,
  ACTIVITIES_NO_START_TIME_COPY,
  formatActivitySessionEndTime,
  formatActivitySessionStartTime,
  formatActivitySessionTimeRange,
} from "./activities-session-time-copy";

const EM_DASH = "—";

describe("formatActivitySessionStartTime", () => {
  it("names a missing start time instead of an em dash", () => {
    expect(formatActivitySessionStartTime(null)).toBe(ACTIVITIES_NO_START_TIME_COPY);
    expect(formatActivitySessionStartTime("")).toBe(ACTIVITIES_NO_START_TIME_COPY);
    expect(formatActivitySessionStartTime("   ")).toBe(ACTIVITIES_NO_START_TIME_COPY);
  });

  it("returns a posted start time", () => {
    expect(formatActivitySessionStartTime("09:30")).toBe("09:30");
  });

  it("never returns an em dash", () => {
    expect(formatActivitySessionStartTime(null)).not.toBe(EM_DASH);
  });
});

describe("formatActivitySessionEndTime", () => {
  it("names a missing end time instead of an em dash", () => {
    expect(formatActivitySessionEndTime(null)).toBe(ACTIVITIES_NO_END_TIME_COPY);
    expect(formatActivitySessionEndTime("")).toBe(ACTIVITIES_NO_END_TIME_COPY);
    expect(formatActivitySessionEndTime("   ")).toBe(ACTIVITIES_NO_END_TIME_COPY);
  });

  it("returns a posted end time", () => {
    expect(formatActivitySessionEndTime("11:00")).toBe("11:00");
  });

  it("never returns an em dash", () => {
    expect(formatActivitySessionEndTime(null)).not.toBe(EM_DASH);
  });
});

describe("formatActivitySessionTimeRange", () => {
  it("names both gaps when start and end are missing", () => {
    expect(formatActivitySessionTimeRange(null, null)).toBe(
      `${ACTIVITIES_NO_START_TIME_COPY} → ${ACTIVITIES_NO_END_TIME_COPY}`,
    );
  });

  it("names only the missing side", () => {
    expect(formatActivitySessionTimeRange("09:30", null)).toBe(
      `09:30 → ${ACTIVITIES_NO_END_TIME_COPY}`,
    );
    expect(formatActivitySessionTimeRange(null, "11:00")).toBe(
      `${ACTIVITIES_NO_START_TIME_COPY} → 11:00`,
    );
  });

  it("returns posted times unchanged", () => {
    expect(formatActivitySessionTimeRange("09:30", "11:00")).toBe("09:30 → 11:00");
  });

  it("never returns an em dash", () => {
    expect(formatActivitySessionTimeRange(null, null)).not.toContain(EM_DASH);
  });
});
