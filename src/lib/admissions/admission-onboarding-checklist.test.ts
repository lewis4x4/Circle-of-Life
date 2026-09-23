import { describe, expect, it } from "vitest";

import { admissionOnboardingChecklist, EMPTY_ADMISSION_ONBOARDING_COUNTS } from "./admission-onboarding-checklist";

describe("admissionOnboardingChecklist (COL-649)", () => {
  it("marks an unread count as unknown, not missing", () => {
    const items = admissionOnboardingChecklist({ ...EMPTY_ADMISSION_ONBOARDING_COUNTS, medications: 2, payers: 0 });
    expect(items.map((i) => i.state)).toEqual(["unknown", "complete", "missing", "unknown"]);
  });
});
