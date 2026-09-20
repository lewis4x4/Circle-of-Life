import { describe, expect, it, vi } from "vitest";

import {
  fetchExecutiveFacilityCompliance,
  lastSevenCompletedFacilityDays,
} from "./facility-rounding-compliance";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

describe("fetchExecutiveFacilityCompliance", () => {
  it("uses the Eastern date before UTC midnight without applying the timezone twice", () => {
    const beforeUtcMidnight = new Date("2026-08-20T00:30:00-04:00");

    expect(lastSevenCompletedFacilityDays(beforeUtcMidnight)).toEqual({
      from: "2026-08-13",
      to: "2026-08-19",
    });
    expect(beforeUtcMidnight.toISOString().slice(0, 10)).toBe("2026-08-20");
  });

  it("uses seven completed Eastern days across the UTC date rollover", () => {
    const afterUtcRollover = new Date("2026-08-20T20:05:00-04:00");

    expect(lastSevenCompletedFacilityDays(afterUtcRollover)).toEqual({
      from: "2026-08-13",
      to: "2026-08-19",
    });
    expect(afterUtcRollover.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("reads the existing historical compliance route for seven completed Eastern calendar days", async () => {
    const payload = {
      from: "2026-08-13",
      to: "2026-08-19",
      totals: { expected: 6, satisfied: 5, unconfigured: 0, absorbed: 1, withTask: 5, onTime: 4, late: 1 },
      byShift: [],
      byHall: [],
      byStaff: [],
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      fetchExecutiveFacilityCompliance(
        FACILITY_ID,
        new Date("2026-08-20T20:05:00-04:00"),
        fetcher,
      ),
    ).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/rounding/compliance?facilityId=${FACILITY_ID}&from=2026-08-13&to=2026-08-19`,
      { cache: "no-store" },
    );
  });

  it("rejects failed and malformed reads instead of returning an empty result", async () => {
    const failed = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "No access to this facility" }), { status: 403 }),
    );
    await expect(
      fetchExecutiveFacilityCompliance(FACILITY_ID, new Date(), failed),
    ).rejects.toThrow("No access to this facility");

    const malformed = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ totals: null }), { status: 200 }),
    );
    await expect(
      fetchExecutiveFacilityCompliance(FACILITY_ID, new Date(), malformed),
    ).rejects.toThrow(/could not be read/i);
  });
});
