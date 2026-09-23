import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";
import {
  fetchResidentAssuranceCommandBrief,
  fetchResidentAssuranceFacilityHeatMap,
  fetchResidentAssuranceFacilityTrendSeries,
} from "./command-center-brief";

const FACILITY = "00000000-0000-4000-8000-0000000000f1";
const OVER_CAP = 1494;

type Reply = { data?: unknown[] | null; count?: number | null; error: { message: string } | null };

/** Query double: records every call; `answer` decides the reply from the table and recorded calls. */
function client(answer: (table: string, calls: unknown[][]) => Reply) {
  const log: Array<{ table: string; calls: unknown[][] }> = [];
  const from = vi.fn((table: string) => {
    const calls: unknown[][] = [];
    log.push({ table, calls });
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "gte", "order", "limit", "range"]) {
      query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
    }
    query.then = (resolve: (reply: Reply) => unknown) => Promise.resolve(answer(table, calls)).then(resolve);
    return query;
  });
  return { supabase: { from } as unknown as SupabaseClient<Database>, log };
}

const isHeadCount = (calls: unknown[][]) =>
  calls.some(([method, , options]) => method === "select" && (options as { head?: boolean } | undefined)?.head === true);

describe("command-center brief counts (COL-640)", () => {
  it("reports open escalations past PostgREST's 1000-row cap from the exact count", async () => {
    const { supabase, log } = client((table, calls) => {
      if (table === "resident_observation_escalations") return { count: OVER_CAP, error: null };
      if (isHeadCount(calls)) return { count: 0, error: null };
      return { data: [], count: 0, error: null };
    });

    const brief = await fetchResidentAssuranceCommandBrief(FACILITY, supabase);

    expect(brief.openEscalations).toBe(OVER_CAP);
    const escalations = log.find((q) => q.table === "resident_observation_escalations")!;
    expect(escalations.calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
    expect(escalations.calls).toContainEqual(["eq", "facility_id", FACILITY]);
  });

  it("tallies critical and high safety residents from each resident's newest score, across pages", async () => {
    // 1,200 residents: past the 1000-row cap, so a single select would drop 200.
    const residents = Array.from({ length: 1200 }, (_, index) => ({
      id: `r-${index}`,
      facility_id: FACILITY,
      first_name: "Resident",
      last_name: String(index),
      preferred_name: null,
      resident_safety_scores:
        index < 1100
          ? [{ score: 10 + (index % 50), risk_tier: index % 2 === 0 ? "critical" : "high", computed_at: "2026-09-22T06:00:00Z" }]
          : [],
    }));
    const { supabase, log } = client((table, calls) => {
      if (table === "residents") {
        const range = calls.find(([m]) => m === "range") as [string, number, number];
        const end = Math.min(range[2], range[1] + 999);
        return { data: residents.slice(range[1], end + 1), count: residents.length, error: null };
      }
      return isHeadCount(calls) ? { count: 0, error: null } : { data: [], count: 0, error: null };
    });

    const brief = await fetchResidentAssuranceCommandBrief(FACILITY, supabase);

    expect(brief.criticalSafetyResidents).toBe(550);
    expect(brief.highOrCriticalSafetyResidents).toBe(1100);
    expect(brief.highRiskResidents).toHaveLength(4);
    const residentReads = log.filter((q) => q.table === "residents");
    expect(residentReads.length).toBeGreaterThan(1);
    expect(residentReads[0]!.calls).toContainEqual(["limit", 1, { referencedTable: "resident_safety_scores" }]);
    expect(residentReads[0]!.calls).toContainEqual(["eq", "facility_id", FACILITY]);
    // Score history is never selected directly (and so never capped).
    expect(log.some((q) => q.table === "resident_safety_scores")).toBe(false);
  });

  it("throws rather than reporting zero when a count fails", async () => {
    const { supabase } = client((table, calls) =>
      table === "resident_observation_escalations"
        ? { count: null, error: { message: "boom" } }
        : isHeadCount(calls) ? { count: 0, error: null } : { data: [], count: 0, error: null },
    );
    await expect(fetchResidentAssuranceCommandBrief(FACILITY, supabase)).rejects.toThrow("boom");
  });
});

describe("facility heat map counts (COL-640)", () => {
  it("counts each facility's escalations exactly instead of tallying a capped select", async () => {
    const { supabase, log } = client((table, calls) => {
      if (table === "facilities") return { data: [{ id: FACILITY, name: "Homewood" }], error: null };
      if (table === "resident_observation_escalations") return { count: OVER_CAP, error: null };
      if (table === "residents") {
        return {
          data: [{
            id: "r-1", facility_id: FACILITY, first_name: "A", last_name: "B", preferred_name: null,
            resident_safety_scores: [{ score: 12, risk_tier: "critical", computed_at: "2026-09-22T06:00:00Z" }],
          }],
          count: 1,
          error: null,
        };
      }
      return isHeadCount(calls) ? { count: 0, error: null } : { data: [], count: 0, error: null };
    });

    const [row] = await fetchResidentAssuranceFacilityHeatMap(supabase, "org");

    expect(row).toMatchObject({ openEscalations: OVER_CAP, criticalSafetyResidents: 1, highOrCriticalSafetyResidents: 1 });
    const escalations = log.find((q) => q.table === "resident_observation_escalations")!;
    expect(escalations.calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
    expect(escalations.calls).toContainEqual(["eq", "facility_id", FACILITY]);
  });
});

describe("facility trend paging (COL-640)", () => {
  it("reads every escalation in the window across pages, not the first 1000", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
    try {
      const all = Array.from({ length: OVER_CAP }, () => ({ facility_id: FACILITY, triggered_at: "2026-09-22T05:00:00Z" }));
      const { supabase } = client((table, calls) => {
        if (table === "facilities") return { data: [{ id: FACILITY, name: "Homewood" }], error: null };
        if (table === "resident_observation_escalations") {
          const range = calls.find(([m]) => m === "range") as [string, number, number];
          // Simulate the hosted cap: never more than 1000 rows per response.
          const end = Math.min(range[2], range[1] + 999);
          return { data: all.slice(range[1], end + 1), count: all.length, error: null };
        }
        return { data: [], count: 0, error: null };
      });

      const [row] = await fetchResidentAssuranceFacilityTrendSeries(supabase, "org", 1);

      expect(row?.points[0]?.escalations).toBe(OVER_CAP);
    } finally {
      vi.useRealTimers();
    }
  });
});
