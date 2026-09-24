import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isStaffingRatioCheckOn } from "@/lib/staffing/ratio-check";

describe("staffing ratio check switch (COL-675)", () => {
  it("is on only when a ratio rule set is assigned", () => {
    expect(isStaffingRatioCheckOn(null)).toBe(false);
    expect(isStaffingRatioCheckOn(undefined)).toBe(false);
    expect(isStaffingRatioCheckOn("")).toBe(false);
    expect(isStaffingRatioCheckOn("0f5c1f2e-0000-4000-8000-000000000001")).toBe(true);
  });

  it("the nightly risk scorer applies the same switch to staffing adequacy", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../supabase/functions/risk-nightly-scorer/index.ts"),
      "utf8",
    );
    expect(source).toContain("facility_ratio_rule_set_id");
    expect(source).toMatch(/staffingRatioCheckOn\s*\?/);
  });
});
