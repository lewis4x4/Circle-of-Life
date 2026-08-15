import { describe, expect, it } from "vitest";

import {
  ROUNDING_REPORT_NO_VALUE_COPY,
  formatRoundingReportKpiValue,
} from "./rounding-reports-display-copy";

const EM_DASH = "—";

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
