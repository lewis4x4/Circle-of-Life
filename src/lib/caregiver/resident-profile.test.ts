import { describe, expect, it } from "vitest";

import { CAREGIVER_RESIDENT_NO_ACUITY_COPY } from "./resident-detail-display-copy";
import { acuityDisplay } from "./resident-profile";

describe("acuityDisplay", () => {
  it("names the gap when acuity is missing", () => {
    expect(acuityDisplay(null)).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
    expect(acuityDisplay("")).toBe(CAREGIVER_RESIDENT_NO_ACUITY_COPY);
  });

  it("rewrites posted level_* values to Level labels", () => {
    expect(acuityDisplay("level_3")).toBe("Level 3");
  });
});
