import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const FORBIDDEN_STAFF_STRIP_COPY = [
  "Coverage engine",
  "launching sprint",
  "schema sprint",
  "launch sprint",
  "engine sprint",
  "coverage engine",
];

describe("FacilityStaffMetricsStrip operator copy — no engineering placeholders", () => {
  it("FacilityStaffMetricsStrip.tsx uses named coverage gaps instead of sprint jargon", () => {
    const source = readSource("src/components/admin/facilities/FacilityStaffMetricsStrip.tsx");

    for (const forbidden of FORBIDDEN_STAFF_STRIP_COPY) {
      expect(source, `FacilityStaffMetricsStrip still contains ${forbidden}`).not.toContain(forbidden);
    }

    expect(source).toContain("formatStaffStripCoverageGapMainValue");
    expect(source).toContain("formatStaffStripCoverageGapSubcopy");
  });
});
