import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

const modalSource = readFileSync(
  path.join(process.cwd(), "src/components/medication/CountInitiationModal.tsx"),
  "utf8",
);

describe("CountInitiationModal facility count_date", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("keeps count_date on the Eastern calendar after 8pm ET", () => {
    expect(todayFacilityDateIso(eightOhFivePmEt)).toBe("2026-08-20");
    expect(todayFacilityDateIso(eightOhFivePmEt)).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses todayFacilityDateIso for count_date and stamps the control as Eastern", () => {
    expect(modalSource).toContain("todayFacilityDateIso()");
    expect(modalSource).toContain("Count date (ET)");
    expect(modalSource).not.toMatch(/count_date[\s\S]*toISOString\(\)\.slice\(0,\s*10\)/);
    expect(modalSource).not.toMatch(
      /const today = new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });
});
