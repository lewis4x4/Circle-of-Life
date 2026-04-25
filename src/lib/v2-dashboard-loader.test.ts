import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUser = { id: "user-1", app_metadata: { app_role: "owner" } };

let mockViewResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
    },
    schema: () => ({
      from: () => ({
        select: () => ({
          order: () => Promise.resolve(mockViewResult),
        }),
      }),
    }),
  })),
}));

import { loadV2Dashboard } from "./v2-dashboard-loader";

describe("loadV2Dashboard", () => {
  beforeEach(() => {
    mockViewResult = { data: [], error: null };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for unknown dashboard ids", async () => {
    const load = await loadV2Dashboard("not-a-real-id" as never);
    expect(load).toBeNull();
  });

  it("falls back to fixture rows when the view returns 0 rows", async () => {
    mockViewResult = { data: [], error: null };
    const load = await loadV2Dashboard("command-center");
    expect(load).not.toBeNull();
    expect(load!.rowsSource).toBe("fixture");
    expect(load!.payload.tableRows.length).toBeGreaterThan(0);
    // Fixture rows have non-null occupancy values
    expect(load!.payload.tableRows[0]!.occupancyPct).not.toBeNull();
  });

  it("falls back to fixture rows when the view query errors", async () => {
    mockViewResult = { data: null, error: { message: "boom" } };
    const load = await loadV2Dashboard("clinical-quality");
    expect(load!.rowsSource).toBe("fixture");
  });

  it("uses live rows from the view when available", async () => {
    mockViewResult = {
      data: [
        {
          facility_id: "f-1",
          facility_name: "Live Facility A",
          occupancy_pct: 0.92, // fraction → should normalize to 92
          open_incidents_count: 4,
          survey_readiness_pct: null,
        },
        {
          facility_id: "f-2",
          facility_name: "Live Facility B",
          occupancy_pct: 88, // already a percent integer
          open_incidents_count: 0,
          survey_readiness_pct: 0.85,
        },
      ],
      error: null,
    };
    const load = await loadV2Dashboard("rounding-operations");
    expect(load!.rowsSource).toBe("live");
    expect(load!.payload.tableRows).toHaveLength(2);

    const a = load!.payload.tableRows.find((r) => r.id === "f-1")!;
    expect(a.name).toBe("Live Facility A");
    expect(a.occupancyPct).toBe(92);
    expect(a.openIncidents).toBe(4);
    expect(a.surveyReadinessPct).toBeNull();
    expect(a.laborCostPct).toBeNull();

    const b = load!.payload.tableRows.find((r) => r.id === "f-2")!;
    expect(b.occupancyPct).toBe(88);
    expect(b.surveyReadinessPct).toBe(85);

    expect(load!.facilities).toEqual([
      { id: "f-1", label: "Live Facility A" },
      { id: "f-2", label: "Live Facility B" },
    ]);
  });

  it("derives the scope option list from the live row set", async () => {
    mockViewResult = {
      data: [
        { facility_id: "x", facility_name: "Only One", occupancy_pct: null, open_incidents_count: 1, survey_readiness_pct: null },
      ],
      error: null,
    };
    const load = await loadV2Dashboard("executive-intelligence");
    expect(load!.facilities).toEqual([{ id: "x", label: "Only One" }]);
  });
});
