import { describe, expect, it } from "vitest";

import {
  ADMISSIONS_HUB_MISSING_DATE_COPY,
  ADMISSIONS_HUB_NO_NAME_COPY,
  ADMISSIONS_HUB_NO_RESIDENT_COPY,
  admissionsHubMetricLoadingCopy,
  admissionsHubMetricNoFacilityCopy,
  admissionsHubMetricValue,
  admissionsHubNoFacilityNotice,
  admissionsHubScopedEmptyNotice,
  admissionsHubScopeLabel,
  formatAdmissionsHubConferenceScheduledDate,
  formatAdmissionsHubMedicaidStage,
  formatAdmissionsHubReferralSource,
  formatAdmissionsHubRelativeDate,
  formatAdmissionsHubResidentName,
  formatAdmissionsHubTargetMoveInDate,
  formatAdmissionsHubTargetMoveInDateValue,
} from "./admissions-hub-display-copy";

const REF = new Date("2026-08-15T12:00:00.000Z");

describe("formatAdmissionsHubRelativeDate", () => {
  it("names a missing date instead of an em dash", () => {
    expect(formatAdmissionsHubRelativeDate(null, REF)).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
    expect(formatAdmissionsHubRelativeDate("", REF)).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
    expect(formatAdmissionsHubRelativeDate("   ", REF)).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
  });

  it("names an invalid timestamp instead of an em dash", () => {
    expect(formatAdmissionsHubRelativeDate("not-a-date", REF)).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
  });

  it("formats minutes, hours, and days ago", () => {
    expect(formatAdmissionsHubRelativeDate("2026-08-15T11:30:00.000Z", REF)).toBe("30m ago");
    expect(formatAdmissionsHubRelativeDate("2026-08-15T06:00:00.000Z", REF)).toBe("6h ago");
    expect(formatAdmissionsHubRelativeDate("2026-08-12T12:00:00.000Z", REF)).toBe("3d ago");
  });

  it("falls back to a short calendar date after one week", () => {
    expect(formatAdmissionsHubRelativeDate("2026-07-01T12:00:00.000Z", REF)).toMatch(/Jul/);
  });

  it("never returns an em dash", () => {
    const samples = [null, "", "invalid", "2026-08-15T11:00:00.000Z", "2026-01-01T00:00:00.000Z"];
    for (const sample of samples) {
      expect(formatAdmissionsHubRelativeDate(sample, REF)).not.toBe("—");
    }
  });
});

describe("admissionsHubMetricValue", () => {
  it("names the facility gap before loading or counts", () => {
    expect(admissionsHubMetricValue(4, { noFacility: true, loading: false })).toBe(
      admissionsHubMetricNoFacilityCopy(),
    );
  });

  it("names a loading gap before showing counts", () => {
    expect(admissionsHubMetricValue(4, { noFacility: false, loading: true })).toBe(
      admissionsHubMetricLoadingCopy(),
    );
  });

  it("keeps real zeros once loaded", () => {
    expect(admissionsHubMetricValue(0, { noFacility: false, loading: false })).toBe(0);
  });
});

describe("formatAdmissionsHubConferenceScheduledDate", () => {
  it("names a missing schedule instead of inventing a day", () => {
    expect(formatAdmissionsHubConferenceScheduledDate(null)).toBe("No date scheduled");
    expect(formatAdmissionsHubConferenceScheduledDate("")).toBe("No date scheduled");
  });

  it("formats a valid scheduled start", () => {
    expect(formatAdmissionsHubConferenceScheduledDate("2026-08-24T15:00:00.000Z")).toMatch(/Aug/);
  });
});

describe("formatAdmissionsHubMedicaidStage", () => {
  it("names an unset stage", () => {
    expect(formatAdmissionsHubMedicaidStage(null)).toBe("Not set");
  });
});

describe("formatAdmissionsHubTargetMoveInDate", () => {
  it("names a missing target date", () => {
    expect(formatAdmissionsHubTargetMoveInDate(null)).toBe("No target move-in date");
  });

  it("prefixes a real target date", () => {
    expect(formatAdmissionsHubTargetMoveInDate("2026-08-24")).toBe("Target: 2026-08-24");
  });
});

describe("formatAdmissionsHubTargetMoveInDateValue", () => {
  it("names a missing target date without a Target prefix", () => {
    expect(formatAdmissionsHubTargetMoveInDateValue(null)).toBe("No target move-in date");
    expect(formatAdmissionsHubTargetMoveInDateValue("")).toBe("No target move-in date");
  });

  it("returns the raw date when set", () => {
    expect(formatAdmissionsHubTargetMoveInDateValue("2026-08-24")).toBe("2026-08-24");
  });

  it("never returns an em dash", () => {
    expect(formatAdmissionsHubTargetMoveInDateValue(null)).not.toBe("—");
  });
});

describe("formatAdmissionsHubReferralSource", () => {
  it("names a missing source instead of an em dash", () => {
    expect(formatAdmissionsHubReferralSource(null)).toBe("No source");
    expect(formatAdmissionsHubReferralSource("")).toBe("No source");
  });

  it("keeps a real source name", () => {
    expect(formatAdmissionsHubReferralSource("Hospital discharge planner")).toBe(
      "Hospital discharge planner",
    );
  });
});

describe("formatAdmissionsHubResidentName", () => {
  it("names a missing resident join", () => {
    expect(formatAdmissionsHubResidentName(null)).toBe(ADMISSIONS_HUB_NO_RESIDENT_COPY);
    expect(formatAdmissionsHubResidentName(undefined)).toBe(ADMISSIONS_HUB_NO_RESIDENT_COPY);
  });

  it("names a blank posted name", () => {
    expect(formatAdmissionsHubResidentName({ first_name: "", last_name: "" })).toBe(
      ADMISSIONS_HUB_NO_NAME_COPY,
    );
    expect(formatAdmissionsHubResidentName({ first_name: "   ", last_name: "  " })).toBe(
      ADMISSIONS_HUB_NO_NAME_COPY,
    );
  });

  it("names an em dash placeholder", () => {
    expect(formatAdmissionsHubResidentName({ first_name: "—", last_name: "" })).toBe(
      ADMISSIONS_HUB_NO_NAME_COPY,
    );
  });

  it.each([
    ["Unknown", ""],
    ["Unknown resident", ""],
    ["Unknown", "resident"],
    ["Unknown", "Resident"],
    ["Unnamed", ""],
    ["Unnamed resident", ""],
    ["Unnamed", "resident"],
  ] as const)("names legacy generic placeholder %j %j", (first_name, last_name) => {
    expect(formatAdmissionsHubResidentName({ first_name, last_name })).toBe(
      ADMISSIONS_HUB_NO_NAME_COPY,
    );
  });

  it("keeps a posted name", () => {
    expect(formatAdmissionsHubResidentName({ first_name: "Posted", last_name: "Record" })).toBe(
      "Posted Record",
    );
    expect(formatAdmissionsHubResidentName({ first_name: "Posted", last_name: "" })).toBe("Posted");
    expect(formatAdmissionsHubResidentName({ first_name: "", last_name: "Record" })).toBe("Record");
  });

  it("never returns legacy generic strings or an em dash", () => {
    const samples = [
      null,
      undefined,
      { first_name: "", last_name: "" },
      { first_name: "—", last_name: "" },
      { first_name: "Unknown", last_name: "resident" },
      { first_name: "Posted", last_name: "Record" },
    ] as const;
    const forbidden = ["—", "Unknown", "Unknown resident", "Unknown Resident"];
    for (const sample of samples) {
      const result = formatAdmissionsHubResidentName(sample);
      for (const bad of forbidden) {
        expect(result).not.toBe(bad);
      }
    }
  });
});

describe("admissionsHubScopedEmptyNotice", () => {
  it("keeps the honest empty-scope meaning", () => {
    expect(admissionsHubScopedEmptyNotice("this week")).toContain("Nothing updated in this scope");
    expect(admissionsHubScopedEmptyNotice("this week")).toContain("outside this window");
  });
});

describe("admissionsHubScopeLabel", () => {
  it("maps hub scope keys to readable labels", () => {
    expect(admissionsHubScopeLabel("today")).toBe("today");
    expect(admissionsHubScopeLabel("week")).toBe("this week");
    expect(admissionsHubScopeLabel("month")).toBe("this month");
  });
});

describe("admissionsHubNoFacilityNotice", () => {
  it("tells trainers to pick a facility in the header", () => {
    expect(admissionsHubNoFacilityNotice()).toContain("Select a facility");
  });
});
