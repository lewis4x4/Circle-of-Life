import { describe, expect, it } from "vitest";

import {
  resolveThresholdState,
  thresholdStateToToneClass,
} from "./thresholds";

describe("resolveThresholdState — direction up (higher is better)", () => {
  const spec = { target: 90, direction: "up" as const, warningBandPct: 10 };

  it("returns ok at or above target", () => {
    expect(resolveThresholdState(90, spec)).toBe("ok");
    expect(resolveThresholdState(95, spec)).toBe("ok");
    expect(resolveThresholdState(120, spec)).toBe("ok");
  });

  it("returns warning within the band below target", () => {
    expect(resolveThresholdState(85, spec)).toBe("warning");
    expect(resolveThresholdState(81, spec)).toBe("warning");
  });

  it("returns critical below the warning band", () => {
    // band = 90 * 10% = 9 → warning zone is [81, 90); 80 falls below.
    expect(resolveThresholdState(80, spec)).toBe("critical");
    expect(resolveThresholdState(79, spec)).toBe("critical");
    expect(resolveThresholdState(0, spec)).toBe("critical");
  });
});

describe("resolveThresholdState — direction down (lower is better)", () => {
  const spec = { target: 8, direction: "down" as const, warningBandPct: 25 };

  it("returns ok at or below target", () => {
    expect(resolveThresholdState(8, spec)).toBe("ok");
    expect(resolveThresholdState(5, spec)).toBe("ok");
  });

  it("returns warning within the band above target", () => {
    expect(resolveThresholdState(9, spec)).toBe("warning");
    expect(resolveThresholdState(10, spec)).toBe("warning");
  });

  it("returns critical above the warning band", () => {
    expect(resolveThresholdState(11, spec)).toBe("critical");
    expect(resolveThresholdState(50, spec)).toBe("critical");
  });
});

describe("resolveThresholdState — edge cases", () => {
  it("returns no-threshold when spec is undefined", () => {
    expect(resolveThresholdState(50, undefined)).toBe("no-threshold");
  });

  it("returns no-threshold when value is non-finite", () => {
    expect(resolveThresholdState(Number.NaN, { target: 10, direction: "up" })).toBe(
      "no-threshold",
    );
    expect(
      resolveThresholdState(Number.POSITIVE_INFINITY, {
        target: 10,
        direction: "down",
      }),
    ).toBe("no-threshold");
  });

  it("uses default 10% band when warningBandPct is omitted", () => {
    const spec = { target: 100, direction: "up" as const };
    expect(resolveThresholdState(95, spec)).toBe("warning"); // within 10%
    expect(resolveThresholdState(89, spec)).toBe("critical"); // below 10%
  });

  it("treats warningBandPct=0 as no warning zone", () => {
    const spec = { target: 100, direction: "up" as const, warningBandPct: 0 };
    expect(resolveThresholdState(99, spec)).toBe("critical");
    expect(resolveThresholdState(100, spec)).toBe("ok");
  });
});

describe("thresholdStateToToneClass", () => {
  it("maps states to semantic tone classes", () => {
    expect(thresholdStateToToneClass("ok")).toBe("text-success");
    expect(thresholdStateToToneClass("warning")).toBe("text-warning");
    expect(thresholdStateToToneClass("critical")).toBe("text-danger");
    expect(thresholdStateToToneClass("no-threshold")).toBe("text-text-primary");
  });
});
