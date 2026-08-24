import { describe, expect, it } from "vitest";

import {
  ESCALATIONS_ET_TIMEZONE_CUE,
  ESCALATIONS_NO_FACILITY_NAME_COPY,
  ESCALATIONS_SELECT_FACILITY_FIRST_COPY,
  formatEscalationsDateTimeEt,
  formatEscalationsLoadingNotice,
  formatEscalationsNoFacilityInterstitialBody,
  formatEscalationsNoOpenEmptyTitle,
  formatEscalationsPageSubtitle,
  resolveEscalationsFacilityScope,
} from "./escalations-display-copy";

describe("resolveEscalationsFacilityScope", () => {
  it("returns unscoped when no facility is selected", () => {
    expect(resolveEscalationsFacilityScope(null, null)).toEqual({ kind: "unscoped" });
  });

  it("returns missing_name when a facility id is selected without a resolved name", () => {
    expect(resolveEscalationsFacilityScope("fac-anon-1", undefined)).toEqual({
      kind: "missing_name",
    });
    expect(resolveEscalationsFacilityScope("fac-anon-1", "   ")).toEqual({
      kind: "missing_name",
    });
  });

  it("returns a named scope for the header subtitle", () => {
    expect(resolveEscalationsFacilityScope("fac-anon-1", "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatEscalationsPageSubtitle", () => {
  it("uses the shared select-facility gap when unscoped", () => {
    const subtitle = formatEscalationsPageSubtitle({ kind: "unscoped" });
    expect(subtitle).toContain(ESCALATIONS_SELECT_FACILITY_FIRST_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    const subtitle = formatEscalationsPageSubtitle({ kind: "missing_name" });
    expect(subtitle).toContain(ESCALATIONS_NO_FACILITY_NAME_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at /);
  });

  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(
      formatEscalationsPageSubtitle({ kind: "named", name: "Anon Facility A" }),
    ).toBe(
      "Missed or overdue checks requiring operator review and survey-ready resolution at Anon Facility A.",
    );
  });
});

describe("formatEscalationsNoFacilityInterstitialBody", () => {
  it("reuses the shared select-facility gap copy", () => {
    expect(formatEscalationsNoFacilityInterstitialBody()).toBe(
      ESCALATIONS_SELECT_FACILITY_FIRST_COPY,
    );
    expect(formatEscalationsNoFacilityInterstitialBody()).not.toContain("selected facility");
  });
});

describe("formatEscalationsNoOpenEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(formatEscalationsNoOpenEmptyTitle({ kind: "named", name: "Anon Facility A" })).toBe(
      "No open escalations at Anon Facility A",
    );
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatEscalationsNoOpenEmptyTitle({ kind: "missing_name" })).toBe(
      "No open escalations posted",
    );
    expect(formatEscalationsNoOpenEmptyTitle({ kind: "missing_name" })).not.toContain(" at ");
  });
});

describe("formatEscalationsLoadingNotice", () => {
  it("names the loading state for the escalations board", () => {
    expect(formatEscalationsLoadingNotice()).toBe("Loading escalations…");
  });
});

describe("formatEscalationsDateTimeEt", () => {
  it("formats parseable timestamps in America/New_York", () => {
    const formatted = formatEscalationsDateTimeEt("2026-08-15T16:30:00.000Z");
    const expected = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(new Date("2026-08-15T16:30:00.000Z"));
    expect(formatted).toBe(expected);
  });

  it("names a missing timestamp instead of fabricating a value", () => {
    expect(formatEscalationsDateTimeEt(null)).toBe("No time posted");
    expect(formatEscalationsDateTimeEt("")).toBe("No time posted");
    expect(formatEscalationsDateTimeEt("not-a-date")).toBe("No time posted");
  });
});

describe("ESCALATIONS_ET_TIMEZONE_CUE", () => {
  it("states that escalation times use Eastern (ET)", () => {
    expect(ESCALATIONS_ET_TIMEZONE_CUE).toContain("Eastern (ET)");
  });
});
