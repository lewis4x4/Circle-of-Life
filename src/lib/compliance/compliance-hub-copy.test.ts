import { describe, expect, it } from "vitest";

import {
  complianceRollupScopeCopy,
  compliancePocDueDateLabel,
  compliancePocDueLine,
  complianceScoreEmptyCopy,
  complianceScoreLoadingCopy,
  complianceSnapshotTileDisplay,
  complianceSnapshotTileLoadingCopy,
  complianceSurveyVisitInactiveCopy,
  complianceSurveyVisitLoadingCopy,
  complianceSurveyVisitNotScopedCopy,
  complianceSurveyVisitStatusCopy,
} from "./compliance-hub-copy";

describe("compliancePocDueDateLabel", () => {
  it("returns the due date when posted", () => {
    expect(compliancePocDueDateLabel("2026-09-15")).toBe("2026-09-15");
  });

  it("names the gap when no POC due date is posted", () => {
    expect(compliancePocDueDateLabel(null)).toBe("No POC due date posted");
  });
});

describe("compliancePocDueLine", () => {
  it("prefixes the due date label for deficiency rows", () => {
    expect(compliancePocDueLine("2026-09-15")).toBe("POC Due: 2026-09-15");
    expect(compliancePocDueLine(null)).toBe("POC Due: No POC due date posted");
  });
});

describe("complianceSnapshotTileDisplay", () => {
  it("shows loading copy instead of a dash while metrics load", () => {
    expect(complianceSnapshotTileDisplay(null)).toBe(complianceSnapshotTileLoadingCopy());
  });

  it("shows the loaded metric value", () => {
    expect(complianceSnapshotTileDisplay(3)).toBe(3);
    expect(complianceSnapshotTileDisplay(0)).toBe(0);
  });
});

describe("complianceSurveyVisitLoadingCopy", () => {
  it("explains the survey visit check is in flight", () => {
    expect(complianceSurveyVisitLoadingCopy()).toBe("Checking survey visit status…");
  });
});

describe("complianceSurveyVisitInactiveCopy", () => {
  it("states when no survey visit session is active", () => {
    expect(complianceSurveyVisitInactiveCopy()).toBe("No active session.");
  });
});

describe("complianceSurveyVisitNotScopedCopy", () => {
  it("names the gap when survey visit status is not facility-scoped", () => {
    expect(complianceSurveyVisitNotScopedCopy()).toBe(
      "Survey visit sessions run per building; choose one to see its status.",
    );
  });
});

describe("complianceSurveyVisitStatusCopy", () => {
  it("names the unscoped gap instead of fabricating inactive", () => {
    expect(complianceSurveyVisitStatusCopy(null)).toBe(complianceSurveyVisitNotScopedCopy());
  });

  it("reports active and inactive sessions from snapshot truth", () => {
    expect(complianceSurveyVisitStatusCopy(true)).toBe("● Session active for this facility.");
    expect(complianceSurveyVisitStatusCopy(false)).toBe(complianceSurveyVisitInactiveCopy());
  });
});

describe("complianceRollupScopeCopy", () => {
  it("labels All-facilities tiles as a rollup rather than a dead end (COL-651)", () => {
    expect(complianceRollupScopeCopy()).toMatch(/all your facilities/);
    expect(complianceRollupScopeCopy()).not.toMatch(/select a facility/i);
  });
});

describe("complianceScoreEmptyCopy", () => {
  it("names the survey score gap without inventing a percentage", () => {
    expect(complianceScoreEmptyCopy()).toBe("Survey score not loaded for this facility");
  });
});

describe("complianceScoreLoadingCopy", () => {
  it("explains the score check is in flight", () => {
    expect(complianceScoreLoadingCopy()).toBe("Loading compliance score…");
  });
});
