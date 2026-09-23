import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { activeFamilySection, FAMILY_SECTIONS } from "./family-sections";

describe("family sections (COL-655)", () => {
  it.each([
    ["/family", "today"],
    ["/family/calendar", "calendar"],
    ["/family/benefits", "documents"],
    ["/family/invoices/abc", "billing"],
    ["/family/payments", "billing"],
    ["/family/unknown", null],
  ])("%s → %s", (pathname, key) => {
    expect(activeFamilySection(pathname)).toBe(key);
  });

  it("is the one list both family navs render", () => {
    expect(FAMILY_SECTIONS.map((section) => section.label)).toContain("Documents");
    for (const file of ["src/components/layout/FamilyShell.tsx", "src/components/family/FamilySectionIntro.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).toContain("FAMILY_SECTIONS");
      expect(source, file).not.toMatch(/href: "\/family\/calendar"/);
    }
  });
});
