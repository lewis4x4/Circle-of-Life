import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { getCaregiverScheduleWindow } from "./page";

describe("caregiver schedule Eastern window", () => {
  it("keeps the requested calendar bounds after 8pm ET", () => {
    const now = new Date("2026-08-20T20:05:00-04:00");

    expect(getCaregiverScheduleWindow(now, "America/New_York")).toEqual({
      start: "2026-08-19",
      end: "2026-09-10",
    });
    expect(now.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses each facility calendar instead of applying an Eastern window to every building", () => {
    const now = new Date("2026-09-25T06:00:00Z");
    expect(getCaregiverScheduleWindow(now, "America/Los_Angeles")).toEqual({ start: "2026-09-23", end: "2026-10-15" });
    expect(getCaregiverScheduleWindow(now, "Asia/Tokyo")).toEqual({ start: "2026-09-24", end: "2026-10-16" });
    // Early local morning must not subtract the zone offset a second time.
    expect(getCaregiverScheduleWindow(new Date("2026-09-25T10:00:00Z"), "America/Los_Angeles")).toEqual({ start: "2026-09-24", end: "2026-10-16" });
  });

  it("uses those bounds in the query and names loading and empty states", () => {
    const source = fs.readFileSync(__filename.replace(/\.test\.tsx$/, ".tsx"), "utf8");

    expect(source).toContain('.gte("shift_date", start)');
    expect(source).toContain('.eq("schedules.status", "published")');
    expect(source).toContain('.is("schedules.deleted_at", null)');
    expect(source).toContain("formatScheduleTimes(r.custom_start_time, r.custom_end_time)");
    expect(source).toContain('.lte("shift_date", end)');
    expect(source).toContain("Loading your schedule…");
    expect(source).toContain("No shift assignments from");
    expect(source).toContain("through ${formatDisplayDate(scheduleWindow.end)}");
  });
});
