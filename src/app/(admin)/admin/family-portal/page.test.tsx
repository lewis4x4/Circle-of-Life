import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "./page.tsx"),
  "utf8",
);

describe("AdminFamilyPortalPage facility scope subtitle", () => {
  it("does not interpolate legacy selected facility copy", () => {
    expect(pageSource).not.toContain('"selected facility"');
    expect(pageSource).not.toContain("'selected facility'");
    expect(pageSource).toContain("resolveFamilyPortalAdminFacilityScope");
    expect(pageSource).toContain("formatFamilyPortalAdminPageSubtitle");
  });

  it("gates the whole body on one facility, so no KPI slot ever holds gate copy (COL-651)", () => {
    expect(pageSource).toContain("<FacilityGateNotice");
    expect(pageSource).not.toMatch(/select a facility/i);
    expect(pageSource).not.toContain("familyPortalAdminKpiValue");
  });
});
