import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

const consoleSource = readFileSync(
  path.resolve(import.meta.dirname, "./ControlledCountConsole.tsx"),
  "utf8",
);

describe("ControlledCountConsole Eastern count_date", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("records count_date as the Eastern calendar date after 8pm ET", () => {
    const countDate = todayFacilityDateIso(eightOhFivePmEt);

    expect(countDate).toBe("2026-08-20");
    expect(countDate).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses todayFacilityDateIso for count_date and labels the console Eastern (ET)", () => {
    expect(consoleSource).toContain("todayFacilityDateIso");
    expect(consoleSource).toContain("count_date: countDate");
    expect(consoleSource).toContain("Count date (ET)");
    expect(consoleSource).toContain("today&apos;s Eastern (ET) calendar date.");
    expect(consoleSource).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
