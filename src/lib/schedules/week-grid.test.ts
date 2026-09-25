import { describe, expect, it } from "vitest";
import { assignmentDefinitionId, formatScheduleTimes, nextScheduleCellValue, scheduledHours, scheduleWallTime, isManagedScheduleGroup, scheduleWeekDates, type ScheduleAssignment, type ScheduleShiftDefinition } from "./week-grid";

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
    expect(scheduledHours("2026-09-28", "18:00:00", "06:00:00", "America/New_York")).toBe(12);
    expect(scheduledHours("2026-10-31", "18:00:00", "06:00:00", "America/New_York")).toBe(13);
    expect(scheduledHours("2026-03-07", "18:00:00", "06:00:00", "America/New_York")).toBe(11);
    expect(scheduledHours("2026-09-28", null, null, "America/New_York")).toBeNull();
    expect(scheduledHours("2026-09-28", "09:15", "16:45", "America/New_York")).toBe(7.5);
    expect(scheduledHours("2026-09-28", "22:00", "04:30", "America/New_York")).toBe(6.5);
    expect(scheduledHours("2026-09-28", "09:00", "09:00", "America/New_York")).toBeNull();
  });
  it("does not invent configured times for a legacy assignment", () => {
    expect(assignmentDefinitionId({ shift_type: "day", custom_start_time: null, custom_end_time: null } as ScheduleAssignment, shifts)).toBeNull();
    expect(assignmentDefinitionId({ shift_type: "day", custom_start_time: "06:00:00", custom_end_time: "18:00:00" } as ScheduleAssignment, shifts)).toBe("day");
  });
  it("uses each facility time zone and matches database DST boundaries", () => {
    expect(scheduleWallTime("2026-03-08", "02:30", "America/New_York")).toBeNull();
    expect(scheduleWallTime("2026-11-01", "01:30", "America/New_York")?.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(scheduledHours("2026-11-01", "01:30", "03:30", "America/New_York")).toBe(2);
    expect(scheduledHours("2026-10-31", "18:00", "06:00", "America/Phoenix")).toBe(12);
  });
  it("does not unlock unrelated or incomplete multiple assignments", () => {
    const rows = [0, 1].map((index) => ({ schedule_group_id: "group", schedule_block_count: 2, schedule_block_index: index, schedule_preset_id: "preset" })) as ScheduleAssignment[];
    expect(isManagedScheduleGroup(rows)).toBe(true);
    expect(isManagedScheduleGroup(rows.slice(0, 1))).toBe(false);
    expect(isManagedScheduleGroup([{ ...rows[0] }, { ...rows[1], schedule_group_id: "other" }])).toBe(false);
    expect(isManagedScheduleGroup([{ ...rows[0] }, { ...rows[1], schedule_block_index: 0 }])).toBe(false);
  });

});
