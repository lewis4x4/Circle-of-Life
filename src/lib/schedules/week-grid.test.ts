import { describe, expect, it } from "vitest";
import { assignmentDefinitionId, COOK_SPLIT, COOK_SPLIT_BLOCKS, describeScheduleCell, formatScheduleTimes, isCookSplitCell, isCookStaffRole, nextScheduleCellValue, scheduledHours, scheduleWeekDates, type ScheduleAssignment, type ScheduleShiftDefinition } from "./week-grid";

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
  it("adds one Cook split step before Custom for kitchen staff only", () => {
    const cook = { cookSplit: true };
    expect(nextScheduleCellValue(null, shifts, cook)).toBe("day");
    expect(nextScheduleCellValue("day", shifts, cook)).toBe("night");
    expect(nextScheduleCellValue("night", shifts, cook)).toBe(COOK_SPLIT);
    expect(nextScheduleCellValue(COOK_SPLIT, shifts, cook)).toBe("custom");
    expect(nextScheduleCellValue("custom", shifts, cook)).toBeNull();
    expect(nextScheduleCellValue(null, [], cook)).toBe(COOK_SPLIT);
    // A split already on a non-cook's cell still leaves through Custom.
    expect(nextScheduleCellValue(COOK_SPLIT, shifts)).toBe("custom");
    expect(isCookStaffRole("cook")).toBe(true);
    expect(isCookStaffRole("dietary_aide")).toBe(true);
    expect(isCookStaffRole("medication_tech")).toBe(false);
    expect(isCookStaffRole(undefined)).toBe(false);
  });
  it("schedules the cook split as 6am–1pm plus 4pm–6pm, nine hours", () => {
    expect(COOK_SPLIT_BLOCKS).toEqual([{ start_time: "06:00", end_time: "13:00" }, { start_time: "16:00", end_time: "18:00" }]);
    expect(COOK_SPLIT_BLOCKS.reduce((sum, block) => sum + (scheduledHours("2026-10-01", block.start_time, block.end_time) ?? 0), 0)).toBe(9);
  });
  it("recognizes a saved cook split only from two plain custom blocks at the preset times", () => {
    const block = (start: string, end: string, extra: Partial<ScheduleAssignment> = {}) => ({ shift_type: "custom", shift_definition_id: null, custom_start_time: start, custom_end_time: end, ...extra }) as ScheduleAssignment;
    expect(isCookSplitCell([block("16:00:00", "18:00:00"), block("06:00:00", "13:00:00")])).toBe(true);
    expect(isCookSplitCell([block("06:00:00", "13:00:00")])).toBe(false);
    expect(isCookSplitCell([block("06:00:00", "13:00:00"), block("16:00:00", "19:00:00")])).toBe(false);
    expect(isCookSplitCell([block("06:00:00", "13:00:00", { shift_type: "day" }), block("16:00:00", "18:00:00")])).toBe(false);
    expect(isCookSplitCell([block("06:00:00", "13:00:00", { shift_definition_id: "day" }), block("16:00:00", "18:00:00")])).toBe(false);
  });
  it("describes a split under one label", () => {
    expect(describeScheduleCell([{ label: "Cook split", start: "06:00", end: "13:00" }, { label: "Cook split", start: "16:00", end: "18:00" }])).toBe("Cook split 6:00a–1:00p and 4:00p–6:00p");
    expect(describeScheduleCell([{ label: "Day", start: "06:00", end: "18:00" }, { label: "Custom", start: "19:00", end: "20:00" }])).toBe("Day 6:00a–6:00p, Custom 7:00p–8:00p");
    expect(describeScheduleCell([])).toBe("");
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
