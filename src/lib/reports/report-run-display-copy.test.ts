import { describe, expect, it } from "vitest";

import {
  REPORT_RUN_NO_VALUE_POSTED_COPY,
  formatReportRunCellDisplay,
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
