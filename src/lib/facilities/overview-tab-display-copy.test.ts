import { describe, expect, it } from "vitest";

import {
  OVERVIEW_TAB_NO_EMAIL_COPY,
  formatFacilityOverviewEmail,
} from "./overview-tab-display-copy";

const EM_DASH = "—";

describe("formatFacilityOverviewEmail", () => {
  it("names a missing email instead of an em dash", () => {
    expect(formatFacilityOverviewEmail(null)).toBe(OVERVIEW_TAB_NO_EMAIL_COPY);
    expect(formatFacilityOverviewEmail(undefined)).toBe(OVERVIEW_TAB_NO_EMAIL_COPY);
    expect(formatFacilityOverviewEmail("")).toBe(OVERVIEW_TAB_NO_EMAIL_COPY);
    expect(formatFacilityOverviewEmail("   ")).toBe(OVERVIEW_TAB_NO_EMAIL_COPY);
    expect(formatFacilityOverviewEmail(EM_DASH)).toBe(OVERVIEW_TAB_NO_EMAIL_COPY);
    expect(formatFacilityOverviewEmail(`  ${EM_DASH}  `)).toBe(OVERVIEW_TAB_NO_EMAIL_COPY);
    expect(formatFacilityOverviewEmail(null)).not.toBe(EM_DASH);
  });

  it("returns a posted email trimmed", () => {
    expect(formatFacilityOverviewEmail("  contact@example.org  ")).toBe("contact@example.org");
  });
});
