import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FAMILY_PORTAL_ADMIN_SELECT_FACILITY_FIRST_COPY } from "@/lib/family/family-portal-admin-display-copy";

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

  it("reuses the shared select-facility gap copy", () => {
    expect(FAMILY_PORTAL_ADMIN_SELECT_FACILITY_FIRST_COPY).toBe("Select a facility first.");
  });
});
