import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getExecutiveKpiDateWindow } from "@/lib/exec-kpi-snapshot";

const bulkSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "load-executive-kpi-bulk.ts"),
  "utf8",
);

describe("loadExecutiveKpiBulk date windows", () => {
  /** 8:05 PM Eastern on 2026-08-24 — shared helper must match facility wall clock. */
  const eightOhFivePmEtAug24 = new Date("2026-08-24T20:05:00-04:00");

  it("uses getExecutiveKpiDateWindow for today, +30, and MTD — not UTC slice helpers", () => {
    expect(bulkSource).toContain("getExecutiveKpiDateWindow");
    expect(bulkSource).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(bulkSource).not.toContain("Date.UTC");

    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);
    expect(window.today).toBe("2026-08-24");
    expect(window.plus30).toBe("2026-09-23");
    expect(window.mtdStart).toBe("2026-08-01");
  });
});
