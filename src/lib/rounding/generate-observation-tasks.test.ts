import { describe, expect, it } from "vitest";

import type { PlanRuleInput } from "./types";
import { generateObservationTasks } from "./generate-observation-tasks";

/**
 * The legacy plan-rule generator, on its own fixtures.
 *
 * This test used to build its rules from `col-discovery-round-cadence.ts`,
 * which carried the retired 2026-08-14 cadence keyed by facility name. That
 * module is gone, and so is the tab that created the per resident plans it
 * generated for (spec 25A defect 7). What survives is the legacy plan task
 * kind, and the generator behind it, so what this file tests now is the
 * generator's own two behaviours against times it owns.
 *
 * Times here are fixture data, which decision D2 allows in a test and nowhere
 * else. The cadence in force at a building is rows, projected by
 * `facility_observation_windows_for_date`, and no code path reads these.
 */

const BASE_ARGS = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  facilityId: "00000000-0000-0000-0002-000000000001",
  residentId: "50000000-0000-0000-0000-000000000001",
  planId: "plan-1",
  planRuleId: "rule-1",
};

const FIXTURE_GRACE_MINUTES = 30;
const FIXTURE_DAY_TIMES = ["07:00", "11:00", "15:00"] as const;
const FIXTURE_NIGHT_INTERVAL_MINUTES = 120;

function discreteRule(scheduledTime: string, sortOrder: number): PlanRuleInput {
  const [hours, minutes] = scheduledTime.split(":").map(Number);
  const endMinutes = hours * 60 + minutes + 5;
  const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(
    endMinutes % 60,
  ).padStart(2, "0")}`;
  return {
    intervalType: "daypart",
    intervalMinutes: null,
    shift: "day",
    daypartStart: scheduledTime,
    daypartEnd: end,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: FIXTURE_GRACE_MINUTES,
    requiredFieldsSchema: { scheduled_time: scheduledTime },
    sortOrder,
    active: true,
  };
}

describe("generateObservationTasks", () => {
  it("generates one task per discrete scheduled time in the window", () => {
    const windowStart = new Date(2026, 7, 24, 0, 0, 0, 0);
    const windowEnd = new Date(2026, 7, 25, 0, 0, 0, 0);

    const dueHours = FIXTURE_DAY_TIMES.map((time, index) => discreteRule(time, index)).flatMap(
      (rule) =>
        generateObservationTasks({ ...BASE_ARGS, windowStart, windowEnd, rule }).map((task) =>
          new Date(task.dueAt).getHours(),
        ),
    );

    expect(dueHours).toEqual(FIXTURE_DAY_TIMES.map((time) => Number(time.slice(0, 2))));
  });

  it("spaces interval tasks evenly across an overnight window", () => {
    const rule: PlanRuleInput = {
      intervalType: "fixed_minutes",
      intervalMinutes: FIXTURE_NIGHT_INTERVAL_MINUTES,
      shift: "night",
      daypartStart: "18:00",
      daypartEnd: "06:00",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: FIXTURE_GRACE_MINUTES,
      sortOrder: 0,
      active: true,
    };

    const tasks = generateObservationTasks({
      ...BASE_ARGS,
      windowStart: new Date(2026, 7, 24, 17, 0, 0, 0),
      windowEnd: new Date(2026, 7, 25, 7, 0, 0, 0),
      rule,
    });

    expect(tasks.map((task) => new Date(task.dueAt).getHours())).toEqual([18, 20, 22, 0, 2, 4, 6]);
  });

  it("carries the rule's grace onto every task rather than assuming one", () => {
    const rule = discreteRule("07:00", 0);
    const [task] = generateObservationTasks({
      ...BASE_ARGS,
      windowStart: new Date(2026, 7, 24, 0, 0, 0, 0),
      windowEnd: new Date(2026, 7, 25, 0, 0, 0, 0),
      rule,
    });
    const graceMinutes =
      (new Date(task.graceEndsAt).getTime() - new Date(task.dueAt).getTime()) / 60000;
    expect(graceMinutes).toBe(FIXTURE_GRACE_MINUTES);
  });
});
