import { describe, expect, it } from "vitest";

import {
  ROUNDING_PLAN_NO_DATE_COPY,
  ROUNDING_PLAN_NO_TIME_COPY,
  formatRoundingPlanDateDisplay,
  formatRoundingPlanDateTimeDisplay,
} from "./rounding-plans-display-copy";

const EM_DASH = "—";

describe("formatRoundingPlanDateDisplay", () => {
  it("names missing effective dates instead of an em dash", () => {
    expect(formatRoundingPlanDateDisplay(null)).toBe(ROUNDING_PLAN_NO_DATE_COPY);
    expect(formatRoundingPlanDateDisplay(undefined)).toBe(ROUNDING_PLAN_NO_DATE_COPY);
    expect(formatRoundingPlanDateDisplay("")).toBe(ROUNDING_PLAN_NO_DATE_COPY);
    expect(formatRoundingPlanDateDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats posted ISO dates with short month and numeric day/year", () => {
    const formatted = formatRoundingPlanDateDisplay("2026-03-15");
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
  });
});

describe("formatRoundingPlanDateTimeDisplay", () => {
  it("names missing last-updated timestamps instead of an em dash", () => {
    expect(formatRoundingPlanDateTimeDisplay(null)).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatRoundingPlanDateTimeDisplay(undefined)).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatRoundingPlanDateTimeDisplay("")).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatRoundingPlanDateTimeDisplay(null)).not.toBe(EM_DASH);
  });

  it("formats posted ISO datetimes with date and time", () => {
    const formatted = formatRoundingPlanDateTimeDisplay("2026-03-15T14:30:00.000Z");
    expect(formatted).toMatch(/Mar/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d/);
  });
});
