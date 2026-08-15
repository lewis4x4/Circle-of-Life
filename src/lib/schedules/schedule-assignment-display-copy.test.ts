import { describe, expect, it } from "vitest";

import {
  SCHEDULE_ASSIGNMENT_NO_STAFF_COPY,
  formatScheduleAssignmentStaffDisplayName,
  formatScheduleAssignmentStaffLabel,
} from "./schedule-assignment-display-copy";

describe("formatScheduleAssignmentStaffLabel", () => {
  it("names a missing staff join instead of generic unknown copy", () => {
    expect(formatScheduleAssignmentStaffLabel(null)).toBe(SCHEDULE_ASSIGNMENT_NO_STAFF_COPY);
    expect(formatScheduleAssignmentStaffLabel(undefined)).toBe(SCHEDULE_ASSIGNMENT_NO_STAFF_COPY);
  });

  it("names a posted staff record with blank first and last names", () => {
    expect(formatScheduleAssignmentStaffLabel({ first_name: "", last_name: "" })).toBe(
      SCHEDULE_ASSIGNMENT_NO_STAFF_COPY,
    );
    expect(formatScheduleAssignmentStaffLabel({ first_name: "   ", last_name: "  " })).toBe(
      SCHEDULE_ASSIGNMENT_NO_STAFF_COPY,
    );
  });

  it("returns a posted staff name trimmed as-is", () => {
    expect(formatScheduleAssignmentStaffLabel({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatScheduleAssignmentStaffLabel({ first_name: "  Jordan  ", last_name: "  Lee  " })).toBe(
      "Jordan Lee",
    );
  });
});

describe("formatScheduleAssignmentStaffDisplayName", () => {
  it("names a missing display name instead of generic unknown copy", () => {
    expect(formatScheduleAssignmentStaffDisplayName(null)).toBe(SCHEDULE_ASSIGNMENT_NO_STAFF_COPY);
    expect(formatScheduleAssignmentStaffDisplayName(undefined)).toBe(SCHEDULE_ASSIGNMENT_NO_STAFF_COPY);
  });

  it("names a blank display name", () => {
    expect(formatScheduleAssignmentStaffDisplayName("")).toBe(SCHEDULE_ASSIGNMENT_NO_STAFF_COPY);
    expect(formatScheduleAssignmentStaffDisplayName("   ")).toBe(SCHEDULE_ASSIGNMENT_NO_STAFF_COPY);
  });

  it("returns a posted display name trimmed as-is", () => {
    expect(formatScheduleAssignmentStaffDisplayName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatScheduleAssignmentStaffDisplayName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});
