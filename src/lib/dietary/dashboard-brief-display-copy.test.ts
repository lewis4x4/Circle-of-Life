import { describe, expect, it } from "vitest";

import {
  DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
  DIETARY_DASHBOARD_BRIEF_NO_RESIDENT_COPY,
  formatDietaryDashboardBriefResidentName,
} from "./dashboard-brief-display-copy";

const EM_DASH = "—";

describe("formatDietaryDashboardBriefResidentName", () => {
  it("names a missing resident join instead of Unknown", () => {
    expect(formatDietaryDashboardBriefResidentName(null)).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_RESIDENT_COPY,
    );
    expect(formatDietaryDashboardBriefResidentName(undefined)).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_RESIDENT_COPY,
    );
    expect(formatDietaryDashboardBriefResidentName(null)).not.toBe("Unknown");
  });

  it("names a blank resident name instead of inventing one", () => {
    expect(formatDietaryDashboardBriefResidentName({ first_name: null, last_name: null })).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
    );
    expect(formatDietaryDashboardBriefResidentName({ first_name: "", last_name: "" })).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
    );
    expect(formatDietaryDashboardBriefResidentName({ first_name: "   ", last_name: "  " })).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
    );
  });

  it("names an em dash resident name instead of a silent dash", () => {
    expect(formatDietaryDashboardBriefResidentName({ first_name: EM_DASH, last_name: null })).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
    );
    expect(
      formatDietaryDashboardBriefResidentName({ first_name: `  ${EM_DASH}  `, last_name: "" }),
    ).toBe(DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY);
    expect(formatDietaryDashboardBriefResidentName({ first_name: EM_DASH, last_name: null })).not.toBe(
      EM_DASH,
    );
  });

  it("maps legacy Unknown display to the named gap copy", () => {
    expect(formatDietaryDashboardBriefResidentName({ first_name: "Unknown", last_name: null })).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
    );
    expect(formatDietaryDashboardBriefResidentName({ first_name: "  Unknown  ", last_name: "" })).toBe(
      DIETARY_DASHBOARD_BRIEF_NO_NAME_COPY,
    );
    expect(formatDietaryDashboardBriefResidentName({ first_name: "Unknown", last_name: null })).not.toBe(
      "Unknown",
    );
  });

  it("returns posted first and last names trimmed as-is", () => {
    expect(formatDietaryDashboardBriefResidentName({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(
      formatDietaryDashboardBriefResidentName({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Jordan Lee");
  });
});
