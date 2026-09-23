import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** Page-level phone fixes from the 2026-09-22 audit (COL-687). */
describe("pages fit a 390px phone (COL-687)", () => {
  it("keeps the residents Group by label visible on a phone", () => {
    expect(read("src/components/residents/AdminResidentsPageClient.tsx")).not.toMatch(/hidden[^"]*sm:inline">Group by/);
  });

  it("wraps the override-admission warning instead of truncating it", () => {
    const source = read("src/components/residents/OverrideAdmissionForm.tsx");
    expect(source).not.toMatch(/truncate">\s*This form bypasses standard intake/);
  });

  it("shows the schedules card description below lg", () => {
    expect(read("src/components/schedules/AdminSchedulesPageClient.tsx")).not.toContain("hidden max-w-md text-xs font-mono leading-relaxed text-slate-500 lg:block");
  });

  it("puts family invoices and payments in the same centred column as the other family pages", () => {
    for (const page of ["invoices", "payments"]) {
      expect(read(`src/app/(family)/family/${page}/page.tsx`), page).toContain("mx-auto w-full max-w-3xl");
    }
  });

  it("reserves room for the public sticky contact bar", () => {
    expect(read("src/components/web/sticky-care-concierge.tsx")).toContain('data-slot="sticky-care-concierge-spacer"');
  });

  it("folds the reporting readiness steps behind a disclosure on a phone", () => {
    expect(read("src/components/common/source-readiness-callout.tsx")).toMatch(/<details className="md:hidden">/);
  });

  it("keeps Home quick actions and the reputation and referral tiles compact on a phone", () => {
    expect(read("src/components/home/QuickActions.tsx")).toContain("overflow-x-auto");
    expect(read("src/app/(admin)/reputation/page.tsx")).toContain('<KineticGrid className="grid-cols-2 xl:grid-cols-4');
    expect(read("src/components/referrals/AdminReferralsPageClient.tsx")).toContain("grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5");
  });
});
