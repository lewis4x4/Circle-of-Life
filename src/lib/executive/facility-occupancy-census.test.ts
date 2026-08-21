import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import {
  aggregateBedCensusByFacility,
  computeFacilityOccupancyPct,
  fetchFacilityBedCensusById,
  isFacilityOccupancyCensusLoaded,
} from "./facility-occupancy-census";

const siteAlpha = { id: "site-alpha", total_licensed_beds: 52 };
const siteBeta = { id: "site-beta", total_licensed_beds: 48 };

describe("facility occupancy census honesty", () => {
  it("treats unloaded facilities as missing census", () => {
    expect(isFacilityOccupancyCensusLoaded(siteBeta, undefined)).toBe(false);
    expect(computeFacilityOccupancyPct(siteBeta, undefined)).toBeNull();
  });

  it("keeps loaded empty facilities at 0%", () => {
    const census = aggregateBedCensusByFacility([
      { facility_id: "site-alpha", current_resident_id: null },
      { facility_id: "site-alpha", current_resident_id: null },
    ]);

    expect(isFacilityOccupancyCensusLoaded(siteAlpha, census.get("site-alpha"))).toBe(true);
    expect(computeFacilityOccupancyPct(siteAlpha, census.get("site-alpha"))).toBe(0);
  });

  it("computes occupied facility percent from bed grid", () => {
    const census = aggregateBedCensusByFacility([
      { facility_id: "site-alpha", current_resident_id: "resident-1" },
      { facility_id: "site-alpha", current_resident_id: null },
      { facility_id: "site-alpha", current_resident_id: "resident-2" },
      { facility_id: "site-alpha", current_resident_id: null },
    ]);

    expect(computeFacilityOccupancyPct(siteAlpha, census.get("site-alpha"))).toBe(50);
  });

  it("excludes soft-deleted beds from fetch query (matches facilities APIs)", () => {
    const source = readFileSync(join(__dirname, "facility-occupancy-census.ts"), "utf8");
    expect(source).toContain('.is("deleted_at", null)');
  });

  it("does not inflate licensed or occupied counts when deleted beds exist in DB", async () => {
    const activeBeds = [
      { facility_id: "site-alpha", current_resident_id: "resident-1" },
      { facility_id: "site-alpha", current_resident_id: null },
    ];

    const queryLog: Array<{ op: string; column?: string; value?: unknown }> = [];

    const supabase = {
      from(table: string) {
        expect(table).toBe("beds");
        return {
          select() {
            return this;
          },
          in(column: string, value: unknown) {
            queryLog.push({ op: "in", column, value });
            return this;
          },
          is(column: string, value: unknown) {
            queryLog.push({ op: "is", column, value });
            return this;
          },
          then(
            resolve: (value: { data: typeof activeBeds; error: null }) => void,
            reject?: (reason?: unknown) => void,
          ) {
            try {
              resolve({ data: activeBeds, error: null });
            } catch (error) {
              reject?.(error);
            }
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    const census = await fetchFacilityBedCensusById(supabase, ["site-alpha"]);

    expect(queryLog).toContainEqual({ op: "is", column: "deleted_at", value: null });
    expect(census.get("site-alpha")).toEqual({ total_beds: 2, occupancy_count: 1 });
    expect(computeFacilityOccupancyPct(siteAlpha, census.get("site-alpha"))).toBe(50);
  });
});
