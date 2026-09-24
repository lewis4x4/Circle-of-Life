import { describe, expect, it } from "vitest";

import { knowBeforeItems, nextOpenCheck, todayCheckItems } from "./resident-detail";

const NOW = new Date("2026-09-23T13:40:00Z");
const DAY_START = "2026-09-23T04:00:00.000Z";
const TZ = "America/New_York";
const task = (id: string, due: string, derived: string) => ({ id, due_at: due, derived_status: derived });

describe("today's checks", () => {
  it("names who charted a check, and says Staff when the name cannot be shown", () => {
    const items = todayCheckItems({
      tasks: [task("a", "2026-09-23T11:30:00Z", "completed_on_time"), task("b", "2026-09-23T09:30:00Z", "completed_on_time")],
      logs: [
        { taskId: "a", observedAt: "2026-09-23T11:30:00Z", summary: "Awake, calm, in chair", staffName: "Ashley W." },
        { taskId: "b", observedAt: "2026-09-23T09:31:00Z", summary: "Asleep", staffName: null },
      ],
      dayStartIso: DAY_START,
      now: NOW,
      timeZone: TZ,
    });
    expect(items).toEqual([
      { key: "b", title: "5:31 AM · Asleep", detail: "Safety check · Staff" },
      { key: "a", title: "7:30 AM · Awake, calm, in chair", detail: "Safety check · Ashley W." },
    ]);
  });

  it("says where an open check stands", () => {
    const items = todayCheckItems({
      tasks: [task("over", "2026-09-23T13:30:00Z", "overdue"), task("later", "2026-09-23T15:30:00Z", "upcoming")],
      logs: [],
      dayStartIso: DAY_START,
      now: NOW,
      timeZone: TZ,
    });
    expect(items.map((item) => item.detail)).toEqual(["Not charted · 10 minutes over", "Upcoming"]);
    expect(nextOpenCheck([task("later", "2026-09-23T15:30:00Z", "upcoming"), task("over", "2026-09-23T13:30:00Z", "overdue")], NOW)?.id).toBe("over");
  });
});

describe("know before you go in", () => {
  it("lists only the instruction fields the record carries", () => {
    const items = knowBeforeItems({
      gender: "female",
      status: "active",
      fall_risk_level: "high",
      elopement_risk: false,
      wandering_risk: false,
      assistive_device: "Walker within reach",
      special_instructions: null,
      allergy_list: [],
      diet_order: "Regular",
      code_status: "full_code",
    });
    expect(items.map((item) => item.title)).toEqual(["High fall risk", "Walker within reach"]);
  });
});
