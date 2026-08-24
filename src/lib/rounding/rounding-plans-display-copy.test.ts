import { describe, expect, it } from "vitest";

import {
  OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY,
  ROUNDING_PLAN_NO_DATE_COPY,
  ROUNDING_PLAN_NO_TIME_COPY,
  ROUNDING_PLANS_NO_FACILITY_NAME_COPY,
  formatRoundingPlanDateDisplay,
  formatRoundingPlanDateTimeDisplay,
  formatRoundingPlansFilterEmptyTitle,
  formatRoundingPlansNoPlansEmptyTitle,
  formatRoundingPlansPageSubtitle,
  resolveRoundingPlansFacilityScope,
} from "./rounding-plans-display-copy";

const EM_DASH = "—";

describe("formatRoundingPlanDateDisplay", () => {
  it("names missing effective dates instead of an em dash", () => {
    expect(formatRoundingPlanDateDisplay(null)).toBe(ROUNDING_PLAN_NO_DATE_COPY);
    expect(formatRoundingPlanDateDisplay(undefined)).toBe(ROUNDING_PLAN_NO_DATE_COPY);
    expect(formatRoundingPlanDateDisplay("")).toBe(ROUNDING_PLAN_NO_DATE_COPY);
    expect(formatRoundingPlanDateDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats posted ISO dates with short month and numeric day/year", () => {
    const formatted = formatRoundingPlanDateDisplay("2026-03-15");
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
  });
});

describe("formatRoundingPlanDateTimeDisplay", () => {
  it("names missing last-updated timestamps instead of an em dash", () => {
    expect(formatRoundingPlanDateTimeDisplay(null)).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatRoundingPlanDateTimeDisplay(undefined)).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatRoundingPlanDateTimeDisplay("")).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatRoundingPlanDateTimeDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats posted ISO datetimes with date and time", () => {
    const formatted = formatRoundingPlanDateTimeDisplay("2026-03-15T14:30:00.000Z");
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d/);
  });
});

describe("resolveRoundingPlansFacilityScope", () => {
  it("returns unscoped when no facility is selected", () => {
    expect(resolveRoundingPlansFacilityScope(null, null)).toEqual({ kind: "unscoped" });
  });

  it("returns missing_name when a facility id is selected without a resolved name", () => {
    expect(resolveRoundingPlansFacilityScope("fac-anon-1", undefined)).toEqual({
      kind: "missing_name",
    });
    expect(resolveRoundingPlansFacilityScope("fac-anon-1", "   ")).toEqual({
      kind: "missing_name",
    });
  });

  it("returns a named scope when the facility name resolves", () => {
    expect(resolveRoundingPlansFacilityScope("fac-anon-1", "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatRoundingPlansPageSubtitle", () => {
  it("uses the shared select-facility gap when unscoped", () => {
    const subtitle = formatRoundingPlansPageSubtitle({ kind: "unscoped" });
    expect(subtitle).toContain(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    const subtitle = formatRoundingPlansPageSubtitle({ kind: "missing_name" });
    expect(subtitle).toContain(ROUNDING_PLANS_NO_FACILITY_NAME_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at /);
  });

  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(
      formatRoundingPlansPageSubtitle({ kind: "named", name: "Anon Facility A" }),
    ).toBe(
      "Resident cadence rules, active observation windows, and shift-ready task generation at Anon Facility A.",
    );
  });
});

describe("formatRoundingPlansNoPlansEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(formatRoundingPlansNoPlansEmptyTitle({ kind: "named", name: "Anon Facility A" })).toBe(
      "No observation plans at Anon Facility A",
    );
  });

  it("names the select-facility gap when unscoped instead of fabricating a facility", () => {
    const title = formatRoundingPlansNoPlansEmptyTitle({ kind: "unscoped" });
    expect(title).toContain(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY);
    expect(title).not.toContain("selected facility");
    expect(title).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatRoundingPlansNoPlansEmptyTitle({ kind: "missing_name" })).toBe(
      "No observation plans posted",
    );
    expect(formatRoundingPlansNoPlansEmptyTitle({ kind: "missing_name" })).not.toContain(" at ");
  });
});

describe("formatRoundingPlansFilterEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(formatRoundingPlansFilterEmptyTitle({ kind: "named", name: "Anon Facility A" })).toBe(
      "No plans match this filter at Anon Facility A",
    );
  });

  it("names the select-facility gap when unscoped instead of fabricating a facility", () => {
    const title = formatRoundingPlansFilterEmptyTitle({ kind: "unscoped" });
    expect(title).toContain(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY);
    expect(title).not.toContain("selected facility");
    expect(title).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatRoundingPlansFilterEmptyTitle({ kind: "missing_name" })).toBe(
      "No plans match this filter",
    );
    expect(formatRoundingPlansFilterEmptyTitle({ kind: "missing_name" })).not.toContain(" at ");
  });
});
