import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

  it("gates All facilities with the shared FacilityGate (COL-651)", () => {
    expect(pageSource).toContain("formatIntegrityNoFlagsEmptyTitle");
    expect(pageSource).toContain("<FacilityGateNotice");
  });
});
