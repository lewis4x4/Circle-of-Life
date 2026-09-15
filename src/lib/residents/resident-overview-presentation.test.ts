import { describe, expect, it } from "vitest";

import { groupDiagnosesByCategory } from "./clinical-text-format";
import type { ResidentOverviewDetail } from "./resident-detail-overview-load";
import {
  RESIDENT_OVERVIEW_ALLERGIES_NOT_REVIEWED,
  RESIDENT_OVERVIEW_NKDA,
  RESIDENT_OVERVIEW_NO_DUE_WORK,
  RESIDENT_OVERVIEW_VERIFICATION_PENDING,
} from "./resident-overview-display-copy";
import {
  buildOverviewAttentionItems,
  buildOverviewCompletenessItems,
  formatCodeStatusHeadline,
  formatOverviewAgeDobLine,
  formatOverviewIdentitySubtitle,
  formatResidentOverviewActivityEmptyCopy,
  isTimestampInActivityWindow,
  overviewAllergyPresentation,
  recordedDiagnosisPhrases,
  residentOverviewActivityWindow,
} from "./resident-overview-presentation";

const HREFS = {
  carePlanHref: "/admin/residents/r1/care-plan",
  assessmentsHref: "/admin/residents/r1/assessments",
  profileHref: "/admin/v2/residents/r1",
};

function detail(overrides: Partial<ResidentOverviewDetail> = {}): ResidentOverviewDetail {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    fullName: "Marsha Wheeler",
    initials: "MW",
    preferredName: null,
    photoUrl: null,
    acuity: 1,
    status: "active",
    rawStatus: "active",
    fallRiskRaw: null,
    roomLabel: "1-A",
    unitName: "No unit linked",
    admissionLabel: "Dec 26, 2025",
    dobLabel: "December 26, 1946",
    ageYears: 79,
    gender: "female",
    diagnosisRawList: [],
    allergiesTokens: [],
    dietOrder: null,
    codeStatusRaw: "full_code",
    primaryPayer: null,
    hospiceStatus: "none",
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
    ...overrides,
  };
}

describe("formatCodeStatusHeadline", () => {
  it("keeps the stored value and verification pending at equal prominence", () => {
    const result = formatCodeStatusHeadline("full_code", null, null);
    expect(result.headline).toBe(`Full code · ${RESIDENT_OVERVIEW_VERIFICATION_PENDING}`);
    expect(result.valueLabel).toBe("Full code");
    expect(result.verificationKind).toBe("pending");
  });

  it("includes verification date and attributed staff when posted", () => {
    const result = formatCodeStatusHeadline(
      "full_code",
      "2026-01-15T15:00:00.000Z",
      "Jordan Lee",
    );
    expect(result.headline).toMatch(/^Full code · Verified /);
    expect(result.headline).toContain("Jordan Lee");
    expect(result.verificationKind).toBe("verified");
  });

  it("does not invent a verifier when only a date is posted", () => {
    const result = formatCodeStatusHeadline("dnr", "2026-01-15T15:00:00.000Z", null);
    expect(result.headline).toMatch(/^DNR — Do not resuscitate · Verified /);
    expect(result.headline).not.toContain("by");
    expect(result.headline).not.toContain("profile editor");
  });
});

describe("recordedDiagnosisPhrases", () => {
  const sourcePhrases = [
    "OSTEOPENIA; GERD; COLON POLYPS; DEPRESSION BASAL CELL CARCINOMA; MEMORY LOSS",
    "Osteopenia",
    "Depression",
    "GERD",
  ];

  it("keeps recorded phrases without splitting, grouping, or extra deduplication", () => {
    const phrases = recordedDiagnosisPhrases(sourcePhrases);
    expect(phrases).toHaveLength(4);
    expect(phrases[0]).toContain("Osteopenia");
    expect(phrases).toEqual(expect.arrayContaining(["Osteopenia", "Depression", "GERD"]));
  });

  it("documents that heuristic grouping would conceal the source overlap", () => {
    const grouped = groupDiagnosesByCategory(sourcePhrases);
    const groupedCount = Object.values(grouped).reduce((sum, list) => sum + (list?.length ?? 0), 0);
    expect(groupedCount).toBeGreaterThan(1);
    expect(recordedDiagnosisPhrases(sourcePhrases)).toHaveLength(sourcePhrases.length);
  });
});

describe("resident overview activity window", () => {
  const now = new Date("2026-09-15T20:05:00-04:00");

  it("names a seven-day Eastern window and uses factual empty copy", () => {
    const window = residentOverviewActivityWindow(now);
    expect(window.label).toBe("Sep 9 – Sep 15, 2026");
    expect(formatResidentOverviewActivityEmptyCopy(window)).toBe(
      "No activity recorded for Sep 9 – Sep 15, 2026.",
    );
    expect(formatResidentOverviewActivityEmptyCopy(window)).not.toMatch(/quiet shift/i);
  });

  it("includes timestamps inside the window and excludes older ones", () => {
    const window = residentOverviewActivityWindow(now);
    expect(isTimestampInActivityWindow("2026-09-12T14:00:00.000Z", window)).toBe(true);
    expect(isTimestampInActivityWindow("2026-09-01T14:00:00.000Z", window)).toBe(false);
    expect(isTimestampInActivityWindow("2026-09-15", window)).toBe(true);
    expect(isTimestampInActivityWindow(null, window)).toBe(true);
  });
});

describe("overviewAllergyPresentation", () => {
  it("keeps unreviewed empty allergies distinct from confirmed NKDA", () => {
    expect(overviewAllergyPresentation(detail()).state).toBe("unreviewed");
    expect(overviewAllergyPresentation(detail()).value).toBe(RESIDENT_OVERVIEW_ALLERGIES_NOT_REVIEWED);
    expect(
      overviewAllergyPresentation(detail({ allergyReviewedAt: "2026-08-01T12:00:00.000Z" })).value,
    ).toBe(RESIDENT_OVERVIEW_NKDA);
  });
});

describe("buildOverviewAttentionItems", () => {
  it("omits placeholder eMAR and vitals protocol tasks", () => {
    const items = buildOverviewAttentionItems(detail(), HREFS);
    expect(items.map((item) => item.title).join(" ")).not.toMatch(/eMAR|Vitals checkpoints/i);
    expect(items.some((item) => item.id === "allergy-review")).toBe(true);
    expect(items.find((item) => item.id === "code-verify")?.detail).toBe(
      RESIDENT_OVERVIEW_VERIFICATION_PENDING,
    );
  });

  it("includes only due care-plan work, not a healthy distant review", () => {
    const distant = buildOverviewAttentionItems(detail({ carePlanAnnualDeltaDays: 80 }), HREFS);
    expect(distant.some((item) => item.title === "Annual care plan review")).toBe(false);
    const due = buildOverviewAttentionItems(detail({ carePlanAnnualDeltaDays: 8 }), HREFS);
    expect(due.find((item) => item.id === "cp-soon")?.detail).toBe("Due in 8 days");
  });

  it("returns the factual empty copy when nothing is due", () => {
    const items = buildOverviewAttentionItems(
      detail({
        codeStatusRaw: null,
        allergyReviewedAt: "2026-08-01T12:00:00.000Z",
      }),
      HREFS,
    );
    expect(items).toEqual([]);
    expect(RESIDENT_OVERVIEW_NO_DUE_WORK).toBe("No due work recorded.");
  });
});

describe("buildOverviewCompletenessItems", () => {
  it("lists record gaps separately from care attention", () => {
    const items = buildOverviewCompletenessItems(detail(), HREFS.profileHref);
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["dnh-missing", "polst-missing", "dx-unreviewed", "unit-missing"]),
    );
    expect(items.some((item) => item.label === "Code status not on file")).toBe(false);
  });
});

describe("identity copy", () => {
  it("keeps room in the identity line and shows DOB without hover language", () => {
    expect(formatOverviewIdentitySubtitle(detail())).toBe("Room 1-A · Admitted Dec 26, 2025");
    expect(formatOverviewIdentitySubtitle(detail({ unitName: "Memory care" }))).toBe(
      "Room 1-A · Memory care · Admitted Dec 26, 2025",
    );
    expect(formatOverviewAgeDobLine(detail(), "Female")).toBe(
      "Age 79 · Born December 26, 1946 · Female",
    );
    expect(formatOverviewAgeDobLine(detail(), "Female")).not.toMatch(/hover/i);
  });
});
