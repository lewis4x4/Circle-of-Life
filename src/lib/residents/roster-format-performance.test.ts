import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatResidentRosterUpdatedAt } from "./roster-format";

const inputs = [null, "", "invalid", "2026-03-09T04:00:00Z", "2026-03-09T03:59:59Z", "2026-03-08T06:59:59Z", "2026-03-08T07:00:00Z", "2026-03-01T16:00:00Z", "2026-03-01T15:59:59Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z", " 2026-03-09T04:00:00Z "];
afterEach(() => vi.useRealTimers());

describe("roster timestamp behavior", () => {
  it.each(["2026-03-09T16:00:00Z", "2026-11-02T17:00:00Z", "2026-01-01T02:00:00Z"])("preserves labels across DST and year boundaries at %s", (now) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    expect(inputs.map(formatResidentRosterUpdatedAt)).toMatchSnapshot();
  });

  it("refreshes relative dates when the clock crosses Eastern midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T03:59:59Z"));
    expect(formatResidentRosterUpdatedAt("2026-09-04T16:00:00Z")).toBe("Today 12:00p");
    vi.setSystemTime(new Date("2026-09-05T04:00:00Z"));
    expect(formatResidentRosterUpdatedAt("2026-09-04T16:00:00Z")).toBe("Yesterday 12:00p");
  });

  it.skipIf(!process.env.HAVEN_PERF_BENCH)("measures 1000 roster timestamps", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-09T16:00:00Z"));
    const times: number[] = [];
    for (let round = 0; round < 6; round++) {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) formatResidentRosterUpdatedAt(inputs[3 + i % 9]);
      if (round > 0) times.push(performance.now() - start);
    }
    writeFileSync(`${process.env.HAVEN_PERF_BENCH}/roster.json`, JSON.stringify({ benchmark: "roster-1000-timestamps", medianMs: times.sort((a, b) => a - b)[2] }));
  });
});
