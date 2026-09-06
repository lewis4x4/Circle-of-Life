import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

const persistenceSource = readFileSync(path.resolve(process.cwd(), "src/lib/reports/run-persistence.ts"), "utf8");
const pageSource = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("report run CSV export Eastern date stamp", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("names template and pack CSV exports with the Eastern calendar date after 8pm ET", () => {
    const dateStamp = todayFacilityDateIso(eightOhFivePmEt);

    expect(dateStamp).toBe("2026-08-20");
    expect(dateStamp).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect(`report-incidents-${dateStamp}.csv`).toBe("report-incidents-2026-08-20.csv");
    expect(`pack-abc123-${dateStamp}.csv`).toBe("pack-abc123-2026-08-20.csv");
  });

  it("uses todayFacilityDateIso for CSV filenames and labels exports as Eastern", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("`report-${slug}-${datePart}.csv`");
    expect(pageSource).toContain("`pack-${packId}-${datePart}.csv`");
    expect(pageSource).toContain("const datePart = todayFacilityDateIso();");
    expect(pageSource).toContain("CSV export filenames use today&apos;s Eastern (ET) calendar date.");
    expect(pageSource).not.toMatch(/datePart = new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
    expect(pageSource).toContain("runTemplateAndPersist(");
    expect(pageSource).toContain("finishReportRun(");
    expect(persistenceSource).toContain("completed_at: snapshot.generatedAt");
    expect(persistenceSource).toContain("generatedAt:new Date().toISOString()");
  });
});
