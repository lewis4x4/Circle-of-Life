import { describe, expect, it } from "vitest";
import { coverCandidates, shiftsTodaySchema, shiftLabel, type HomeShift, type HomeShiftsToday } from "./call-out";

const gap: HomeShift = {
  assignmentId: "gap", staffId: "absent", staffName: "Absent person", shiftType: "custom",
  status: "called_out", uncovered: true, customStart: "22:00", customEnd: "06:00",
  startsAt: "2026-09-23T02:00:00Z", endsAt: "2026-09-23T10:00:00Z",
  presetName: "Saved overnight", presetColor: "#93C5FD",
};
const assignment = (startsAt: string | null, endsAt: string | null, shiftType = "custom", status = "assigned"): HomeShift => ({
  assignmentId: "other", staffId: "candidate", staffName: "Candidate person", shiftType, status,
  uncovered: false, startsAt, endsAt,
});
const today = (...shifts: HomeShift[]): HomeShiftsToday => ({
  localDate: "2026-09-22", shifts: [gap, ...shifts],
  staff: [{ staffId: "absent", staffName: "Absent person" }, { staffId: "candidate", staffName: "Candidate person" }],
});

describe("Home call-out work intervals", () => {
  it("preserves saved interval, label and color snapshots through the RPC parser", () => {
    const parsed = shiftsTodaySchema.parse(today());
    expect(parsed.shifts[0]).toMatchObject({ startsAt: gap.startsAt, endsAt: gap.endsAt, presetName: gap.presetName, presetColor: gap.presetColor });
    expect(shiftLabel(parsed.shifts[0])).toBe("Saved overnight · 22:00–06:00");
    expect(shiftLabel({ shiftType: "custom", presetName: "Retired option" })).toBe("Retired option");
  });

  it.each([
    ["shared custom type outside the interval", "2026-09-22T10:00:00Z", "2026-09-22T18:00:00Z", "custom", true],
    ["adjacent before", "2026-09-22T22:00:00Z", "2026-09-23T02:00:00Z", "custom", true],
    ["adjacent after", "2026-09-23T10:00:00Z", "2026-09-23T14:00:00Z", "custom", true],
    ["overlapping custom", "2026-09-23T05:00:00Z", "2026-09-23T12:00:00Z", "custom", false],
    ["different type overlapping overnight", "2026-09-22T23:00:00Z", "2026-09-23T03:00:00Z", "night", false],
    ["same instant with another UTC offset", "2026-09-22T22:00:00-04:00", "2026-09-23T06:00:00-04:00", "day", false],
  ])("filters %s by actual time", (_name, start, end, type, eligible) => {
    expect(coverCandidates(today(assignment(start, end, type)), gap).map((p) => p.staffId)).toEqual(eligible ? ["candidate"] : []);
  });

  it("keeps the gap between split blocks free and excludes a person when any block overlaps", () => {
    const first = assignment("2026-09-22T22:00:00Z", "2026-09-23T02:00:00Z");
    const second = { ...assignment("2026-09-23T10:00:00Z", "2026-09-23T14:00:00Z"), assignmentId: "second" };
    expect(coverCandidates(today(first, second), gap)).toHaveLength(1);
    expect(coverCandidates(today(first, { ...second, startsAt: "2026-09-23T09:59:00Z" }), gap)).toHaveLength(0);
  });

  it.each(["called_out", "no_show"])("ignores %s work and always excludes the absent person", (status) => {
    expect(coverCandidates(today(assignment(gap.startsAt!, gap.endsAt!, "custom", status)), gap).map((p) => p.staffId)).toEqual(["candidate"]);
  });

  it("leaves missing or invalid intervals to server validation without inventing conflicts", () => {
    for (const work of [assignment(null, null), assignment("invalid", gap.endsAt!), assignment(gap.endsAt!, gap.startsAt!)]) {
      expect(coverCandidates(today(work), gap)).toHaveLength(1);
    }
    expect(coverCandidates(today(), null)).toEqual([]);
  });
});
