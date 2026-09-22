import { describe, expect, it } from "vitest";

import { latestStandUpCensus } from "@/lib/home/load-home";

const FACILITY = "11111111-1111-4111-8111-111111111111";

describe("latestStandUpCensus (COL-603)", () => {
  it("takes the newest week with a census figure for this facility", () => {
    const data = {
      reports: [
        { facility_id: FACILITY, week_start: "2026-09-14", values: { current_total_census: 34 } },
        { facility_id: FACILITY, week_start: "2026-09-21", values: { current_total_census: 35 } },
        { facility_id: "other", week_start: "2026-09-28", values: { current_total_census: 12 } },
      ],
    };
    expect(latestStandUpCensus(data, FACILITY)).toEqual({ value: 35, weekStart: "2026-09-21" });
  });

  it("skips a week whose census is still blank", () => {
    const data = {
      reports: [
        { facility_id: FACILITY, week_start: "2026-09-28", values: { current_total_census: null } },
        { facility_id: FACILITY, week_start: "2026-09-21", values: { current_total_census: 35 } },
      ],
    };
    expect(latestStandUpCensus(data, FACILITY)).toEqual({ value: 35, weekStart: "2026-09-21" });
  });

  it("returns nothing for an unreadable or empty payload", () => {
    expect(latestStandUpCensus(null, FACILITY)).toBeNull();
    expect(latestStandUpCensus({ reports: [] }, FACILITY)).toBeNull();
    expect(latestStandUpCensus({ reports: "nope" }, FACILITY)).toBeNull();
  });
});
