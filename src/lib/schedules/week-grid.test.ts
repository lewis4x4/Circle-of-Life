import { describe, expect, it } from "vitest";
import { assignmentDefinitionId, formatScheduleTimes, nextScheduleCellValue, scheduledHours, scheduleWeekDates, type ScheduleAssignment, type ScheduleShiftDefinition } from "./week-grid";

const shifts: ScheduleShiftDefinition[] = [
  { id: "day", label: "Day", roster_shift_type: "day", starts_at_local: "06:00:00", ends_at_local: "18:00:00" },
  { id: "night", label: "Night", roster_shift_type: "night", starts_at_local: "18:00:00", ends_at_local: "06:00:00" },
];

describe("schedule week grid", () => {
  it("covers seven facility dates across month boundaries", () => {
    expect(scheduleWeekDates("2026-09-28")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });
  it("cycles configured definitions, then custom, then off", () => {
    expect(nextScheduleCellValue(null, shifts)).toBe("day");
    expect(nextScheduleCellValue("day", shifts)).toBe("night");
    expect(nextScheduleCellValue("night", shifts)).toBe("custom");
    expect(nextScheduleCellValue("custom", shifts)).toBeNull();
    expect(nextScheduleCellValue(null, [])).toBe("custom");
  });
  it("shows stored overnight times and missing data honestly", () => {
    expect(formatScheduleTimes("18:00:00", "06:00:00")).toBe("6:00p–6:00a (+1 day)");
    expect(formatScheduleTimes(null, null)).toBe("Times not recorded");
  });
  it("calculates elapsed hours across daylight saving boundaries", () => {
    expect(scheduledHours("2026-09-28", "18:00:00", "06:00:00")).toBe(12);
    expect(scheduledHours("2026-10-31", "18:00:00", "06:00:00")).toBe(13);
    expect(scheduledHours("2026-03-07", "18:00:00", "06:00:00")).toBe(11);
    expect(scheduledHours("2026-09-28", null, null)).toBeNull();
    expect(scheduledHours("2026-09-28", "09:15", "16:45")).toBe(7.5);
    expect(scheduledHours("2026-09-28", "22:00", "04:30")).toBe(6.5);
    expect(scheduledHours("2026-09-28", "09:00", "09:00")).toBeNull();
  });
  it("does not invent configured times for a legacy assignment", () => {
    expect(assignmentDefinitionId({ shift_type: "day", custom_start_time: null, custom_end_time: null } as ScheduleAssignment, shifts)).toBeNull();
    expect(assignmentDefinitionId({ shift_type: "day", custom_start_time: "06:00:00", custom_end_time: "18:00:00" } as ScheduleAssignment, shifts)).toBe("day");
  });
});
