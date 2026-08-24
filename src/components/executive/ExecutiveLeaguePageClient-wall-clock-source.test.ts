import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

const pageSource = readFileSync(
  path.resolve(import.meta.dirname, "./ExecutiveLeaguePageClient.tsx"),
  "utf8",
);

describe("executive league CSV export Eastern date stamp", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("names CSV exports with the Eastern calendar date after 8pm ET", () => {
    const dateStamp = todayFacilityDateIso(eightOhFivePmEt);

    expect(dateStamp).toBe("2026-08-20");
    expect(dateStamp).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(`executive-league-${dateStamp}.csv`).toBe("executive-league-2026-08-20.csv");
  });

  it("uses todayFacilityDateIso for CSV filenames and labels exports as Eastern", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("`executive-league-${todayFacilityDateIso()}.csv`");
    expect(pageSource).toContain("Eastern (ET) file date");
    expect(pageSource).not.toMatch(
      /executive-league-\$\{new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)\}/,
    );
    expect(pageSource).toContain('"executive-league.pdf"');
  });
});
