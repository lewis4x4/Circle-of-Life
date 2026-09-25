import { describe, expect, it } from "vitest";

import {
  REPORT_RUN_ALL_FACILITIES_SCOPE_COPY,
  REPORT_RUN_NO_FACILITY_NAME_COPY,
  REPORT_RUN_NO_VALUE_POSTED_COPY,
  formatReportRunCellDisplay,
  formatReportRunScopeLabel,
} from "./report-run-display-copy";

const EM_DASH = "—";

describe("formatReportRunCellDisplay", () => {
  it("names null and undefined gaps", () => {
    expect(formatReportRunCellDisplay(null)).toBe(REPORT_RUN_NO_VALUE_POSTED_COPY);
    expect(formatReportRunCellDisplay(undefined)).toBe(REPORT_RUN_NO_VALUE_POSTED_COPY);
    expect(formatReportRunCellDisplay(null)).not.toBe(EM_DASH);
  });

  it("names empty string as a gap", () => {
    expect(formatReportRunCellDisplay("")).toBe(REPORT_RUN_NO_VALUE_POSTED_COPY);
  });

  it("keeps real zero as posted", () => {
    expect(formatReportRunCellDisplay(0)).toBe("0");
  });

  it("keeps boolean false as posted", () => {
    expect(formatReportRunCellDisplay(false)).toBe("false");
  });

  it("formats posted string and number values unchanged", () => {
    expect(formatReportRunCellDisplay("Oakridge")).toBe("Oakridge");
    expect(formatReportRunCellDisplay(42)).toBe("42");
    expect(formatReportRunCellDisplay("1,250.00")).toBe("1,250.00");
  });
});

describe("formatReportRunScopeLabel", () => {
  it("labels org-wide as All facilities", () => {
    expect(formatReportRunScopeLabel(null, "Homewood")).toBe(REPORT_RUN_ALL_FACILITIES_SCOPE_COPY);
    expect(formatReportRunScopeLabel(null, null)).toBe(REPORT_RUN_ALL_FACILITIES_SCOPE_COPY);
  });

  it("keeps a posted facility name", () => {
    expect(formatReportRunScopeLabel("fac-1", "Homewood Lodge")).toBe("Homewood Lodge");
  });

  it("names the gap without Selected facility when the name is missing", () => {
    expect(formatReportRunScopeLabel("fac-1", null)).toBe(REPORT_RUN_NO_FACILITY_NAME_COPY);
    expect(formatReportRunScopeLabel("fac-1", undefined)).toBe(REPORT_RUN_NO_FACILITY_NAME_COPY);
    expect(formatReportRunScopeLabel("fac-1", "   ")).toBe(REPORT_RUN_NO_FACILITY_NAME_COPY);
    expect(formatReportRunScopeLabel("fac-1", null)).not.toBe("Selected facility");
  });
});
