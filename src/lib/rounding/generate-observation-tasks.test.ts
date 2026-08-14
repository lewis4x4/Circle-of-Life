import { formatInTimeZone, toDate } from "date-fns-tz";
import { describe, expect, it } from "vitest";

import {
  buildColDiscoveryRoundRules,
  COL_DISCOVERY_DAY_TIMES,
  COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES,
  COL_DISCOVERY_NIGHT_TIMES_STANDARD,
} from "./col-discovery-round-cadence";
import { generateObservationTasks } from "./generate-observation-tasks";

const OPERATOR_TZ = "America/New_York";

const BASE_ARGS = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  facilityId: "00000000-0000-0000-0002-000000000001",
  residentId: "50000000-0000-0000-0000-000000000001",
  planId: "plan-1",
  planRuleId: "rule-1",
};

function etWindow(startYmd: string, endYmd: string) {
  return {
    windowStart: toDate(`${startYmd}T00:00:00`, { timeZone: OPERATOR_TZ }),
    windowEnd: toDate(`${endYmd}T00:00:00`, { timeZone: OPERATOR_TZ }),
  };
}

function dueHourEt(iso: string): number {
  return Number(formatInTimeZone(new Date(iso), OPERATOR_TZ, "H"));
}

function dueMinuteEt(iso: string): number {
  return Number(formatInTimeZone(new Date(iso), OPERATOR_TZ, "m"));
}

describe("generateObservationTasks — COL discovery cadence", () => {
  it("generates discrete day and night checks for standard COL facilities", () => {
    const rules = buildColDiscoveryRoundRules("standard_day_night");
    const { windowStart, windowEnd } = etWindow("2026-08-24", "2026-08-25");

    const dueHours = rules.flatMap((rule) =>
      generateObservationTasks({
        ...BASE_ARGS,
        windowStart,
        windowEnd,
        rule,
      }).map((task) => dueHourEt(task.dueAt)),
    );

    expect(dueHours).toEqual(
      [...COL_DISCOVERY_DAY_TIMES, ...COL_DISCOVERY_NIGHT_TIMES_STANDARD].map((time) => Number(time.slice(0, 2))),
    );
  });

  it("generates two-hour overnight checks for Homewood", () => {
    const nightRule = buildColDiscoveryRoundRules("homewood_two_hour_night").find((rule) => rule.shift === "night");
    expect(nightRule).toBeDefined();

    const windowStart = toDate("2026-08-24T17:00:00", { timeZone: OPERATOR_TZ });
    const windowEnd = toDate("2026-08-25T07:00:00", { timeZone: OPERATOR_TZ });
    const tasks = generateObservationTasks({
      ...BASE_ARGS,
      windowStart,
      windowEnd,
      rule: nightRule!,
    });

    expect(tasks.map((task) => dueHourEt(task.dueAt))).toEqual([18, 20, 22, 0, 2, 4]);
    expect(nightRule?.intervalMinutes).toBe(COL_DISCOVERY_HOMWOOD_NIGHT_INTERVAL_MINUTES);
  });

  it("does not double-book the 06:00 day check for Homewood", () => {
    const rules = buildColDiscoveryRoundRules("homewood_two_hour_night");
    const { windowStart, windowEnd } = etWindow("2026-08-24", "2026-08-25");

    const sixAmTasks = rules.flatMap((rule) =>
      generateObservationTasks({
        ...BASE_ARGS,
        windowStart,
        windowEnd,
        rule,
      }).filter((task) => dueHourEt(task.dueAt) === 6 && dueMinuteEt(task.dueAt) === 0),
    );

    expect(sixAmTasks).toHaveLength(1);
  });
});
