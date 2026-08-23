import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("caregiver me illness self-report Eastern wall-clock sources", () => {
  it("uses todayFacilityDateIso for illness dates and named success copy, not UTC ISO slice", () => {
    const source = readSource("src/app/(caregiver)/me/page.tsx");

    expect(source).toContain("todayFacilityDateIso()");
    expect(source).toContain("caregiverIllnessSelfReportSuccessCopy");
    expect(source).toContain("symptoms: [\"self_report\"]");
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
