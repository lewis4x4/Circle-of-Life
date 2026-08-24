import { describe, expect, it } from "vitest";

import {
  ROUNDING_REPORT_NO_VALUE_COPY,
  ROUNDING_REPORTS_NO_FACILITY_NAME_COPY,
  ROUNDING_REPORTS_SELECT_FACILITY_FIRST_COPY,
  formatRoundingReportKpiValue,
  formatRoundingReportsPageSubtitle,
  resolveRoundingReportsFacilityScope,
} from "./rounding-reports-display-copy";

const EM_DASH = "—";

describe("resolveRoundingReportsFacilityScope", () => {
  it("returns unscoped when no facility is selected", () => {
    expect(resolveRoundingReportsFacilityScope(null, null)).toEqual({ kind: "unscoped" });
  });

  it("returns missing_name when a facility id is selected without a resolved name", () => {
    expect(resolveRoundingReportsFacilityScope("fac-anon-1", undefined)).toEqual({
      kind: "missing_name",
    });
    expect(resolveRoundingReportsFacilityScope("fac-anon-1", "   ")).toEqual({
      kind: "missing_name",
    });
  });

  it("returns a named scope when the facility name resolves", () => {
    expect(resolveRoundingReportsFacilityScope("fac-anon-1", "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatRoundingReportsPageSubtitle", () => {
  it("uses the shared select-facility gap when unscoped", () => {
    const subtitle = formatRoundingReportsPageSubtitle({ kind: "unscoped" });
    expect(subtitle).toContain(ROUNDING_REPORTS_SELECT_FACILITY_FIRST_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    const subtitle = formatRoundingReportsPageSubtitle({ kind: "missing_name" });
    expect(subtitle).toContain(ROUNDING_REPORTS_NO_FACILITY_NAME_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at /);
  });

  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(
      formatRoundingReportsPageSubtitle({ kind: "named", name: "Anon Facility A" }),
    ).toBe(
      "Pre-configured exportable summaries for surveyor packets, internal QA, and executive review at Anon Facility A.",
    );
  });
});

describe("formatRoundingReportKpiValue", () => {
  it("names an empty window instead of an em dash", () => {
    expect(formatRoundingReportKpiValue(false, "87%")).toBe(ROUNDING_REPORT_NO_VALUE_COPY);
    expect(formatRoundingReportKpiValue(false, "12")).toBe(ROUNDING_REPORT_NO_VALUE_COPY);
    expect(formatRoundingReportKpiValue(false, EM_DASH)).toBe(ROUNDING_REPORT_NO_VALUE_COPY);
    expect(formatRoundingReportKpiValue(false, "0%")).toBe(ROUNDING_REPORT_NO_VALUE_COPY);
    expect(formatRoundingReportKpiValue(false, "0")).toBe(ROUNDING_REPORT_NO_VALUE_COPY);
    expect(formatRoundingReportKpiValue(false, "87%")).not.toBe(EM_DASH);
  });

  it("keeps posted KPI values unchanged, including real zeros", () => {
    expect(formatRoundingReportKpiValue(true, "0%")).toBe("0%");
    expect(formatRoundingReportKpiValue(true, "0")).toBe("0");
    expect(formatRoundingReportKpiValue(true, "87%")).toBe("87%");
    expect(formatRoundingReportKpiValue(true, "12")).toBe("12");
  });
});
