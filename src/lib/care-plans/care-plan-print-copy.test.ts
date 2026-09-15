import { describe, expect, it } from "vitest";

import { CARE_PLAN_NO_DATE_COPY } from "./care-plan-display-copy";
import {
  CARE_PLAN_PRINT_ARCHIVED_BANNER,
  CARE_PLAN_PRINT_DRAFT_BANNER,
  CARE_PLAN_PRINT_NO_APPROVER_COPY,
  CARE_PLAN_PRINT_NO_ASSISTANCE_LEVEL_COPY,
  CARE_PLAN_PRINT_NO_ROOM_COPY,
  CARE_PLAN_PRINT_NO_TIMESTAMP_COPY,
  formatCarePlanPrintAction,
  formatCarePlanPrintApprover,
  formatCarePlanPrintAssistanceLevel,
  formatCarePlanPrintBanner,
  formatCarePlanPrintCategoryLabel,
  formatCarePlanPrintDateOfBirth,
  formatCarePlanPrintRoom,
  formatCarePlanPrintTimestamp,
} from "./care-plan-print-copy";

describe("formatCarePlanPrintAction", () => {
  it("says which copy the button prints", () => {
    expect(formatCarePlanPrintAction("active")).toBe("Print signed plan");
    expect(formatCarePlanPrintAction("archived")).toBe("Print archived copy");
    expect(formatCarePlanPrintAction("draft")).toBe("Print draft");
    expect(formatCarePlanPrintAction("under_review")).toBe("Print draft");
  });
});

describe("formatCarePlanPrintBanner", () => {
  it("prints a signed plan with no banner", () => {
    expect(formatCarePlanPrintBanner("active", null)).toBeNull();
  });

  it("marks anything unsigned as a draft that is not in effect", () => {
    expect(formatCarePlanPrintBanner("draft", null)).toBe(CARE_PLAN_PRINT_DRAFT_BANNER);
    expect(formatCarePlanPrintBanner("under_review", null)).toBe(CARE_PLAN_PRINT_DRAFT_BANNER);
    expect(formatCarePlanPrintBanner(null, null)).toBe(CARE_PLAN_PRINT_DRAFT_BANNER);
  });

  it("names the superseding version on an archived plan when known", () => {
    expect(formatCarePlanPrintBanner("archived", 4)).toBe("SUPERSEDED by v4 — no longer in effect");
    expect(formatCarePlanPrintBanner("archived", null)).toBe(CARE_PLAN_PRINT_ARCHIVED_BANNER);
  });
});

describe("formatCarePlanPrintTimestamp", () => {
  it("renders in Eastern time with the zone named", () => {
    // 21:16 UTC on 2026-09-15 is 5:16 PM EDT.
    expect(formatCarePlanPrintTimestamp("2026-09-15T21:16:27.651Z")).toBe("Sep 15, 2026, 5:16 PM ET");
  });

  it("names a missing or unparseable instant", () => {
    expect(formatCarePlanPrintTimestamp(null)).toBe(CARE_PLAN_PRINT_NO_TIMESTAMP_COPY);
    expect(formatCarePlanPrintTimestamp("  ")).toBe(CARE_PLAN_PRINT_NO_TIMESTAMP_COPY);
    expect(formatCarePlanPrintTimestamp("not-a-date")).toBe(CARE_PLAN_PRINT_NO_TIMESTAMP_COPY);
  });
});

describe("formatCarePlanPrintDateOfBirth", () => {
  it("shares the care-plan date-only format", () => {
    expect(formatCarePlanPrintDateOfBirth("1946-10-15")).toBe("Oct 15, 1946");
    expect(formatCarePlanPrintDateOfBirth(null)).toBe(CARE_PLAN_NO_DATE_COPY);
  });
});

describe("formatCarePlanPrintAssistanceLevel", () => {
  it("spells out the enum value", () => {
    expect(formatCarePlanPrintAssistanceLevel("limited_assist")).toBe("Limited Assist");
    expect(formatCarePlanPrintAssistanceLevel("total_dependence")).toBe("Total Dependence");
  });

  it("names a missing level", () => {
    expect(formatCarePlanPrintAssistanceLevel(null)).toBe(CARE_PLAN_PRINT_NO_ASSISTANCE_LEVEL_COPY);
    expect(formatCarePlanPrintAssistanceLevel("")).toBe(CARE_PLAN_PRINT_NO_ASSISTANCE_LEVEL_COPY);
  });
});

describe("formatCarePlanPrintCategoryLabel", () => {
  it("title-cases the category and falls back to Other", () => {
    expect(formatCarePlanPrintCategoryLabel("medication_assistance")).toBe("Medication Assistance");
    expect(formatCarePlanPrintCategoryLabel(null)).toBe("Other");
  });
});

describe("formatCarePlanPrintRoom", () => {
  it("joins room and bed like the roster", () => {
    expect(formatCarePlanPrintRoom("10", "B")).toBe("10-B");
    expect(formatCarePlanPrintRoom("10", null)).toBe("10");
  });

  it("says when no bed is linked", () => {
    expect(formatCarePlanPrintRoom(null, "B")).toBe(CARE_PLAN_PRINT_NO_ROOM_COPY);
    expect(formatCarePlanPrintRoom(" ", null)).toBe(CARE_PLAN_PRINT_NO_ROOM_COPY);
  });
});

describe("formatCarePlanPrintApprover", () => {
  it("returns the posted name or names the gap", () => {
    expect(formatCarePlanPrintApprover("  Charlene Elmore ")).toBe("Charlene Elmore");
    expect(formatCarePlanPrintApprover(null)).toBe(CARE_PLAN_PRINT_NO_APPROVER_COPY);
  });
});
