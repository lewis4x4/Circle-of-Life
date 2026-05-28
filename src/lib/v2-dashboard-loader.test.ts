import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUser = { id: "user-1", app_metadata: { app_role: "owner" } };

let mockFacilityOptionsResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: [],
  error: null,
};
let mockTableResult: { data: unknown[] | null; count: number | null; error: { message: string } | null } = {
  data: [],
  count: 0,
  error: null,
};
let mockOrgFacilityCount = 0;

const facilitySelectMock = vi.fn();
const tableSelectMock = vi.fn();
const tableRangeMock = vi.fn();
const publicSelectMock = vi.fn();
const publicIsMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: mockUser }, error: null })),
    },
    schema: () => ({
      from: () => ({
        select: (columns: string, options?: { count?: string }) => {
          if (columns === "facility_id, facility_name" && !options) return facilitySelectMock();
          return tableSelectMock(columns, options);
        },
      }),
    }),
    from: () => ({
      select: publicSelectMock,
    }),
  })),
}));

import { loadV2Dashboard } from "./v2-dashboard-loader";

describe("loadV2Dashboard", () => {
  beforeEach(() => {
    mockFacilityOptionsResult = { data: [], error: null };
    mockTableResult = { data: [], count: 0, error: null };
    mockOrgFacilityCount = 0;

    facilitySelectMock.mockReset().mockReturnValue({
      order: vi.fn().mockReturnValue({
        order: vi.fn().mockImplementation(() => Promise.resolve(mockFacilityOptionsResult)),
      }),
    });

    tableRangeMock.mockReset().mockResolvedValue(mockTableResult);
    tableSelectMock.mockReset().mockReturnValue({
      order: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          range: tableRangeMock,
        }),
      }),
    });

    publicIsMock.mockReset().mockResolvedValue({ count: mockOrgFacilityCount });
    publicSelectMock.mockReset().mockReturnValue({ is: publicIsMock });
  });

  it("returns null for unknown dashboard ids", async () => {
    const load = await loadV2Dashboard("not-a-real-id" as never);
    expect(load).toBeNull();
  });

  it("keeps facility options unpaged while paginating table rows", async () => {
    mockFacilityOptionsResult = {
      data: [
        { facility_id: "f-1", facility_name: "A" },
        { facility_id: "f-2", facility_name: "B" },
      ],
      error: null,
    };
    mockTableResult = {
      data: [{ facility_id: "f-1", facility_name: "A", occupancy_pct: 0.92, open_incidents_count: 4, survey_readiness_pct: 0.9 }],
      count: 2,
      error: null,
    };
    tableRangeMock.mockResolvedValue(mockTableResult);

    const load = await loadV2Dashboard("command-center", { page: "1", pageSize: "1" });

    expect(tableRangeMock).toHaveBeenCalledWith(0, 0);
    expect(load!.facilities).toEqual([
      { id: "f-1", label: "A" },
      { id: "f-2", label: "B" },
    ]);
    expect(load!.payload.tableRows).toHaveLength(1);
    expect(load!.payload.tableRows[0]).toMatchObject({
      id: "f-1",
      name: "A",
      occupancyPct: 92,
      openIncidents: 4,
      surveyReadinessPct: 90,
    });
    expect(load!.tablePagination.totalCount).toBe(2);
    expect(load!.rowsSource).toBe("live");
  });

  it("keeps rowsSource live when total rows exist but the requested page is empty", async () => {
    mockFacilityOptionsResult = {
      data: [{ facility_id: "f-1", facility_name: "A" }],
      error: null,
    };
    mockTableResult = { data: [], count: 1, error: null };
    tableRangeMock.mockResolvedValue(mockTableResult);

    const load = await loadV2Dashboard("command-center", { page: "3", pageSize: "50" });

    expect(load!.rowsSource).toBe("live");
    expect(load!.payload.tableRows).toEqual([]);
    expect(load!.facilities).toEqual([{ id: "f-1", label: "A" }]);
    expect(load!.tablePagination.totalCount).toBe(1);
  });

  it("does not expose facility options when the rollup table query is unavailable", async () => {
    mockFacilityOptionsResult = {
      data: [{ facility_id: "f-1", facility_name: "A" }],
      error: null,
    };
    mockTableResult = { data: null, count: null, error: { message: "boom" } };
    tableRangeMock.mockResolvedValue(mockTableResult);

    const load = await loadV2Dashboard("clinical-quality");

    expect(load!.rowsSource).toBe("unavailable");
    expect(load!.facilities).toEqual([]);
  });

  it("keeps org facility count query head-only and unpaged", async () => {
    mockOrgFacilityCount = 5;
    publicIsMock.mockResolvedValue({ count: mockOrgFacilityCount });

    const load = await loadV2Dashboard("executive-intelligence");

    expect(publicSelectMock).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(publicIsMock).toHaveBeenCalledWith("deleted_at", null);
    expect(load!.orgFacilityCount).toBe(5);
  });

  it("returns unavailable when paged table query errors", async () => {
    mockTableResult = { data: null, count: null, error: { message: "boom" } };
    tableRangeMock.mockResolvedValue(mockTableResult);

    const load = await loadV2Dashboard("clinical-quality");
    expect(load!.rowsSource).toBe("unavailable");
    expect(load!.payload.tableRows).toEqual([]);
  });

  it("returns empty only when count is zero", async () => {
    mockTableResult = { data: [], count: 0, error: null };
    tableRangeMock.mockResolvedValue(mockTableResult);

    const load = await loadV2Dashboard("rounding-operations");
    expect(load!.rowsSource).toBe("empty");
    expect(load!.tablePagination.totalCount).toBe(0);
  });
});
