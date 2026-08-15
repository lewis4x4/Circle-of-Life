import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FAMILY_CARE_PLAN_EMPTY_DESCRIPTION,
  FAMILY_CARE_PLAN_EMPTY_TITLE,
  FAMILY_CARE_PLAN_FOOTER_HELPER,
  FAMILY_CARE_PLAN_LOADING,
  FAMILY_CARE_PLAN_NOT_POSTED,
  FAMILY_CARE_PLAN_NO_PROTOCOL_LINES,
  FAMILY_CARE_PLAN_PAGE_DESCRIPTION,
  FAMILY_CARE_PLAN_PAGE_TITLE,
  FAMILY_CARE_PLAN_RESIDENT_NAME_FALLBACK,
  FAMILY_CARE_PLAN_RETRY,
} from "@/lib/family/family-portal-copy";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const familyPortalCopyPath = path.join(repoRoot, "src/lib/family/family-portal-copy.ts");
const carePlanPagePath = path.join(repoRoot, "src/app/(family)/family/care-plan/page.tsx");
const carePlanDataPath = path.join(repoRoot, "src/lib/family/family-care-plan-data.ts");

const FORBIDDEN_CARE_PLAN_COPY = [
  /framework/i,
  /itinerary/i,
  /moments/i,
  /journal/i,
  /loved one/i,
  /reply/i,
  /ask a question/i,
  /retry connection/i,
];

function assertNoForbiddenCopy(label: string, text: string) {
  for (const pattern of FORBIDDEN_CARE_PLAN_COPY) {
    expect(text, `${label} must not match ${pattern}`).not.toMatch(pattern);
  }
}

describe("family care plan portal copy", () => {
  it("uses calm read-only care plan language in shared constants", () => {
    assertNoForbiddenCopy("page title", FAMILY_CARE_PLAN_PAGE_TITLE);
    assertNoForbiddenCopy("page description", FAMILY_CARE_PLAN_PAGE_DESCRIPTION);
    assertNoForbiddenCopy("loading", FAMILY_CARE_PLAN_LOADING);
    assertNoForbiddenCopy("retry", FAMILY_CARE_PLAN_RETRY);
    assertNoForbiddenCopy("empty title", FAMILY_CARE_PLAN_EMPTY_TITLE);
    assertNoForbiddenCopy("empty description", FAMILY_CARE_PLAN_EMPTY_DESCRIPTION);
    assertNoForbiddenCopy("no protocol lines", FAMILY_CARE_PLAN_NO_PROTOCOL_LINES);
    assertNoForbiddenCopy("footer helper", FAMILY_CARE_PLAN_FOOTER_HELPER);
    assertNoForbiddenCopy("not posted", FAMILY_CARE_PLAN_NOT_POSTED);
    assertNoForbiddenCopy("resident fallback", FAMILY_CARE_PLAN_RESIDENT_NAME_FALLBACK);

    expect(FAMILY_CARE_PLAN_PAGE_TITLE).toBe("Care plan");
    expect(FAMILY_CARE_PLAN_LOADING).toBe("Loading the care plan…");
    expect(FAMILY_CARE_PLAN_RETRY).toBe("Retry");
    expect(FAMILY_CARE_PLAN_EMPTY_TITLE).toBe("No care plan posted yet");
    expect(FAMILY_CARE_PLAN_PAGE_DESCRIPTION).toMatch(/read-only/i);
    expect(FAMILY_CARE_PLAN_PAGE_DESCRIPTION).toMatch(/care team/i);
    expect(FAMILY_CARE_PLAN_EMPTY_DESCRIPTION).toMatch(/care team shares a plan/i);
    expect(FAMILY_CARE_PLAN_FOOTER_HELPER).toMatch(/contact the facility by phone/i);
    expect(FAMILY_CARE_PLAN_FOOTER_HELPER).toMatch(/bulletin/i);
    expect(FAMILY_CARE_PLAN_NOT_POSTED).toBe("Not posted");
  });

  it("care plan page imports shared copy and has no family write affordances", () => {
    const source = fs.readFileSync(carePlanPagePath, "utf8");

    expect(source).toMatch(/FAMILY_CARE_PLAN_PAGE_TITLE/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_PAGE_DESCRIPTION/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_LOADING/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_RETRY/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_EMPTY_TITLE/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_EMPTY_DESCRIPTION/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_FOOTER_HELPER/);

    expect(source).not.toMatch(/Gathering care framework/i);
    expect(source).not.toMatch(/Retry Connection/i);
    expect(source).not.toMatch(/Your loved one/i);
    expect(source).not.toMatch(/ask a question/i);
    expect(source).not.toMatch(/textarea/);
    expect(source).not.toMatch(/postFamilyMessage/);
  });

  it("care plan data uses explicit not-posted copy instead of silent dashes", () => {
    const source = fs.readFileSync(carePlanDataPath, "utf8");

    expect(source).toMatch(/FAMILY_CARE_PLAN_NOT_POSTED/);
    expect(source).toMatch(/FAMILY_CARE_PLAN_RESIDENT_NAME_FALLBACK/);
    expect(source).not.toMatch(/Your loved one/);
  });

  it("family-portal-copy module keeps care plan strings free of brochure metaphors", () => {
    const source = fs.readFileSync(familyPortalCopyPath, "utf8");
    const carePlanBlock = source.slice(source.indexOf("FAMILY_CARE_PLAN_PAGE_TITLE"));

    for (const pattern of FORBIDDEN_CARE_PLAN_COPY) {
      expect(carePlanBlock).not.toMatch(pattern);
    }
    expect(carePlanBlock).toMatch(/read-only/i);
    expect(carePlanBlock).toMatch(/No care plan posted yet/);
  });
});
