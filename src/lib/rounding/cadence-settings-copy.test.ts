import { describe, expect, it } from "vitest";

import { formatMetric } from "@/lib/metrics/metric-state";
import { formatSpanMinutes } from "@/lib/rounding/cadence-settings";

import { cadenceNowHint, cadenceShapeMetric, NO_SCHEDULE_IN_FORCE } from "./cadence-settings-copy";

describe("cadence tiles with no schedule in force (COL-649)", () => {
  it("does not show a 0-minute longest unobserved span when there is no schedule", () => {
    expect(formatMetric(cadenceShapeMetric(undefined), formatSpanMinutes)).toBe(NO_SCHEDULE_IN_FORCE);
    expect(cadenceNowHint(null, formatSpanMinutes)).toBe("Now: no schedule in force");
  });

  it("formats a real shape", () => {
    expect(formatMetric(cadenceShapeMetric(6))).toBe("6");
    expect(cadenceNowHint(6)).toBe("Now 6");
  });
});
