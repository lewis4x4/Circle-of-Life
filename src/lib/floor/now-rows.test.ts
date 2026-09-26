import { describe, expect, it } from "vitest";

import {
  checkTiming,
  groupRoundsQueue,
  nowCountSegments,
  orderRailResidents,
  residentFlag,
  selectNowChecks,
  type FloorTaskApiRow,
} from "./now-rows";

const NOW = new Date("2026-09-23T13:40:00Z"); // 9:40 AM Eastern
const at = (hhmm: string) => `2026-09-23T${hhmm}:00Z`;
const row = (id: string, dueAt: string, derived: string, name = "Evelyn Carter"): FloorTaskApiRow => ({
  id,
  due_at: dueAt,
  derived_status: derived,
  residents: { id: `r-${id}`, first_name: name.split(" ")[0], last_name: name.split(" ")[1], preferred_name: null },
});

describe("checkTiming (value-derived pill and bar)", () => {
  it("over: red bar, danger pill with the minutes, filled Done", () => {
    expect(checkTiming("overdue", at("13:30"), NOW)).toMatchObject({ kind: "over", label: "10 min over", tone: "danger", bar: "destructive", primaryAction: true });
    expect(checkTiming("missed", at("10:00"), NOW)).toMatchObject({ kind: "over", label: "3 h over", tone: "danger" });
  });

  it("due: amber bar, warning pill, filled Done", () => {
    expect(checkTiming("due_now", at("13:45"), NOW)).toMatchObject({ kind: "due", label: "Due now", tone: "warning", bar: "warning", primaryAction: true });
    expect(checkTiming("due_soon", at("13:45"), NOW)).toMatchObject({ kind: "due", label: "Due now" });
  });

  it("upcoming: no bar, muted pill counting down, outlined Done", () => {
    expect(checkTiming("upcoming", at("14:00"), NOW)).toMatchObject({ kind: "upcoming", label: "In 20 min", tone: "muted", bar: "none", primaryAction: false });
    expect(checkTiming("upcoming", at("15:00"), NOW)).toMatchObject({ label: "In 80 min" });
  });

  it("before its window opens a check says when it opens and cannot be charted (COL-849 finding)", () => {
    // The 6:00 AM check, looked at the evening before: the window opens at 6:00.
    expect(checkTiming("upcoming", at("22:00"), NOW, at("22:00"))).toMatchObject({ kind: "upcoming", label: "Opens in 8 h", chartable: false, primaryAction: false });
    // A due-soon band from the facility's lead time does not open a window that has not opened.
    expect(checkTiming("due_soon", at("13:50"), NOW, at("13:50"))).toMatchObject({ kind: "upcoming", label: "Opens in 10 min", chartable: false });
    // Once the window is open (grace before the due time), the check can be charted before it is due.
    expect(checkTiming("upcoming", at("14:00"), NOW, at("13:30"))).toMatchObject({ kind: "upcoming", label: "In 20 min", chartable: true });
    expect(checkTiming("overdue", at("13:30"), NOW, at("13:30"))).toMatchObject({ kind: "over", chartable: true });
    expect(checkTiming("completed_on_time", at("13:30"), NOW, at("13:30"))).toMatchObject({ kind: "done", chartable: false });
  });

  it("a status the server has not moved yet still reads due once its time passes", () => {
    expect(checkTiming("upcoming", at("13:35"), NOW)).toMatchObject({ kind: "due", label: "Due now" });
  });

  it("charted and excused checks are quiet", () => {
    expect(checkTiming("completed_late", at("13:00"), NOW)).toMatchObject({ kind: "done", tone: "muted", bar: "none" });
    expect(checkTiming("excused", at("13:00"), NOW)).toMatchObject({ kind: "excused", tone: "muted" });
  });
});

describe("selectNowChecks", () => {
  const rows = [
    row("a", at("14:00"), "upcoming", "Lorraine Pitts"),
    row("b", at("13:30"), "overdue"),
    row("c", at("13:45"), "due_soon", "Ruth Simmons"),
    row("d", at("16:00"), "upcoming", "Too Late"),
    row("e", at("09:00"), "missed", "Earlier Shift"),
    row("f", at("13:00"), "completed_on_time", "Done Already"),
  ];

  it("lists over and due checks from this shift, then the next hour, in time order", () => {
    const checks = selectNowChecks(rows, NOW, at("10:00"));
    expect(checks.map((check) => check.id)).toEqual(["b", "c", "a"]);
  });

  it("counts in sentence case and leaves zeros out", () => {
    const checks = selectNowChecks(rows, NOW, at("10:00"));
    expect(nowCountSegments(checks, 2).map((segment) => segment.text)).toEqual(["1 over", "1 due", "1 next hour", "2 tasks"]);
    expect(nowCountSegments([], 0)).toEqual([]);
  });
});

describe("groupRoundsQueue", () => {
  it("groups this shift and counts older open checks without listing them", () => {
    const groups = groupRoundsQueue(
      [row("a", at("14:00"), "upcoming"), row("b", at("13:30"), "overdue"), row("c", at("09:00"), "missed"), row("d", at("12:00"), "completed_on_time")],
      NOW,
      at("10:00"),
      at("22:00"),
    );
    expect(groups.over.map((check) => check.id)).toEqual(["b"]);
    expect(groups.upcoming.map((check) => check.id)).toEqual(["a"]);
    expect(groups.done.map((check) => check.id)).toEqual(["d"]);
    expect(groups.olderOpen).toBe(1);
  });
});

describe("residents rail", () => {
  it("derives the dot from escalations, then watches, then the resident's status", () => {
    expect(residentFlag({ hasOpenEscalation: true, hasActiveWatch: true, status: "active" })).toBe("alert");
    expect(residentFlag({ hasOpenEscalation: false, hasActiveWatch: true, status: "active" })).toBe("watch");
    expect(residentFlag({ hasOpenEscalation: false, hasActiveWatch: false, status: "hospital_hold" })).toBe("hold");
    expect(residentFlag({ hasOpenEscalation: false, hasActiveWatch: false, status: "active" })).toBe("stable");
  });

  it("puts a stable resident with no next check after every one with a check", () => {
    const ordered = orderRailResidents(
      [
        { id: "no-check", room: "101", flag: "stable" as const, nextDueAt: null },
        { id: "later", room: "110", flag: "stable" as const, nextDueAt: at("15:00") },
        { id: "sooner", room: "112", flag: "stable" as const, nextDueAt: at("14:00") },
      ],
      3,
    );
    expect(ordered.map((resident) => resident.id)).toEqual(["sooner", "later", "no-check"]);
  });

  it("puts flagged residents first, then the soonest check, then room order", () => {
    const ordered = orderRailResidents(
      [
        { id: "stable-late", room: "101", flag: "stable" as const, nextDueAt: at("15:00") },
        { id: "stable-soon", room: "110", flag: "stable" as const, nextDueAt: at("14:00") },
        { id: "watch", room: "105", flag: "watch" as const, nextDueAt: null },
        { id: "alert", room: "103", flag: "alert" as const, nextDueAt: null },
        { id: "hold", room: "108", flag: "hold" as const, nextDueAt: null },
      ],
      4,
    );
    expect(ordered.map((resident) => resident.id)).toEqual(["alert", "watch", "hold", "stable-soon"]);
  });
});
