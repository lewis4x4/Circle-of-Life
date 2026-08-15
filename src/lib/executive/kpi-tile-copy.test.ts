import { describe, expect, it } from "vitest";

import {
  executiveKpiEmptyCopy,
  executiveKpiStripHelperLine,
  occupancyLoadedFootnote,
} from "./kpi-tile-copy";

describe("executiveKpiEmptyCopy", () => {
  it("names the payroll gap for labor cost", () => {
    expect(executiveKpiEmptyCopy("labor_pct")).toBe("No payroll loaded this period");
  });

  it("names the survey gap for survey readiness", () => {
    expect(executiveKpiEmptyCopy("survey_rd")).toBe("No survey on file");
  });
});

describe("occupancyLoadedFootnote", () => {
  it("explains loaded census vs licensed beds", () => {
    expect(occupancyLoadedFootnote({ occupiedResidents: 33, licensedBeds: 258 })).toBe(
      "33 in census · 258 licensed beds",
    );
  });

  it("returns null when census context is incomplete", () => {
    expect(occupancyLoadedFootnote({ occupiedResidents: 0, licensedBeds: 258 })).toBeNull();
    expect(occupancyLoadedFootnote({ occupiedResidents: 33, licensedBeds: 0 })).toBeNull();
  });
});

describe("executiveKpiStripHelperLine", () => {
  it("celebrates a fully loaded strip", () => {
    expect(executiveKpiStripHelperLine(5, 5)).toBe(
      "All KPIs loaded from the latest executive snapshot.",
    );
  });

  it("reassures when every tile is empty", () => {
    expect(executiveKpiStripHelperLine(0, 5)).toBe(
      "Empty tiles name what is still missing — nothing is broken.",
    );
  });

  it("counts partial loads", () => {
    expect(executiveKpiStripHelperLine(3, 5)).toBe(
      "3 of 5 KPIs loaded — empty tiles name what is still missing.",
    );
  });
});
