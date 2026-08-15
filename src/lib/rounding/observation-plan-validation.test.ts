import { describe, expect, it } from "vitest";

import { ROUNDING_PLAN_NO_TIME_COPY } from "./rounding-plans-display-copy";
import {
  buildPlanSchedulePreview,
  formatTimeLabel,
  getObservationPlanSaveBlockers,
  getRuleChecksPerDay,
  validateEffectiveWindow,
  validateObservationPlanPayload,
  validatePlanRule,
} from "./observation-plan-validation";
import type { PlanRuleInput } from "./types";

const BASE_RULE: PlanRuleInput = {
  intervalType: "fixed_minutes",
  intervalMinutes: 60,
  daypartStart: "07:00",
  daypartEnd: "19:00",
  graceMinutes: 15,
  active: true,
  sortOrder: 0,
};

describe("formatTimeLabel", () => {
  it("names missing or unparseable HH:MM gaps", () => {
    expect(formatTimeLabel(null)).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatTimeLabel(undefined)).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatTimeLabel("")).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatTimeLabel("not-a-time")).toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatTimeLabel("25:00")).toBe(ROUNDING_PLAN_NO_TIME_COPY);
  });

  it("formats posted HH:MM with en-US hour and minute", () => {
    const formatted = formatTimeLabel("07:30");
    expect(formatted).not.toBe(ROUNDING_PLAN_NO_TIME_COPY);
    expect(formatted).toMatch(/\d/);
    expect(formatted).toMatch(/30/);
  });
});

describe("observation plan effective window validation", () => {
  it("allows an open-ended plan", () => {
    expect(validateEffectiveWindow("2026-05-18T08:00", "")).toBeNull();
    expect(validateEffectiveWindow("2026-05-18T08:00", null)).toBeNull();
  });

  it("requires effective to to be strictly after effective from", () => {
    expect(validateEffectiveWindow("2026-05-18T08:00", "2026-05-18T08:00")).toBe(
      "Effective to must be after Effective from.",
    );
    expect(validateEffectiveWindow("2026-05-18T08:00", "2026-05-18T07:59")).toBe(
      "Effective to must be after Effective from.",
    );
    expect(validateEffectiveWindow("2026-05-18T08:00", "2026-05-18T08:01")).toBeNull();
  });
});

describe("observation plan payload validation", () => {
  it("rejects malformed effective from dates before persistence", () => {
    expect(
      validateObservationPlanPayload({
        facilityId: "facility-1",
        residentId: "resident-1",
        status: "draft",
        sourceType: "manual",
        effectiveFrom: "not-a-date",
        rationale: "Resident cadence changed because clinical monitoring needs were reassessed.",
        rules: [BASE_RULE],
      }),
    ).toEqual(["effectiveFrom must be a valid date."]);
  });
});

describe("observation plan save blockers", () => {
  it("blocks save until required clinical provenance fields are present", () => {
    expect(
      getObservationPlanSaveBlockers({
        residentId: "",
        status: "draft",
        sourceType: "manual",
        effectiveFrom: "",
        rationale: "too short",
        rules: [BASE_RULE],
      }),
    ).toEqual(["Select resident", "Set effective from", "Add 30+ character rationale"]);
  });
});

describe("observation plan rule validation", () => {
  it("enforces interval and grace bounds", () => {
    expect(validatePlanRule({ ...BASE_RULE, intervalMinutes: 4 }).intervalMinutes).toBe(
      "Interval minutes must be between 5 and 1440.",
    );
    expect(validatePlanRule({ ...BASE_RULE, intervalMinutes: 1_441 }).intervalMinutes).toBe(
      "Interval minutes must be between 5 and 1440.",
    );
    expect(validatePlanRule({ ...BASE_RULE, intervalMinutes: 30, graceMinutes: 30 }).graceMinutes).toBe(
      "Grace minutes must be less than interval minutes.",
    );
    expect(validatePlanRule({ ...BASE_RULE, intervalMinutes: 30, graceMinutes: 29 })).toEqual({});
  });

  it("rejects legacy migration 219 12-hour facility defaults", () => {
    expect(validatePlanRule({ ...BASE_RULE, intervalMinutes: 720 }).intervalMinutes).toBe(
      "12-hour (720 minute) facility defaults are retired. Use Jessica discovery-round cadence instead.",
    );
  });

  it("computes overnight interval checks for Homewood two-hour night cadence", () => {
    const homewoodNightRule: PlanRuleInput = {
      intervalType: "fixed_minutes",
      intervalMinutes: 120,
      shift: "night",
      daypartStart: "18:00",
      daypartEnd: "06:00",
      graceMinutes: 30,
      active: true,
      sortOrder: 0,
    };

    expect(getRuleChecksPerDay(homewoodNightRule)).toBe(7);
  });
});

describe("observation plan preview", () => {
  it("computes checks per day using daypart duration and interval", () => {
    expect(getRuleChecksPerDay(BASE_RULE)).toBe(13);
  });

  it("ignores inactive rules", () => {
    const preview = buildPlanSchedulePreview([{ ...BASE_RULE, active: false }], new Date(2026, 0, 1, 6, 30));

    expect(preview.checksPerDay).toBe(0);
    expect(preview.nextChecks).toHaveLength(0);
  });

  it("returns the first twelve checks in the next 24 hours", () => {
    const preview = buildPlanSchedulePreview([BASE_RULE], new Date(2026, 0, 1, 6, 30));

    expect(preview.checksPerDay).toBe(13);
    expect(preview.windowStart).toBe("07:00");
    expect(preview.windowEnd).toBe("19:00");
    expect(preview.nextChecks).toHaveLength(12);
    expect(preview.nextChecks[0]?.getHours()).toBe(7);
    expect(preview.nextChecks[11]?.getHours()).toBe(18);
  });
});
