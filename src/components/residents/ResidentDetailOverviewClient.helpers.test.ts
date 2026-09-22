import { describe, expect, it } from "vitest";

import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";

import { buildFeedItems, buildRecordGaps, buildTaskItems } from "./ResidentDetailOverviewClient";

const HREFS = {
  carePlanHref: "/admin/residents/r1/care-plan",
  assessmentsHref: "/admin/residents/r1/assessments",
  profileHref: "/admin/v2/residents/r1",
};

function detail(overrides: Partial<ResidentOverviewDetail> = {}): ResidentOverviewDetail {
  return {
    id: "r1",
    fullName: "Marsha Wheeler",
    initials: "MW",
    preferredName: null,
    photoUrl: null,
    acuity: 1,
    acuityLevel: null,
    status: "active",
    rawStatus: "active",
    fallRiskRaw: null,
    roomLabel: "1-A",
    unitName: "No unit on file",
    facilityName: "Homewood Lodge",
    admissionLabel: "Dec 26, 2025",
    dobLabel: "March 3, 1947",
    ageYears: 79,
    gender: "female",
    diagnosisRawList: [],
    primaryDiagnosisRaw: null,
    diagnosisListRaw: [],
    allergiesTokens: [],
    dietOrder: null,
    codeStatusRaw: "full_code",
    primaryPayer: null,
    hospiceStatus: null,
    advanceDirectiveType: null,
    advanceDirectiveOnFile: false,
    responsiblePartyName: null,
    responsiblePartyRelationship: null,
    responsiblePartyPhone: null,
    responsiblePartyEmail: null,
    primaryPhysicianName: null,
    primaryPhysicianPhone: null,
    codeStatusVerifiedAt: null,
    codeStatusVerifiedByName: null,
    allergyReviewedAt: null,
    allergyReviewedByName: null,
    diagnosesReviewedAt: null,
    diagnosesReviewedByName: null,
    carePlanVersion: null,
    carePlanEffectiveDate: null,
    carePlanAnnualDeltaDays: null,
    polstMolstRawStatus: null,
    specialistConsultActiveCount: 0,
    assessmentsUpcomingJson: [],
    contacts: [],
    recentDailyNotes: [],
    recentAdl: [],
    recentBehavior: [],
    recentConditionChanges: [],
    activityDays: 30,
    activityTruncatedKinds: [],
    presenceHistory: [],
    form1823: undefined,
    openIncidentFollowups: [],
    ...overrides,
  };
}

describe("COL-599: tasks cover the Form 1823 and incident follow-up clocks", () => {
  const now = new Date("2026-09-22T16:00:00.000Z");

  it("says no Form 1823 is on file only when the records were read", () => {
    expect(buildTaskItems(detail({ form1823: undefined }), HREFS, now).some((i) => /1823/.test(i.title))).toBe(false);
    const none = buildTaskItems(detail({ form1823: null }), HREFS, now).find((i) => i.id === "f1823-none");
    expect(none?.tone).toBe("warning");
    expect(none?.href).toBe(HREFS.carePlanHref);
  });

  it("puts an expired Form 1823 and an overdue follow-up ahead of routine items", () => {
    const items = buildTaskItems(
      detail({
        carePlanVersion: 1,
        carePlanAnnualDeltaDays: 200,
        form1823: { id: "f1", status: "received", examDate: "2025-08-01", expirationDate: "2026-08-01" },
        openIncidentFollowups: [
          { id: "fu1", incidentId: "inc1", taskType: "family_notification", description: "Call", dueAt: "2026-09-21T12:00:00.000Z" },
          { id: "fu2", incidentId: "inc1", taskType: "reassessment", description: "Re-check", dueAt: "2026-09-25T12:00:00.000Z" },
        ],
      }),
      HREFS,
      now,
    );
    expect(items.slice(0, 2).map((i) => i.id).sort()).toEqual(["f1823-expired", "fu-fu1"]);
    const overdue = items.find((i) => i.id === "fu-fu1");
    expect(overdue?.title).toBe("Family notification (incident follow-up)");
    expect(overdue?.href).toBe("/admin/incidents/inc1");
    expect(items.find((i) => i.id === "fu-fu2")?.tone).toBe("muted");
  });

  it("appends benefits tasks passed in from the benefits API", () => {
    const items = buildTaskItems(detail({ carePlanVersion: 1 }), HREFS, now, [
      { id: "bn-1-renewal", title: "Medicaid long-term care renewal", tone: "danger", sub: "Renewal date passed 3 days ago", href: "/admin/benefits/1" },
    ]);
    expect(items[0].id).toBe("bn-1-renewal");
  });
});

describe("overview tasks come from recorded due dates only", () => {
  it("names a missing care plan as the task instead of placeholder tasks", () => {
    const items = buildTaskItems(detail(), HREFS);
    expect(items.map((i) => i.title)).toEqual(["No active care plan on file"]);
    expect(items[0].href).toBe(HREFS.carePlanHref);
    expect(items.some((i) => /medication regimen|vitals checkpoints/i.test(i.title))).toBe(false);
  });

  it("lists recorded assessment due dates with overdue first", () => {
    const now = new Date("2026-09-15T12:00:00");
    const items = buildTaskItems(
      detail({
        carePlanVersion: 2,
        carePlanAnnualDeltaDays: 200,
        assessmentsUpcomingJson: [
          { assessmentType: "fall_risk", nextDue: "2026-10-01", assessedAt: "2026-04-01" },
          { assessmentType: "annual_physical", nextDue: "2026-09-01", assessedAt: "2025-09-01" },
          { assessmentType: "no_date", nextDue: null, assessedAt: "2026-01-01" },
        ],
      }),
      HREFS,
      now,
    );
    expect(items.map((i) => [i.title, i.tone])).toEqual([
      ["Annual Physical", "danger"],
      ["Fall Risk", "warning"],
    ]);
  });
});

describe("record completeness names what is not recorded", () => {
  it("lists acuity, verification, allergy review, diagnoses, plan, unit and physician gaps", () => {
    const gaps = buildRecordGaps(detail(), HREFS, "No unit on file").map((g) => g.id);
    expect(gaps).toEqual(["acuity", "code-verify", "allergy", "dx", "plan", "unit", "pcp"]);
  });

  it("drops gaps once the record carries the value", () => {
    const gaps = buildRecordGaps(
      detail({
        acuityLevel: "level_2",
        codeStatusVerifiedAt: "2026-09-01T00:00:00Z",
        allergyReviewedAt: "2026-09-01T00:00:00Z",
        diagnosisRawList: ["COPD"],
        carePlanVersion: 1,
        unitName: "East",
        primaryPhysicianName: "Dr. Rivera",
      }),
      HREFS,
      "No unit on file",
    ).map((g) => g.id);
    expect(gaps).toEqual([]);
  });
});

describe("activity feed items", () => {
  it("includes general notes and orders everything newest first", () => {
    const items = buildFeedItems(
      detail({
        recentDailyNotes: [
          { id: "n1", logDate: "2026-09-10", shift: "day", snippet: "Ate well.", hasNote: true, loggedByLabel: "Ana" },
          { id: "n2", logDate: "2026-09-11", shift: "day", snippet: "No note posted", hasNote: false, loggedByLabel: "Ana" },
        ],
        recentBehavior: [
          {
            id: "b1",
            typeLabel: "Agitation / anxiety",
            behaviorText: "Restless after lunch",
            occurredLabel: "Sep 12, 2:00 PM",
            occurredAtIso: "2026-09-12T18:00:00Z",
            shift: "day",
            loggedByLabel: "Ana",
            injuryOccurred: false,
            notesSnippet: null,
          },
        ],
        recentAdl: [
          {
            id: "a1",
            logTimeLabel: "Sep 8, 8:00 AM",
            logTimeIso: "2026-09-08T12:00:00Z",
            logDate: "2026-09-08",
            shift: "day",
            summary: "Bathing · Total assist · refused",
            detailNote: null,
            loggedByLabel: "Ana",
          },
          {
            id: "a2",
            logTimeLabel: "Sep 9, 8:00 AM",
            logTimeIso: "2026-09-09T12:00:00Z",
            logDate: "2026-09-09",
            shift: "day",
            summary: "Bathing · Total assist",
            detailNote: null,
            loggedByLabel: "Ana",
          },
        ],
      }),
    );
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["behavior:b1", "note:n1", "adl:a1"]);
  });
});
