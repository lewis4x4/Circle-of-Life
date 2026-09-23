import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Raw <table> markup outside the Table primitive (COL-657 guard). A wide table
 * in a plain overflow box gives a phone no sign that more columns exist and no
 * keyboard way to reach them; `HorizontalScroll` (or the Table primitive,
 * which uses it) does both. Files still to convert are listed below — the list
 * only shrinks.
 */

// Print sheets and PDF/HTML builders render to paper, not a phone viewport.
const PRINT_OUTPUTS = new Set<string>([
  "src/app/(print)/print/survey-pack/SurveyPackSheet.tsx",
  "src/components/care-events/print/IncidentFormSheet.tsx",
  "src/components/care-events/print/IncidentReportsLogSheet.tsx",
  "src/components/care-events/print/TaxonomyPacketSheet.tsx",
  "src/app/(admin)/executive/reports/page.tsx", // the table is inside the exported HTML report string
  "src/lib/executive/league-print.ts",
  "src/lib/executive/standup-pdf.ts",
  "src/lib/office/morning-huddle-print.ts",
  "src/lib/reports/metric-presentation.ts",
  "src/lib/risk/survey-bundle-print.ts",
]);

// Screen tables not yet on HorizontalScroll (COL-657 follow-up). Emptied by COL-687 — keep it empty.
const NOT_YET_CONVERTED = new Set<string>([]);

const hasScrollAffordance = (source: string) =>
  source.includes("<HorizontalScroll") || (source.includes('role="region"') && source.includes("tabIndex={0}"));

describe("raw tables scroll with an affordance (COL-657 guard)", () => {
  const files = execFileSync("git", ["grep", "-l", "<table", "--", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !/\.test\.tsx?$/.test(file) && file !== "src/components/ui/table.tsx");

  it.each(files.filter((file) => !PRINT_OUTPUTS.has(file) && !NOT_YET_CONVERTED.has(file)))(
    "%s wraps its table in HorizontalScroll",
    (file) => {
      expect(hasScrollAffordance(readFileSync(file, "utf8"))).toBe(true);
    },
  );

  it("drops converted files from the pending list", () => {
    for (const file of NOT_YET_CONVERTED) {
      expect(files, `${file} no longer has a raw table`).toContain(file);
      expect(hasScrollAffordance(readFileSync(file, "utf8")), `${file} is converted — remove it from NOT_YET_CONVERTED`).toBe(false);
    }
  });
});
