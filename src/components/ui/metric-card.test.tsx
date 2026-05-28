import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MetricCard, resolveMetricTone } from "./metric-card";

describe("resolveMetricTone", () => {
  it("returns default for invalid numeric input", () => {
    expect(resolveMetricTone(Number.NaN, { type: "critical-count" })).toBe("default");
    expect(resolveMetricTone(Number.POSITIVE_INFINITY, { type: "rate-percent" })).toBe("default");
    expect(resolveMetricTone(Number.NEGATIVE_INFINITY, { type: "overdue-count" })).toBe("default");
  });

  it("preserves critical-count thresholds", () => {
    expect(resolveMetricTone(0, { type: "critical-count" })).toBe("default");
    expect(resolveMetricTone(1, { type: "critical-count" })).toBe("danger");
  });

  it("preserves overdue-count thresholds", () => {
    expect(resolveMetricTone(0, { type: "overdue-count" })).toBe("default");
    expect(resolveMetricTone(1, { type: "overdue-count" })).toBe("warning");
    expect(resolveMetricTone(4, { type: "overdue-count" })).toBe("danger");
  });

  it("preserves rate-percent thresholds", () => {
    expect(resolveMetricTone(49.9, { type: "rate-percent" })).toBe("danger");
    expect(resolveMetricTone(50, { type: "rate-percent" })).toBe("warning");
    expect(resolveMetricTone(80, { type: "rate-percent" })).toBe("success");
  });

  it("lets thresholds override a caller supplied tone", () => {
    render(
      <MetricCard
        label="Critical alerts"
        value={1}
        tone="success"
        thresholds={{ type: "critical-count" }}
      />,
    );

    expect(screen.getByRole("article", { name: /critical alerts: 1/i })).toHaveClass(
      "border-destructive/40",
    );
  });
});
