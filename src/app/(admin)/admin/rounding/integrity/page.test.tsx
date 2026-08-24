import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "@/lib/rounding/observation-plan-display-copy";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "./page.tsx"),
  "utf8",
);

describe("AdminRoundingIntegrityPage facility scope copy", () => {
  it("does not interpolate legacy selected facility copy", () => {
    expect(pageSource).not.toContain('"selected facility"');
    expect(pageSource).not.toContain("'selected facility'");
    expect(pageSource).toContain("resolveIntegrityFacilityScope");
    expect(pageSource).toContain("formatIntegrityPageSubtitle");
  });

  it("reuses the shared select-facility gap copy for empty-state titles", () => {
    expect(pageSource).toContain("formatIntegrityNoFlagsEmptyTitle");
    expect(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY).toBe("Select a facility first.");
  });
});
