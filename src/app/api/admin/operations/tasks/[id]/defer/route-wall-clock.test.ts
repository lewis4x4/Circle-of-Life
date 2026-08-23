import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { inferShiftFromDate } from "./route";

describe("operations task defer wall clock", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("uses Eastern calendar date and evening shift at 8:05 p.m. ET", () => {
    expect(todayFacilityDateIso(eightOhFivePmEt)).toBe("2026-08-20");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(inferShiftFromDate(eightOhFivePmEt)).toBe("evening");
    expect(inferShiftFromDate(eightOhFivePmEt)).not.toBe("night");
  });

  it("route assigns shift date from todayFacilityDateIso, not UTC ISO slice", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "src/app/api/admin/operations/tasks/[id]/defer/route.ts"),
      "utf8",
    );
    expect(routeSource).toContain("assigned_shift_date: todayFacilityDateIso(deferredUntil)");
    expect(routeSource).not.toContain("deferredUntil.toISOString().slice(0, 10)");
    expect(routeSource).toContain("formatInTimeZone(date, FACILITY_OPERATOR_TZ");
  });
});
