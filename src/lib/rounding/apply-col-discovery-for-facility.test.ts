import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyColDiscoveryForFacility } from "./apply-col-discovery-for-facility";
import { COL_DISCOVERY_FACILITY_NAMES } from "./col-discovery-round-cadence";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe("applyColDiscoveryForFacility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFrom.mockReset();
  });

  it("blocks Plantation with pending cadence copy", async () => {
    const result = await applyColDiscoveryForFacility({
      facilityId: "facility-plantation",
      facilityName: COL_DISCOVERY_FACILITY_NAMES.plantation,
    });

    expect(result).toEqual({
      ok: false,
      code: "plantation_pending",
      message:
        "Plantation discovery cadence is pending owner decision. Apply defaults after Jessica supplies times.",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns calm empty census copy without calling apply API", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    });

    const result = await applyColDiscoveryForFacility({
      facilityId: "facility-oakridge",
      facilityName: COL_DISCOVERY_FACILITY_NAMES.oakridge,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("empty_census");
      expect(result.message).toContain("No active residents");
    }
  });

  it("applies discovery defaults for each resident then generates tasks", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: async () => ({ data: [{ id: "resident-1" }, { id: "resident-2" }], error: null }),
          }),
        }),
      }),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, planId: "plan-1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, planId: "plan-2" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    vi.stubGlobal("fetch", fetchMock);

    const result = await applyColDiscoveryForFacility({
      facilityId: "facility-oakridge",
      facilityName: COL_DISCOVERY_FACILITY_NAMES.oakridge,
    });

    expect(result).toEqual({ ok: true, appliedCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/rounding/plans/apply-discovery-default");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/rounding/generate-tasks");
  });
});
