import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { addFacilityCalendarDays, todayFacilityDateIso } from "@/lib/facility-wall-clock";

describe("billing invoice ledger Eastern activity window", () => {
  it("keeps the activity window on the Eastern calendar after 8pm ET", () => {
    const now = new Date("2026-08-20T20:05:00-04:00");
    const t = todayFacilityDateIso(now);

    expect(t).toBe("2026-08-20");
    expect(addFacilityCalendarDays(t, -7)).toBe("2026-08-13");
    expect(addFacilityCalendarDays(t, 7)).toBe("2026-08-27");
    expect(now.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses shared facility-calendar helpers and stamps the activity strip as Eastern", () => {
    const source = readFileSync(__filename.replace(/-wall-clock-source\.test\.ts$/, ".tsx"), "utf8");

    expect(source).toContain("const t = todayFacilityDateIso();");
    expect(source).toContain("addFacilityCalendarDays(t, -7)");
    expect(source).toContain("addFacilityCalendarDays(t, 7)");
    expect(source).toContain("as of {t} Eastern");
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
