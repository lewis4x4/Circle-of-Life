import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

describe("rounding task generation shift date", () => {
  it("uses the Eastern date at 8:05 p.m. ET when shiftDate is omitted", () => {
    const windowStart = new Date("2026-08-20T20:05:00-04:00");

    expect(todayFacilityDateIso(windowStart)).toBe("2026-08-20");
    expect(windowStart.toISOString().slice(0, 10)).toBe("2026-08-21");

    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/rounding/generate-tasks/route.ts"),
      "utf8",
    );
    expect(routeSource).toContain("body.shiftDate ?? todayFacilityDateIso(windowStart)");
    expect(routeSource).not.toContain("windowStart.toISOString().slice(0, 10)");
  });
});
