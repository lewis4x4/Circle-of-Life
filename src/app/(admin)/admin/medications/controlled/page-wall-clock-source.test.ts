import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

const pageSource = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("controlled substances CSV export Eastern date stamp", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("names CSV exports with the Eastern calendar date after 8pm ET", () => {
    const dateStamp = todayFacilityDateIso(eightOhFivePmEt);

    expect(dateStamp).toBe("2026-08-20");
    expect(dateStamp).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(`controlled-substances-${dateStamp}.csv`).toBe("controlled-substances-2026-08-20.csv");
  });

  it("uses todayFacilityDateIso for CSV filenames and keeps resolved_at as UTC ISO", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("`controlled-substances-${todayFacilityDateIso()}.csv`");
    expect(pageSource).toContain("CSV export filenames use today&apos;s Eastern (ET) calendar date.");
    expect(pageSource).not.toMatch(
      /controlled-substances-\$\{new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)\}/,
    );
    expect(pageSource).toContain("resolved_at: new Date().toISOString()");
  });
});
