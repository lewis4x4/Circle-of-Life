import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/test-utils/fake-supabase";

import { dietaryMealsTodayStartUtcIso, fetchDietaryDashboardBrief } from "./dashboard-brief";

const FACILITY = "00000000-0000-4000-8000-000000000001";

describe("fetchDietaryDashboardBrief (COL-649)", () => {
  it("throws on a refused count instead of reporting census 0", async () => {
    const { client } = fakeSupabase((call) =>
      call.head ? { count: null, error: { message: "permission denied" } } : { data: [] },
    );
    await expect(fetchDietaryDashboardBrief(FACILITY, client)).rejects.toBeTruthy();
  });

  it("throws on a failed list read instead of an empty breakdown", async () => {
    const { client } = fakeSupabase((call) => (call.head ? { count: 3 } : { error: { message: "timeout" } }));
    await expect(fetchDietaryDashboardBrief(FACILITY, client)).rejects.toBeTruthy();
  });

  it("returns real counts", async () => {
    const { client } = fakeSupabase((call) => (call.head ? { count: 4 } : { data: [] }));
    const brief = await fetchDietaryDashboardBrief(FACILITY, client);
    expect(brief.censusCount).toBe(4);
    expect(brief.specialDietBreakdown).toEqual([]);
  });
});

describe("dietaryMealsTodayStartUtcIso", () => {
  it("uses Eastern midnight after 8 p.m. ET instead of the next UTC date", () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

    expect(dietaryMealsTodayStartUtcIso(eightOhFivePmEt)).toBe(
      "2026-08-20T04:00:00.000Z",
    );
    expect(dietaryMealsTodayStartUtcIso(eightOhFivePmEt)).not.toBe(
      "2026-08-21T00:00:00.000Z",
    );
  });
});
