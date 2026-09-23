import { describe, expect, it } from "vitest";

import type { SupabaseIncidentDetail } from "@/lib/incidents/load-incident-detail";

import { buildIncidentWorkflowSummary } from "./incident-workflow-summary";

function incident(overrides: Partial<SupabaseIncidentDetail>): SupabaseIncidentDetail {
  return {
    status: "open",
    severity: "level_1",
    occurred_at: "2026-06-15T12:00:00Z",
    discovered_at: "2026-06-15T12:00:00Z",
    resolved_at: null,
    care_plan_updated: false,
    ...overrides,
  } as SupabaseIncidentDetail;
}

const NOW = new Date("2026-09-23T12:00:00Z");

describe("incident workflow summary (COL-649)", () => {
  it("an open incident with nothing else pending is not operationally clear", () => {
    const summary = buildIncidentWorkflowSummary(incident({}), "none", [], [], NOW);
    expect(summary.operationallyClear).toBe(false);
    expect(summary.tone).toBe("warning");
    expect(summary.nextActions[0]).toBe("Triage this incident and resolve it — it has been open for 100 days.");
  });

  it("a resolved incident with nothing pending is clear", () => {
    const summary = buildIncidentWorkflowSummary(
      incident({ status: "resolved", resolved_at: "2026-06-16T12:00:00Z" }),
      "none",
      [],
      [],
      NOW,
    );
    expect(summary.operationallyClear).toBe(true);
    expect(summary.nextActions).toEqual([]);
  });
});
