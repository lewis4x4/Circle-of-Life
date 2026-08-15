import { describe, expect, it } from "vitest";

import {
  buildColDiscoveryRoundRules,
  COL_DISCOVERY_DAY_TIMES,
  COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES,
  COL_DISCOVERY_NIGHT_TIMES_STANDARD,
} from "./col-discovery-round-cadence";
import { generateObservationTasks } from "./generate-observation-tasks";

const BASE_ARGS = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  facilityId: "00000000-0000-0000-0002-000000000001",
  residentId: "50000000-0000-0000-0000-000000000001",
  planId: "plan-1",
  planRuleId: "rule-1",
};

describe("generateObservationTasks — COL discovery cadence", () => {
  it("generates discrete day and night checks for standard COL facilities", () => {
    const rules = buildColDiscoveryRoundRules("standard_day_night");
    const windowStart = new Date(2026, 7, 24, 0, 0, 0, 0);
    const windowEnd = new Date(2026, 7, 25, 0, 0, 0, 0);

    const dueHours = rules.flatMap((rule) =>
      generateObservationTasks({
        ...BASE_ARGS,
        windowStart,
        windowEnd,
        rule,
      }).map((task) => new Date(task.dueAt).getHours()),
    );

    expect(dueHours).toEqual(
      [...COL_DISCOVERY_DAY_TIMES, ...COL_DISCOVERY_NIGHT_TIMES_STANDARD].map((time) => Number(time.slice(0, 2))),
    );
  });

  it("generates two-hour overnight checks for Homewood", () => {
    const nightRule = buildColDiscoveryRoundRules("homewood_two_hour_night").find((rule) => rule.shift === "night");
    expect(nightRule).toBeDefined();

    const windowStart = new Date(2026, 7, 24, 17, 0, 0, 0);
    const windowEnd = new Date(2026, 7, 25, 7, 0, 0, 0);
    const tasks = generateObservationTasks({
      ...BASE_ARGS,
      windowStart,
      windowEnd,
      rule: nightRule!,
    });

    expect(tasks.map((task) => new Date(task.dueAt).getHours())).toEqual([18, 20, 22, 0, 2, 4, 6]);
    expect(nightRule?.intervalMinutes).toBe(COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES);
  });
});
