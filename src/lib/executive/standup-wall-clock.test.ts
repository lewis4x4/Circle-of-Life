import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { currentStandupWeekOf, standupCalendarWindow } from "./standup";

const standupSource = readFileSync(
  path.join(process.cwd(), "src/lib/executive/standup.ts"),
  "utf8",
);

describe("executive standup Eastern calendar", () => {
  /** 8:05 PM Eastern on Thursday 2026-08-20 (EDT, UTC−4) — UTC date is Friday. */
  const thursdayEveningEt = new Date("2026-08-20T20:05:00-04:00");
  /** 8:05 PM Eastern on Sunday 2026-08-23 — UTC date is Monday. */
  const sundayEveningEt = new Date("2026-08-23T20:05:00-04:00");

  it("keeps today and week-of on the Eastern calendar after UTC rolls", () => {
    expect(todayFacilityDateIso(thursdayEveningEt)).toBe("2026-08-20");
    expect(thursdayEveningEt.toISOString().slice(0, 10)).toBe("2026-08-21");

    const window = standupCalendarWindow(thursdayEveningEt);
    expect(window.todayIso).toBe("2026-08-20");
    expect(window.weekOf).toBe("2026-08-17");
    expect(window.thisWeekEnd).toBe("2026-08-23");
    expect(window.completedLastWeekStart).toBe("2026-08-10");
    expect(window.completedLastWeekEnd).toBe("2026-08-16");
    expect(window.monthYm).toBe("2026-08");
    expect(currentStandupWeekOf(thursdayEveningEt)).toBe("2026-08-17");
  });

  it("does not advance the standup week on Sunday evening Eastern", () => {
    expect(todayFacilityDateIso(sundayEveningEt)).toBe("2026-08-23");
    expect(sundayEveningEt.toISOString().slice(0, 10)).toBe("2026-08-24");
    expect(currentStandupWeekOf(sundayEveningEt)).toBe("2026-08-17");
    expect(standupCalendarWindow(sundayEveningEt).thisWeekEnd).toBe("2026-08-23");
  });

  it("uses facility wall-clock helpers instead of a UTC ISO slice", () => {
    expect(standupSource).toContain("todayFacilityDateIso");
    expect(standupSource).toContain("standupCalendarWindow");
    expect(standupSource).not.toContain("function toIsoDate");
    expect(standupSource).not.toContain("toISOString().slice(0, 10)");
    expect(standupSource).not.toContain("T00:00:00.000Z");
  });
});
