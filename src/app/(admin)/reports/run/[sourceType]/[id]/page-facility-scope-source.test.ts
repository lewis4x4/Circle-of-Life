import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("report run facility scope (COL-651)", () => {
  it("never defaults the scope to the first facility in the list", () => {
    // An owner on All facilities used to run reports for Grande Cypress because
    // this default fired before the role context said the owner was org-wide.
    expect(pageSource).not.toMatch(/setScopeFacilityId\(facilityOptions\[0\]/);
  });

  it("keeps run buttons disabled until a single-facility role has chosen a building", () => {
    expect(pageSource.match(/\(!orgWide && !scopeFacilityId\)\}>/g)?.length).toBe(2);
  });
});
