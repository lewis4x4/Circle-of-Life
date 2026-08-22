import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("nurse dashboard dose-alert stamp", () => {
  it("names Eastern today and keeps action tiles out of uppercase tracking-wider styling", () => {
    const source = fs.readFileSync(__filename.replace(/\.test\.tsx$/, ".tsx"), "utf8");
    const actionTileSource = source.slice(source.indexOf("function ActionTile"));

    expect(source).toContain("Dose Alerts — Eastern today");
    expect(actionTileSource).not.toContain("uppercase tracking-wider");
  });
});
