import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("staff roster Eastern wall-clock sources", () => {
  it("staff detail page uses todayFacilityDateIso for upcoming-shift cutoff, not UTC ISO slice", () => {
    const source = readSource("src/app/(admin)/staff/[id]/page.tsx");

    expect(source).toContain("todayFacilityDateIso()");
    expect(source).toContain("STAFF_DETAIL_NO_CERTS_COPY");
    expect(source).toContain("STAFF_DETAIL_NO_UPCOMING_SHIFTS_COPY");
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });

  it("load-staff.ts anchors upcoming-shift gte on staffUpcomingShiftCutoffIso", () => {
    const source = readSource("src/lib/staff/load-staff.ts");

    expect(source).toContain("staffUpcomingShiftCutoffIso");
    expect(source).toContain("todayFacilityDateIso");
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
