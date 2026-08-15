import { describe, expect, it } from "vitest";

import {
  ADMISSIONS_HUB_MISSING_DATE_COPY,
  admissionsHubMetricLoadingCopy,
  admissionsHubMetricNoFacilityCopy,
  admissionsHubMetricValue,
  admissionsHubNoFacilityNotice,
  admissionsHubScopedEmptyNotice,
  admissionsHubScopeLabel,
  formatAdmissionsHubConferenceScheduledDate,
  formatAdmissionsHubMedicaidStage,
  formatAdmissionsHubRelativeDate,
  formatAdmissionsHubTargetMoveInDate,
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
