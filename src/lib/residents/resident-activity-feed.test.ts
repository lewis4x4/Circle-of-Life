import { describe, expect, it } from "vitest";

import {
  activityFeedEmptyCopy,
  activityFeedFilteredEmptyCopy,
  activityFeedWindow,
  isWithinActivityWindow,
  recordedDayKey,
  resolveActivityFeedState,
} from "./resident-activity-feed";

describe("activity feed window", () => {
  it("spans the last 30 facility days and names the period", () => {
    // 2026-09-15 21:30 ET is 2026-09-16 01:30 UTC — the window still ends on the facility day.
    const now = new Date("2026-09-16T01:30:00.000Z");
    const window = activityFeedWindow(now);
    expect(window.endDay).toBe("2026-09-15");
    expect(window.startDay).toBe("2026-08-17");
    expect(window.label).toBe("Aug 17 – Sep 15, 2026");
  });

  it("keeps date-only log days and converts timestamps to facility days", () => {
    expect(recordedDayKey("2026-09-01")).toBe("2026-09-01");
    expect(recordedDayKey("2026-09-16T01:30:00.000Z")).toBe("2026-09-15");
    expect(recordedDayKey("not a date")).toBeNull();
    expect(recordedDayKey(null)).toBeNull();
  });

  it("includes entries inside the window, excludes older ones, keeps unknown times", () => {
    const window = activityFeedWindow(new Date("2026-09-16T01:30:00.000Z"));
    expect(isWithinActivityWindow("2026-09-10T12:00:00.000Z", window)).toBe(true);
    expect(isWithinActivityWindow("2026-08-17", window)).toBe(true);
    expect(isWithinActivityWindow("2026-08-16", window)).toBe(false);
    expect(isWithinActivityWindow(null, window)).toBe(true);
  });
});

describe("activity feed state machine", () => {
  it("renders exactly one of loading, error, successful-empty, filtered-empty, populated", () => {
    expect(resolveActivityFeedState({ status: "loading", inWindowCount: 0, visibleCount: 0 })).toBe("loading");
    expect(resolveActivityFeedState({ status: "error", inWindowCount: 0, visibleCount: 0 })).toBe("error");
    expect(resolveActivityFeedState({ status: "ready", inWindowCount: 0, visibleCount: 0 })).toBe("success-empty");
    expect(resolveActivityFeedState({ status: "ready", inWindowCount: 3, visibleCount: 0 })).toBe("filtered-empty");
    expect(resolveActivityFeedState({ status: "ready", inWindowCount: 3, visibleCount: 2 })).toBe("populated");
  });

  it("states that nothing was recorded for the period without calling the shift quiet", () => {
    const window = activityFeedWindow(new Date("2026-09-16T01:30:00.000Z"));
    const copy = activityFeedEmptyCopy(window);
    expect(copy).toBe("No activity recorded for Aug 17 – Sep 15, 2026.");
    expect(copy.toLowerCase()).not.toContain("quiet");
    expect(activityFeedFilteredEmptyCopy("behavior", window)).toBe(
      "No behavior recorded for Aug 17 – Sep 15, 2026. Other entry types were recorded in this period.",
    );
  });
});
