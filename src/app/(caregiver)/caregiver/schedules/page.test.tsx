import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { getCaregiverScheduleWindow } from "./page";

describe("caregiver schedule Eastern window", () => {
  it("keeps the requested calendar bounds after 8pm ET", () => {
    const now = new Date("2026-08-20T20:05:00-04:00");

    expect(getCaregiverScheduleWindow(now)).toEqual({
      start: "2026-08-19",
      end: "2026-09-10",
    });
    expect(now.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses those bounds in the query and names loading and empty states", () => {
    const source = fs.readFileSync(__filename.replace(/\.test\.tsx$/, ".tsx"), "utf8");

    expect(source).toContain('.gte("shift_date", start)');
    expect(source).toContain('.lte("shift_date", end)');
    expect(source).toContain("Loading your schedule…");
    expect(source).toContain("No shift assignments from");
    expect(source).toContain("through ${scheduleWindow.end} Eastern");
  });
});
