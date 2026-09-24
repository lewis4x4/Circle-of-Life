import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SURVEY_PACK_VIEWS, surveyPackView } from "@/lib/compliance/survey-pack-views";
import { ANCHOR_ONLY_ROUTES, PILLARS } from "@/lib/navigation/pillars";
import { LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

const APP = path.resolve(import.meta.dirname, "../../app/(admin)");

describe("one survey page (COL-707)", () => {
  it("has print pack, readiness binder and evidence bundle as views", () => {
    expect(SURVEY_PACK_VIEWS.map((v) => v.label)).toEqual(["Print pack", "Readiness binder", "Evidence bundle"]);
    expect(surveyPackView(undefined)).toBe("print");
    expect(surveyPackView("binder")).toBe("binder");
    expect(surveyPackView(["evidence"])).toBe("evidence");
  });

  it("308s the binder and the risk bundle into their views, with no page of their own", () => {
    expect(LEGACY_REDIRECTS).toContainEqual({ source: "/admin/survey-binder", destination: "/admin/compliance/survey-pack?tab=binder", permanent: true });
    expect(LEGACY_REDIRECTS).toContainEqual({ source: "/admin/risk/survey-bundle", destination: "/admin/compliance/survey-pack?tab=evidence", permanent: true });
    for (const dir of ["admin/survey-binder", "admin/risk/survey-bundle", "risk/survey-bundle"]) {
      expect(existsSync(path.join(APP, dir, "page.tsx")), dir).toBe(false);
    }
  });

  it("renders all three views from the survey pack page", () => {
    const page = readFileSync(path.join(APP, "admin/compliance/survey-pack/page.tsx"), "utf8");
    for (const view of ["<SurveyReadinessBinder />", "<RiskSurveyBundleSection />", "<SurveyPrintPack />"]) {
      expect(page).toContain(view);
    }
  });

  it("no nav entry points at the retired survey pages", () => {
    const hrefs = [...PILLARS.flatMap((p) => p.items), ...ANCHOR_ONLY_ROUTES].map((item) => item.href);
    expect(hrefs).not.toContain("/admin/survey-binder");
    expect(hrefs).not.toContain("/admin/risk/survey-bundle");
    expect(hrefs).toContain("/admin/compliance/survey-pack");
  });
});
