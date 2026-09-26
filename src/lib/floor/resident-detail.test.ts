import { describe, expect, it } from "vitest";

import { floorVisitorName, knowBeforeItems, nextOpenCheck, notRecordedItems, recentCheckItems, todayCheckItems, type ResidentRecordFields } from "./resident-detail";

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
    // An empty allergy list nobody reviewed is unknown, never "no allergies"; it comes first.
    expect(items.map((item) => item.title)).toEqual(["Allergies not recorded", "High fall risk", "Walker within reach"]);
    expect(items[0]?.tone).toBe("missing");
  });

  const FULL: ResidentRecordFields = {
    gender: "female",
    status: "active",
    fall_risk_level: "low",
    elopement_risk: false,
    wandering_risk: false,
    assistive_device: "None",
    special_instructions: null,
    allergy_list: [],
    allergy_list_reviewed_at: "2026-09-20T12:00:00Z",
    diet_order: "Regular",
    code_status: "full_code",
  };

  it("says what is not recorded instead of reading a blank as none", () => {
    const blank: ResidentRecordFields = { ...FULL, fall_risk_level: null, assistive_device: null, allergy_list: null, allergy_list_reviewed_at: null, diet_order: null, code_status: null };
    expect(notRecordedItems(blank).map((item) => item.title)).toEqual([
      "Allergies not recorded",
      "Diet order not recorded",
      "Fall risk not assessed",
      "Assistive device not recorded",
      "Code status not recorded",
    ]);
    expect(notRecordedItems(blank).every((item) => item.tone === "missing")).toBe(true);
  });

  it("shows a reviewed empty allergy list as no known allergies, and a device of None as nothing", () => {
    expect(notRecordedItems(FULL)).toEqual([]);
    expect(knowBeforeItems(FULL).map((item) => item.title)).toEqual(["No known allergies"]);
    expect(knowBeforeItems({ ...FULL, code_status: "dnr" }).map((item) => item.title)).toContain("DNR");
    expect(knowBeforeItems({ ...FULL, code_status: "dnr_dni" }).map((item) => item.title)).toContain("DNR/DNI");
  });
});

describe("recent checks", () => {
  it("lists the last day newest first, marks yesterday's checks, and leads with what is still open", () => {
    const items = recentCheckItems({
      tasks: [task("over", "2026-09-23T13:30:00Z", "overdue"), task("next", "2026-09-23T15:30:00Z", "upcoming"), task("later", "2026-09-23T17:30:00Z", "upcoming")],
      logs: [
        { taskId: "y", observedAt: "2026-09-23T01:10:00Z", summary: "Asleep in bed", staffName: "Rita S." },
        { taskId: "a", observedAt: "2026-09-23T11:30:00Z", summary: "Awake, calm, in chair", staffName: "Ashley W." },
      ],
      dayStartIso: DAY_START,
      now: NOW,
      timeZone: TZ,
    });
    expect(items.map((item) => [item.title, item.detail])).toEqual([
      ["9:30 AM · Safety check", "Not charted · 10 minutes over"],
      ["11:30 AM · Safety check", "Next check"],
      ["7:30 AM · Awake, calm, in chair", "Safety check · Ashley W."],
      ["Yesterday 9:10 PM · Asleep in bed", "Safety check · Rita S."],
    ]);
  });

  it("shows at most 8 charted checks", () => {
    const logs = Array.from({ length: 12 }, (_, i) => ({ taskId: `t${i}`, observedAt: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(), summary: "Asleep", staffName: "Rita S." }));
    expect(recentCheckItems({ tasks: [], logs, dayStartIso: DAY_START, now: NOW, timeZone: TZ })).toHaveLength(8);
  });
});

describe("floorVisitorName", () => {
  it("shows first name and last initial", () => {
    expect(floorVisitorName("Carol Parker")).toBe("Carol P.");
    expect(floorVisitorName("  Mary Ann  Lee ")).toBe("Mary Ann L.");
    expect(floorVisitorName("Cher")).toBe("Cher");
  });
});
