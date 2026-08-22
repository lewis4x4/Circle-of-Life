import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("FinanceOverviewPageClient cutoff stamp", () => {
  it("shows the inclusive Eastern cutoff returned by the overview loader", () => {
    const source = fs.readFileSync(__filename.replace(/\.test\.tsx$/, ".tsx"), "utf8");

    expect(source).toContain(
      "Includes entries dated on or after {postedLookbackStart} Eastern.",
    );
  });
});
