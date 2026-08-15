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
  it("prompts for facility scope when none is selected", () => {
    expect(residentRosterOpenBedsEmptyCopy(null, null)).toBe("Select a facility to load capacity");
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
      "Select a facility to load reviews",
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
      "Select a facility in the header — capacity and review tiles load per site.",
    );
  });

  it("celebrates a fully loaded facility metric strip", () => {
    expect(residentRosterKpiStripHelperLine(FACILITY_ID, true, true)).toBe(
      "Capacity and review schedule loaded for the selected facility.",
    );
  });

  it("reassures when every facility metric tile is empty", () => {
    expect(residentRosterKpiStripHelperLine(FACILITY_ID, false, false)).toBe(
      "Empty tiles name what is still missing — nothing is broken.",
    );
  });

  it("counts partial facility metric loads", () => {
    expect(residentRosterKpiStripHelperLine(FACILITY_ID, true, false)).toBe(
      "1 of 2 facility metrics loaded — empty tiles name what is still missing.",
    );
  });
});
