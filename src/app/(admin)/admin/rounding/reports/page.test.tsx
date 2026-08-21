import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "./page.tsx"),
  "utf8",
);

describe("AdminRoundingReportsPage facility-local date presets", () => {
  it("labels custom date fields as Eastern facility-local", () => {
    expect(pageSource).toContain("From (ET)");
    expect(pageSource).toContain("To (ET)");
  });

  it("does not derive preset ranges from a UTC ISO slice", () => {
    expect(pageSource).toContain("defaultRoundingReportLast7Days");
    expect(pageSource).toContain("roundingReportRangeForPreset");
    expect(pageSource).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
