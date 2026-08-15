import { describe, expect, it } from "vitest";

import {
  adminIncidentsGlobalEmptyNotice,
  adminIncidentsKanbanColumnEmptyHelper,
  adminIncidentsKanbanColumnEmptyTitle,
  adminIncidentsNoFacilityNotice,
  formatIncidentFollowupDueLabel,
  INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL,
  incidentFollowupDueBadgeText,
} from "./incidents-board-copy";

describe("adminIncidentsKanbanColumnEmptyCopy", () => {
  it("names an empty column without SaaS queue language", () => {
    expect(adminIncidentsKanbanColumnEmptyTitle()).toBe("No incidents in this column");
    expect(adminIncidentsKanbanColumnEmptyHelper()).toContain("their own columns");
  });
});

describe("adminIncidentsGlobalEmptyNotice", () => {
  it("refuses fallback cards without inventing incidents", () => {
    expect(adminIncidentsGlobalEmptyNotice()).toContain("No live incident records");
    expect(adminIncidentsGlobalEmptyNotice()).toContain("not shown");
  });
});

describe("adminIncidentsNoFacilityNotice", () => {
  it("names the facility selection gap in one line", () => {
    expect(adminIncidentsNoFacilityNotice()).toContain("Select a facility");
  });
});

describe("formatIncidentFollowupDueLabel", () => {
  it("returns the formatted due string when follow-up due exists", () => {
    expect(
      formatIncidentFollowupDueLabel({
        followupDueMs: 1_700_000_000_000,
        followupDueStr: "Mar 5, 3:00 PM",
      }),
    ).toBe("Mar 5, 3:00 PM");
  });

  it("returns null when no follow-up due ms", () => {
    expect(
      formatIncidentFollowupDueLabel({
        followupDueMs: 0,
        followupDueStr: INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL,
      }),
    ).toBeNull();
  });

  it("never surfaces the dash sentinel", () => {
    expect(
      formatIncidentFollowupDueLabel({
        followupDueMs: 1_700_000_000_000,
        followupDueStr: INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL,
      }),
    ).toBeNull();
    expect(
      formatIncidentFollowupDueLabel({
        followupDueMs: 0,
        followupDueStr: INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL,
      }),
    ).toBeNull();
  });

  it("returns null for blank follow-up due strings", () => {
    expect(
      formatIncidentFollowupDueLabel({
        followupDueMs: 1,
        followupDueStr: "   ",
      }),
    ).toBeNull();
  });
});

describe("incidentFollowupDueBadgeText", () => {
  it("builds badge copy when due exists", () => {
    expect(
      incidentFollowupDueBadgeText({
        followupDueMs: 1_700_000_000_000,
        followupDueStr: "Mar 5, 3:00 PM",
      }),
    ).toBe("Next due Mar 5, 3:00 PM");
  });

  it("omits badge text when due is missing", () => {
    expect(
      incidentFollowupDueBadgeText({
        followupDueMs: 0,
        followupDueStr: INCIDENT_FOLLOWUP_DUE_MISSING_SENTINEL,
      }),
    ).toBeNull();
  });
});
