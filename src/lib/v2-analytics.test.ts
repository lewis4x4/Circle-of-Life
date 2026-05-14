import { afterEach, describe, expect, it, vi } from "vitest";

let mockResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: null,
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    schema: () => ({
      from: () => ({
        select: () => ({
          order: () => Promise.resolve(mockResult),
        }),
      }),
    }),
  })),
}));

import { loadV2Analytics } from "./v2-analytics";

describe("loadV2Analytics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockResult = { data: null, error: null };
  });

  it("returns an explicit empty state instead of fixture rollups", async () => {
    mockResult = { data: [], error: null };
    const load = await loadV2Analytics("executive-standup");
    expect(load.source).toBe("empty");
    expect(load.rollup).toEqual([]);
  });

  it("returns unavailable when the live rollup errors", async () => {
    mockResult = { data: null, error: { message: "boom" } };
    const load = await loadV2Analytics("finance-hub");
    expect(load.source).toBe("unavailable");
    expect(load.rollup).toEqual([]);
  });

  it("uses live rollup rows and filters facility deep-dives by context id", async () => {
    mockResult = {
      data: [
        {
          facility_id: "f-1",
          facility_name: "Homewood Lodge ALF",
          occupancy_pct: 0.92,
          open_incidents_count: 0,
          risk_score: null,
          survey_readiness_pct: 0.85,
        },
        {
          facility_id: "f-2",
          facility_name: "Other Facility",
          occupancy_pct: null,
          open_incidents_count: 3,
          risk_score: 40,
          survey_readiness_pct: 91,
        },
      ],
      error: null,
    };

    const load = await loadV2Analytics("facility-deep-dive", { contextId: "f-1" });
    expect(load.source).toBe("live");
    expect(load.rollup).toEqual([
      {
        facility_id: "f-1",
        facility_name: "Homewood Lodge ALF",
        occupancy_pct: 92,
        open_incidents_count: 0,
        risk_score: null,
        survey_readiness_pct: 85,
      },
    ]);
  });

  it("marks a facility deep-dive with no matching live row as empty", async () => {
    mockResult = {
      data: [
        {
          facility_id: "f-2",
          facility_name: "Other Facility",
          occupancy_pct: null,
          open_incidents_count: 3,
          risk_score: 40,
          survey_readiness_pct: null,
        },
      ],
      error: null,
    };

    const load = await loadV2Analytics("facility-deep-dive", { contextId: "missing" });
    expect(load.source).toBe("empty");
    expect(load.rollup).toEqual([]);
  });
});
