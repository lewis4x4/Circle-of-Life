import { describe, expect, it } from "vitest";

import {
  CAREGIVER_TASKS_NO_SHIFT_COPY,
  formatCaregiverTasksShiftBucket,
} from "./tasks-display-copy";

const SHIFT_BUCKETS = ["day", "evening", "night"] as const;

describe("formatCaregiverTasksShiftBucket", () => {
  it("names the gap when timezone is missing or blank", () => {
    expect(formatCaregiverTasksShiftBucket(null)).toBe(CAREGIVER_TASKS_NO_SHIFT_COPY);
    expect(formatCaregiverTasksShiftBucket(undefined)).toBe(CAREGIVER_TASKS_NO_SHIFT_COPY);
    expect(formatCaregiverTasksShiftBucket("")).toBe(CAREGIVER_TASKS_NO_SHIFT_COPY);
    expect(formatCaregiverTasksShiftBucket("   ")).toBe(CAREGIVER_TASKS_NO_SHIFT_COPY);
    expect(formatCaregiverTasksShiftBucket(null)).not.toBe("—");
    expect(formatCaregiverTasksShiftBucket(undefined)).not.toBe("—");
  });

  it("returns an inferred shift bucket when facility timezone is posted", () => {
    const bucket = formatCaregiverTasksShiftBucket("America/New_York");
    expect(SHIFT_BUCKETS).toContain(bucket);
  });
});
