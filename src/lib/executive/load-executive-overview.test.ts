import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import { loadExecutiveOverview } from "./load-executive-overview";

const mocks = vi.hoisted(() => ({ heat: vi.fn(), trend: vi.fn(), presence: vi.fn(), beds: vi.fn() }));
vi.mock("@/lib/resident-assurance/command-center-brief", () => ({ fetchResidentAssuranceFacilityHeatMap: mocks.heat, fetchResidentAssuranceFacilityTrendSeries: mocks.trend }));
vi.mock("@/lib/executive/presence-census", async importOriginal => ({ ...await importOriginal<object>(), fetchPresenceCensus: mocks.presence }));
vi.mock("@/lib/executive/facility-occupancy-census", async importOriginal => ({ ...await importOriginal<object>(), fetchFacilityBedCensusById: mocks.beds }));

function delayed<T>(value: T): Promise<T> { return new Promise(resolve => setTimeout(() => resolve(value), 20)); }
function fixture(errorTable?: string) {
  const starts: string[] = [];
  const filters: unknown[][] = [];
  const from = vi.fn((table: string) => {
    let aggregate = false;
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { filters.push([table, column, value]); return query; },
      is: (column: string, value: null) => { if (column === "facility_id") aggregate = true; filters.push([table, column, value]); return query; },
      not: () => query, order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        starts.push(table);
        const data = table === "facilities" ? [{ id: "f1", name: "Fixture facility", total_licensed_beds: 2 }]
          : table === "exec_metric_snapshots" ? [{ facility_id: aggregate ? null : "f1", metric_code: "rev_mtd", metric_value_numeric: 50000 }]
          : [];
        return delayed({ data: errorTable === table ? null : data, error: errorTable === table ? { message: `${table} unavailable` } : null }).then(resolve, reject);
      },
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient<Database>, from, starts, filters };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.heat.mockImplementation(() => delayed([]));
  mocks.trend.mockImplementation(() => delayed([]));
  mocks.presence.mockImplementation(() => delayed({ inHouse: 1, hospital: 0, onLeave: 0, onHold: 0, total: 1 }));
  mocks.beds.mockImplementation(() => delayed(new Map([["f1", { total_beds: 2, occupancy_count: 1 }]])));
});
afterEach(() => vi.useRealTimers());

describe("executive startup reads", () => {
  it("starts independent reads together, shares facilities, and retains financial and occupancy output", async () => {
    const { client, from, starts, filters } = fixture();
    const start = Date.now();
    const pending = loadExecutiveOverview(client, "org", { strict: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual(["facilities", "exec_metric_snapshots", "exec_metric_snapshots", "exec_alerts"]);
    expect(mocks.heat).toHaveBeenCalledWith(client, "org");
    expect(mocks.trend).toHaveBeenCalledWith(client, "org", 7);
    expect(mocks.presence).toHaveBeenCalledWith(client, "org");
    expect(mocks.beds).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    const data = await pending;
    expect(Date.now() - start).toBe(40);
    expect(from.mock.calls.filter(([table]) => table === "facilities")).toHaveLength(1);
    expect(mocks.beds).toHaveBeenCalledWith(client, ["f1"]);
    expect(data.metrics).toEqual({ rev_mtd: 50000 });
    expect(data.facilities).toEqual([{ id: "f1", name: "Fixture facility", total_licensed_beds: 2, metrics: { rev_mtd: 50000, occ_pt: 0.5 } }]);
    expect(data.presenceCensus.total).toBe(1);
    for (const table of ["facilities", "exec_metric_snapshots", "exec_alerts"]) {
      expect(filters).toContainEqual([table, "organization_id", "org"]);
      expect(filters).toContainEqual([table, "deleted_at", null]);
    }
  });

  it("keeps required-data failures visible to the Retry UI", async () => {
    const pending = loadExecutiveOverview(fixture("exec_metric_snapshots").client, "org", { strict: true });
    const assertion = expect(pending).rejects.toThrow("exec_metric_snapshots unavailable");
    await vi.runAllTimersAsync(); await assertion;
  });

  it("retains optional presence fallback", async () => {
    mocks.presence.mockRejectedValue(new Error("presence unavailable"));
    const pending = loadExecutiveOverview(fixture().client, "org", { strict: true });
    await vi.runAllTimersAsync();
    expect((await pending).presenceCensus).toEqual({ inHouse: 0, hospital: 0, onLeave: 0, onHold: 0, total: 0 });
  });

  it("bounds a stalled required read instead of leaving loading active forever", async () => {
    mocks.trend.mockReturnValue(new Promise(() => {}));
    const pending = loadExecutiveOverview(fixture().client, "org", { strict: true });
    const assertion = expect(pending).rejects.toThrow("assurance-trends exceeded 5000ms");
    await vi.advanceTimersByTimeAsync(5000); await assertion;
  });
});
