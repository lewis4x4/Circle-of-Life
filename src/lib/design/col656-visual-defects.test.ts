/**
 * COL-656 specific visual defects from the 2026-09-22 audit. Source-level so a
 * revert of any one of them fails here rather than in the next audit.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("COL-656 visual defects", () => {
  it("incidents/new section headings use the foreground token, not hot pink", () => {
    const page = source("src/app/(admin)/incidents/new/page.tsx");
    expect(page).not.toMatch(/<h[23][^>]*text-rose-500/);
    expect(page).toContain("Primary classification");
  });

  it("transportation '+ Vehicle' is the default primary button, not an off-palette green", () => {
    const page = source("src/app/(admin)/transportation/page.tsx");
    const vehicleLink = page.slice(page.indexOf('href="/admin/transportation/vehicles/new"'), page.indexOf("+ Vehicle"));
    expect(vehicleLink).not.toMatch(/bg-emerald|bg-green/);
  });

  it("verbal-order confirmation uses the default primary button", () => {
    const page = source("src/app/(admin)/admin/medications/verbal-orders/new/page.tsx");
    expect(page).not.toContain("bg-emerald-600 text-white");
  });

  it("executive league header is the shared PageHeader; the ET note is not in the button row", () => {
    const page = source("src/components/executive/ExecutiveLeaguePageClient.tsx");
    expect(page).toContain("<PageHeader");
    expect(page).not.toMatch(/<span[^>]*>Eastern \(ET\) file date<\/span>/);
  });

  it("org AR aging header is the shared PageHeader without a success-green wash", () => {
    const page = source("src/app/(admin)/billing/org-ar-aging/page.tsx");
    expect(page).toContain("<PageHeader");
    expect(page).not.toContain("bg-emerald-50");
  });
});
