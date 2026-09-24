import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_READING_TABS, requiredReadingTab } from "@/lib/caregiver/required-reading";
import { LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

const CAREGIVER = path.resolve(import.meta.dirname, "../../app/(caregiver)/caregiver");

describe("floor-app Required reading (COL-707)", () => {
  it("has two tabs, documents to sign first and policies second", () => {
    expect(REQUIRED_READING_TABS.map((t) => t.label)).toEqual(["To sign", "Policies"]);
    expect(requiredReadingTab("policies")).toBe("policies");
    expect(requiredReadingTab(null)).toBe("sign");
  });

  it("308s the old policies list to the Policies tab and keeps the policy detail page", () => {
    expect(LEGACY_REDIRECTS).toContainEqual({
      source: "/caregiver/policies",
      destination: "/caregiver/acknowledgments?tab=policies",
      permanent: true,
    });
    expect(existsSync(path.join(CAREGIVER, "policies/page.tsx"))).toBe(false);
    expect(existsSync(path.join(CAREGIVER, "policies/[id]/page.tsx"))).toBe(true);
  });

  it("nothing in the floor app still links to the old policies list", () => {
    const me = readFileSync(path.resolve(import.meta.dirname, "../../app/(caregiver)/me/page.tsx"), "utf8");
    expect(me).not.toContain('"/caregiver/policies"');
  });

  it("renders both lists on the acknowledgments page", () => {
    const page = readFileSync(path.join(CAREGIVER, "acknowledgments/page.tsx"), "utf8");
    expect(page).toContain("<CaregiverPendingPoliciesList />");
    expect(page).toContain("<MyAcknowledgmentsPage />");
  });
});
