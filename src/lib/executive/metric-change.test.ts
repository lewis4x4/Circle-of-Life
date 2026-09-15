import { describe, expect, it } from "vitest";

import {
  METRIC_CHANGE_UNAVAILABLE_COPY,
  buildPortfolioMetricChanges,
  metricChangeLine,
} from "./metric-change";

describe("portfolio metric change", () => {
  it("compares the two most recent recorded days for the same metric", () => {
    const changes = buildPortfolioMetricChanges([
      { facility_id: null, metric_code: "labor_pct", metric_value_numeric: 0.58, snapshot_date: "2026-09-15" },
      { facility_id: null, metric_code: "labor_pct", metric_value_numeric: 0.55, snapshot_date: "2026-09-14" },
      { facility_id: null, metric_code: "labor_pct", metric_value_numeric: 0.51, snapshot_date: "2026-09-13" },
    ]);

    expect(changes.labor_pct).toMatchObject({
      currentDate: "2026-09-15",
      previousDate: "2026-09-14",
      direction: "up",
    });
    expect(metricChangeLine(changes.labor_pct, "pct")).toBe("+3.0 pts since 2026-09-14.");
  });

  it("gives no change when only one day was recorded", () => {
    const changes = buildPortfolioMetricChanges([
      { facility_id: null, metric_code: "survey_rd", metric_value_numeric: 0.9, snapshot_date: "2026-09-15" },
      { facility_id: null, metric_code: "survey_rd", metric_value_numeric: 0.8, snapshot_date: "2026-09-15" },
    ]);

    expect(changes.survey_rd).toBeUndefined();
    expect(metricChangeLine(undefined, "pct")).toBe(METRIC_CHANGE_UNAVAILABLE_COPY);
  });

  it("never mixes a facility row into a portfolio comparison", () => {
    const changes = buildPortfolioMetricChanges([
      { facility_id: null, metric_code: "inc_rate", metric_value_numeric: 2, snapshot_date: "2026-09-15" },
      { facility_id: "site-a", metric_code: "inc_rate", metric_value_numeric: 9, snapshot_date: "2026-09-14" },
    ]);

    expect(changes.inc_rate).toBeUndefined();
  });

  it("skips days with no recorded value instead of reading them as zero", () => {
    const changes = buildPortfolioMetricChanges([
      { facility_id: null, metric_code: "rev_mtd", metric_value_numeric: 500_00, snapshot_date: "2026-09-15" },
      { facility_id: null, metric_code: "rev_mtd", metric_value_numeric: null, snapshot_date: "2026-09-14" },
      { facility_id: null, metric_code: "rev_mtd", metric_value_numeric: 300_00, snapshot_date: "2026-09-13" },
    ]);

    expect(changes.rev_mtd?.previousDate).toBe("2026-09-13");
    expect(metricChangeLine(changes.rev_mtd, "cur")).toBe("+$200 since 2026-09-13.");
  });

  it("says no change rather than drawing a direction when the value held", () => {
    const changes = buildPortfolioMetricChanges([
      { facility_id: null, metric_code: "occ_pt", metric_value_numeric: 0.9, snapshot_date: "2026-09-15" },
      { facility_id: null, metric_code: "occ_pt", metric_value_numeric: 0.9, snapshot_date: "2026-09-14" },
    ]);

    expect(changes.occ_pt?.direction).toBe("flat");
    expect(metricChangeLine(changes.occ_pt, "pct")).toBe("No change since 2026-09-14.");
  });
});
