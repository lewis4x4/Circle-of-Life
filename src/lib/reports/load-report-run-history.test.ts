import { describe, expect, it } from "vitest";

import { describeReportRun } from "./load-report-run-history";
import { enabledStarterPackIds } from "./recommended-packs";

const now = new Date("2026-09-22T18:00:00Z");
const names = {
  reports: new Map([["tpl-incident", "Incident Trend Summary"]]),
  facilities: new Map([["fac-homewood", "Homewood Lodge"]]),
  users: new Map([["user-1", "Jessica Owner"]]),
};
const base = {
  id: "run-1",
  source_type: "template",
  source_id: "tpl-incident",
  template_id: "tpl-incident",
  status: "running",
  started_at: "2026-06-15T18:15:41Z",
  completed_at: null,
  generated_by_user_id: null,
  schedule_id: null,
  run_scope_json: { facility_id: "fac-homewood" },
  report_title: null,
  scope_label: null,
};

describe("describeReportRun (COL-643)", () => {
  it("names the report and facility for a run that saved no snapshot, and calls a months-old running run interrupted", () => {
    const item = describeReportRun(base, names, now);
    expect(item.reportName).toBe("Incident Trend Summary");
    expect(item.facilityLabel).toBe("Homewood Lodge");
    expect(item.runByLabel).toBe("Not recorded");
    expect(item.state.kind).toBe("interrupted");
  });

  it("names the person who ran it, or the scheduler for scheduled runs", () => {
    expect(describeReportRun({ ...base, generated_by_user_id: "user-1" }, names, now).runByLabel).toBe("Jessica Owner");
    expect(describeReportRun({ ...base, schedule_id: "sch-1" }, names, now)).toMatchObject({
      runByLabel: "Report scheduler",
      runKindLabel: "Scheduled",
    });
  });

  it("an org-wide run reads All facilities", () => {
    expect(describeReportRun({ ...base, run_scope_json: { facility_id: null } }, names, now).facilityLabel).toBe("All facilities");
  });
});

describe("enabledStarterPackIds (COL-643)", () => {
  it("finds the CEO weekly and Compliance quarterly starters already enabled in production", () => {
    const ids = enabledStarterPackIds([
      { description: "[starter:ceo-weekly]Occupancy, operating scorecard" },
      { description: "[starter:compliance-quarterly]Survey readiness" },
      { description: "Custom pack" },
      { description: null },
    ]);
    expect([...ids].sort()).toEqual(["ceo-weekly", "compliance-quarterly"]);
  });
});
