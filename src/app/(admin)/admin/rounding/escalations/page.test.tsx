import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY } from "@/lib/rounding/observation-plan-display-copy";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "./page.tsx"),
  "utf8",
);

describe("AdminRoundingEscalationsPage facility scope and Eastern timestamps", () => {
  it("does not interpolate legacy selected facility copy", () => {
    expect(pageSource).not.toContain('"selected facility"');
    expect(pageSource).not.toContain("'selected facility'");
    expect(pageSource).toContain("resolveEscalationsFacilityScope");
    expect(pageSource).toContain("formatEscalationsPageSubtitle");
  });

  it("reuses the shared select-facility gap copy", () => {
    expect(pageSource).toContain("formatEscalationsNoFacilityInterstitialBody");
    expect(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY).toBe("Select a facility first.");
  });

  it("labels escalation timestamps as Eastern (ET) and names loading", () => {
    expect(pageSource).toContain("Eastern (ET)");
    expect(pageSource).toContain("formatEscalationsDateTimeEt");
    expect(pageSource).toContain("formatEscalationsLoadingNotice");
    expect(pageSource).toContain("ESCALATIONS_ET_TIMEZONE_CUE");
  });
});
