import { describe, expect, it } from "vitest";

import { formatMetricValue } from "./metric-presentation";
import { REPORTS_NO_METRIC_VALUE_COPY } from "./reports-display-copy";

const EM_DASH = "—";

describe("formatMetricValue", () => {
  it("names missing metric values instead of an em dash", () => {
    expect(formatMetricValue(null, "integer")).toBe(REPORTS_NO_METRIC_VALUE_COPY);
    expect(formatMetricValue(undefined, "integer")).toBe(REPORTS_NO_METRIC_VALUE_COPY);
    expect(formatMetricValue("", "integer")).toBe(REPORTS_NO_METRIC_VALUE_COPY);
    expect(formatMetricValue("   ", "percent")).toBe(REPORTS_NO_METRIC_VALUE_COPY);
    expect(formatMetricValue(null, "integer")).not.toBe(EM_DASH);
  });

  it("keeps posted numeric zero unchanged", () => {
    expect(formatMetricValue(0, "integer")).toBe("0");
    expect(formatMetricValue(0, "percent")).toBe("0%");
    expect(formatMetricValue(0, "currency_cents")).toBe("$0.00");
    expect(formatMetricValue(0, "decimal")).toBe("0");
  });

  it("keeps posted non-zero numeric values unchanged", () => {
    expect(formatMetricValue(42, "integer")).toBe("42");
    expect(formatMetricValue(12.5, "percent")).toBe("12.5%");
    expect(formatMetricValue(1250, "currency_cents")).toBe("$12.50");
  });

  it("keeps posted text values unchanged including blank strings", () => {
    expect(formatMetricValue("Posted label", "text")).toBe("Posted label");
    expect(formatMetricValue("", "text")).toBe("");
    expect(formatMetricValue("   ", "text")).toBe("   ");
  });
});
