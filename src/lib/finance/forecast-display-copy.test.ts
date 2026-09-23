import { describe, expect, it } from "vitest";

import {
  FORECAST_NOTHING_SENT_COPY,
  forecastBilledValue,
  forecastCollectedValue,
  forecastDaysCell,
  forecastDaysValue,
  forecastDsoAccent,
  forecastDsoDetail,
  forecastPctValue,
  forecastRunRateValue,
} from "./forecast-display-copy";

describe("forecast display copy (COL-650)", () => {
  it("never prints 0.0d or 0.0% for a figure that has no billing behind it", () => {
    expect(forecastDaysValue(null)).toBe("Not measurable");
    expect(forecastPctValue(null)).toBe("Not measurable");
    expect(forecastDaysCell(null)).toBe("No billing");
    expect(forecastDaysValue(12.34)).toBe("12.3d");
    expect(forecastPctValue(0)).toBe("0.0%");
  });

  it("says nothing was sent instead of Trailing 90d billed $0.00", () => {
    expect(forecastBilledValue(0, 0)).toBe("Nothing sent");
    expect(forecastBilledValue(0, 2)).toBe("$0.00");
    expect(forecastDsoDetail(null, 0)).toBe(FORECAST_NOTHING_SENT_COPY);
    expect(forecastDsoDetail(30, 3)).toBe("Projected 30d 30.0d");
  });

  it("says no payments are recorded instead of $0.00 collected", () => {
    expect(forecastCollectedValue(0, 0)).toBe("No payments recorded");
    expect(forecastCollectedValue(5_000, 1)).toBe("$50.00");
  });

  it("names a missing run-rate source", () => {
    expect(forecastRunRateValue(0, 0, "No approved time")).toBe("No approved time");
    expect(forecastRunRateValue(0, 4, "No approved time")).toBe("$0.00");
  });

  it("does not colour a missing DSO as improving", () => {
    expect(forecastDsoAccent(null, null)).toBe("indigo");
    expect(forecastDsoAccent(40, 45)).toBe("amber");
    expect(forecastDsoAccent(45, 40)).toBe("emerald");
  });
});
