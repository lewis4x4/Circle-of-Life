import { describe, expect, it } from "vitest";

import type { ResidentRosterMetrics } from "./resident-roster-metrics";
import {
  residentRosterCarePlanReviewsEmptyCopy,
  residentRosterFacilityScopeReady,
  residentRosterKpiStripHelperLine,
  residentRosterOpenBedsEmptyCopy,
  rosterOpenBedsLoadedFootnote,
} from "./resident-roster-kpi-copy";

const FACILITY_ID = "a0000000-0000-4000-8000-000000000001";

function metrics(partial: Partial<ResidentRosterMetrics>): ResidentRosterMetrics {
  return {
    licensedBeds: null,
    occupiedResidents: 0,
    openBeds: null,
    carePlanReviewsDueWeek: null,
    carePlanCoverage: null,
    ...partial,
  };
}

describe("residentRosterFacilityScopeReady", () => {
  it("rejects null and non-uuid facility ids", () => {
    expect(residentRosterFacilityScopeReady(null)).toBe(false);
    expect(residentRosterFacilityScopeReady("")).toBe(false);
    expect(residentRosterFacilityScopeReady("not-a-uuid")).toBe(false);
  });

  it("accepts a valid facility uuid", () => {
    expect(residentRosterFacilityScopeReady(FACILITY_ID)).toBe(true);
  });
});

describe("residentRosterOpenBedsEmptyCopy", () => {
  it("says capacity is per building under All facilities, without gate copy in the value slot", () => {
    expect(residentRosterOpenBedsEmptyCopy(null, null)).toBe("Counted per building");
  });

  it("names a metrics load gap when scope is set but metrics failed", () => {
    expect(residentRosterOpenBedsEmptyCopy(FACILITY_ID, null)).toBe("Capacity not loaded yet");
  });

  it("names missing licensed beds when capacity lookup is incomplete", () => {
    expect(
      residentRosterOpenBedsEmptyCopy(
        FACILITY_ID,
        metrics({ licensedBeds: null, openBeds: null, occupiedResidents: 12 }),
      ),
    ).toBe("Licensed beds not on file");
  });

  it("returns null when open beds are loaded", () => {
    expect(
      residentRosterOpenBedsEmptyCopy(
        FACILITY_ID,
        metrics({ licensedBeds: 52, openBeds: 8, occupiedResidents: 44 }),
      ),
    ).toBeNull();
  });
});

describe("residentRosterCarePlanReviewsEmptyCopy", () => {
  it("prompts for facility scope when none is selected", () => {
    expect(residentRosterCarePlanReviewsEmptyCopy(null, null)).toBe(
      "Counted per building",
    );
  });

  it("names a load gap when review counts are absent", () => {
    expect(residentRosterCarePlanReviewsEmptyCopy(FACILITY_ID, null)).toBe(
      "Review schedule not loaded yet",
    );
    expect(
      residentRosterCarePlanReviewsEmptyCopy(
        FACILITY_ID,
        metrics({ carePlanReviewsDueWeek: null }),
      ),
    ).toBe("Review schedule not loaded yet");
  });

  it("returns null when zero reviews due is a real loaded count", () => {
    expect(
      residentRosterCarePlanReviewsEmptyCopy(
        FACILITY_ID,
        metrics({ carePlanReviewsDueWeek: 0 }),
      ),
    ).toBeNull();
  });
});

describe("rosterOpenBedsLoadedFootnote", () => {
  it("explains loaded census vs licensed beds", () => {
    expect(
      rosterOpenBedsLoadedFootnote(
        metrics({ licensedBeds: 52, openBeds: 8, occupiedResidents: 44 }),
      ),
    ).toBe("44 in census · 52 licensed beds");
  });

  it("returns null when capacity context is incomplete", () => {
    expect(rosterOpenBedsLoadedFootnote(metrics({ licensedBeds: null, openBeds: null }))).toBeNull();
  });
});

describe("residentRosterKpiStripHelperLine", () => {
  it("prompts for header facility scope when none is selected", () => {
    expect(residentRosterKpiStripHelperLine(null, false, false)).toBe(
      "Unoccupied beds and care plan reviews are counted per building. The roster below covers all your facilities.",
    );
  });

  it("says nothing when every facility figure loaded — loaded is not the same as complete", () => {
    expect(residentRosterKpiStripHelperLine(FACILITY_ID, true, true)).toBeNull();
  });

  it("names the gap when no facility figure loaded", () => {
    expect(residentRosterKpiStripHelperLine(FACILITY_ID, false, false)).toBe(
      "Capacity and care plan figures did not load — the empty cells name what is missing.",
    );
  });

  it("counts partial facility figure loads", () => {
    expect(residentRosterKpiStripHelperLine(FACILITY_ID, true, false)).toBe(
      "1 of 2 facility figures loaded — the empty cell names what is missing.",
    );
  });
});
