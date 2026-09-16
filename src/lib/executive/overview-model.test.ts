import { describe, expect, it } from "vitest";


import {
  applyFacilityOccupancyMetricHonesty,
  attachFacilityMetrics,
  buildLatestMetricDates,
  buildLatestMetricMap,
} from "./overview-model";

describe("executive overview model", () => {
  it("builds aggregate metrics from latest scoped rows without treating zero as missing", () => {
    const metrics = buildLatestMetricMap([
      { facility_id: null, metric_code: "occ_pt", metric_value_numeric: 0 },
      { facility_id: null, metric_code: "occ_pt", metric_value_numeric: 0.88 },
      { facility_id: null, metric_code: "rev_mtd", metric_value_numeric: 123_45 },
    ]);

    expect(metrics).toEqual({
      occ_pt: 0,
      rev_mtd: 123_45,
    });
  });

  it("keeps the recorded day of each metric, because a run writes only what it could compute", () => {
    // Newest-first, as the query returns them. Survey readiness was not written
    // today, so its newest row is older than billed revenue's.
    const rows = [
      { facility_id: null, metric_code: "rev_mtd", metric_value_numeric: 0, snapshot_date: "2026-09-15" },
      { facility_id: null, metric_code: "survey_rd", metric_value_numeric: 0.92, snapshot_date: "2026-09-12" },
      { facility_id: null, metric_code: "survey_rd", metric_value_numeric: 0.9, snapshot_date: "2026-09-11" },
    ];

    expect(buildLatestMetricDates(rows)).toEqual({
      rev_mtd: "2026-09-15",
      survey_rd: "2026-09-12",
    });
    // The value view is unchanged for callers that only display a figure.
    expect(buildLatestMetricMap(rows)).toEqual({ rev_mtd: 0, survey_rd: 0.92 });
  });

  it("omits a metric that arrived without a recorded day rather than inventing one", () => {
    expect(
      buildLatestMetricDates([
        { facility_id: null, metric_code: "occ_pt", metric_value_numeric: 0.9 },
      ]),
    ).toEqual({});
  });

  it("attaches only explicit facility-level metrics to facility rows", () => {
    const facilities = attachFacilityMetrics(
      [
        { id: "homewood", name: "Homewood Lodge ALF" },
        { id: "oakridge", name: "Oakridge ALF" },
      ],
      [
        { facility_id: null, metric_code: "occ_pt", metric_value_numeric: 0.86 },
        { facility_id: "homewood", metric_code: "occ_pt", metric_value_numeric: 0.72 },
        { facility_id: "homewood", metric_code: "labor_pct", metric_value_numeric: 0.51 },
      ],
    );

    expect(facilities).toEqual([
      {
        id: "homewood",
        name: "Homewood Lodge ALF",
        metrics: {
          occ_pt: 0.72,
          labor_pct: 0.51,
        },
      },
      {
        id: "oakridge",
        name: "Oakridge ALF",
        metrics: {},
      },
    ]);
  });

  it("uses the first metric row per facility and code so prior snapshots do not overwrite latest values", () => {
    const [facility] = attachFacilityMetrics(
      [{ id: "homewood", name: "Homewood Lodge ALF" }],
      [
        { facility_id: "homewood", metric_code: "survey_rd", metric_value_numeric: 0.91 },
        { facility_id: "homewood", metric_code: "survey_rd", metric_value_numeric: 0.77 },
      ],
    );

    expect(facility?.metrics.survey_rd).toBe(0.91);
  });

  it("strips occ_pt when bed census is unloaded even if snapshots posted zero", () => {
    const [facility] = applyFacilityOccupancyMetricHonesty(
      attachFacilityMetrics(
        [{ id: "homewood", name: "Homewood Lodge ALF" }],
        [{ facility_id: "homewood", metric_code: "occ_pt", metric_value_numeric: 0 }],
      ),
      new Map(),
      [{ id: "homewood", total_licensed_beds: 48 }],
    );

    expect(facility?.metrics.occ_pt).toBeUndefined();
  });

  it("refreshes occ_pt from loaded bed census instead of stale snapshot zeros", () => {
    const [facility] = applyFacilityOccupancyMetricHonesty(
      attachFacilityMetrics(
        [{ id: "oakridge", name: "Oakridge ALF" }],
        [{ facility_id: "oakridge", metric_code: "occ_pt", metric_value_numeric: 0 }],
      ),
      new Map([
        [
          "oakridge",
          {
            total_beds: 4,
            occupancy_count: 2,
          },
        ],
      ]),
      [{ id: "oakridge", total_licensed_beds: 52 }],
    );

    expect(facility?.metrics.occ_pt).toBe(0.5);
  });
});
