import { describe, expect, it } from "vitest";

import { ADMISSIONS_HUB_MISSING_DATE_COPY } from "./admissions-hub-display-copy";
import { BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY } from "@/lib/facilities/building-tab-display-copy";
import {
  ADMISSIONS_NEW_NO_ADMISSION_SOURCE_COPY,
  ADMISSIONS_NEW_NO_FACILITY_COPY,
  ADMISSIONS_NEW_NO_GENDER_COPY,
  ADMISSIONS_NEW_NO_INQUIRY_DATE_COPY,
  ADMISSIONS_NEW_NO_INTAKE_SUBJECT_COPY,
  ADMISSIONS_NEW_NO_LAST_CONTACT_DATE_COPY,
  ADMISSIONS_NEW_NO_LEAD_CONTACT_COPY,
  ADMISSIONS_NEW_NO_LEAD_MATCH_COPY,
  ADMISSIONS_NEW_NO_LEAD_STAGE_COPY,
  ADMISSIONS_NEW_NO_MONTHLY_RATE_COPY,
  ADMISSIONS_NEW_NO_RESIDENT_MATCH_COPY,
  ADMISSIONS_NEW_NO_ROOM_NUMBER_COPY,
  formatAdmissionsNewAdmissionSource,
  formatAdmissionsNewBedMonthlyRate,
  formatAdmissionsNewDirectDob,
  formatAdmissionsNewDirectGender,
  formatAdmissionsNewFacilityName,
  formatAdmissionsNewInquiryDate,
  formatAdmissionsNewIntakeSummarySubject,
  formatAdmissionsNewLastContactDate,
  formatAdmissionsNewLeadContact,
  formatAdmissionsNewLeadStage,
  formatAdmissionsNewPostedDate,
  formatAdmissionsNewRoomNumber,
  formatAdmissionsNewTargetMoveIn,
  formatBuildingTabLicensedBedCount,
  formatReferralsHubReferralSource,
} from "./admissions-new-display-copy";

const EM_DASH = "—";

describe("formatAdmissionsNewPostedDate", () => {
  it("names a missing posted date instead of an em dash", () => {
    expect(formatAdmissionsNewPostedDate(null)).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
    expect(formatAdmissionsNewPostedDate(null)).not.toBe(EM_DASH);
  });

  it("returns a formatted date when present", () => {
    expect(formatAdmissionsNewPostedDate("Aug 1, 2026")).toBe("Aug 1, 2026");
  });
});

describe("formatAdmissionsNewInquiryDate", () => {
  it("names a missing inquiry date on the lead panel", () => {
    expect(formatAdmissionsNewInquiryDate(null)).toBe(ADMISSIONS_NEW_NO_INQUIRY_DATE_COPY);
  });
});

describe("formatReferralsHubReferralSource", () => {
  it("names a missing referral source", () => {
    expect(formatReferralsHubReferralSource(null)).toBe("No source posted");
    expect(formatReferralsHubReferralSource(null)).not.toBe(EM_DASH);
  });
});

describe("formatAdmissionsNewFacilityName", () => {
  it("names a missing facility", () => {
    expect(formatAdmissionsNewFacilityName(null)).toBe(ADMISSIONS_NEW_NO_FACILITY_COPY);
    expect(formatAdmissionsNewFacilityName("  ")).toBe(ADMISSIONS_NEW_NO_FACILITY_COPY);
  });
});

describe("formatBuildingTabLicensedBedCount", () => {
  it("names a missing licensed-bed count and keeps real zero", () => {
    expect(formatBuildingTabLicensedBedCount(null)).toBe(BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY);
    expect(formatBuildingTabLicensedBedCount(0)).toBe("0");
    expect(formatBuildingTabLicensedBedCount(0)).not.toBe(BUILDING_TAB_NO_LICENSED_BED_COUNT_COPY);
  });
});

describe("formatAdmissionsNewLeadStage", () => {
  it("names an empty CRM stage", () => {
    expect(formatAdmissionsNewLeadStage("")).toBe(ADMISSIONS_NEW_NO_LEAD_STAGE_COPY);
    expect(formatAdmissionsNewLeadStage("   ")).toBe(ADMISSIONS_NEW_NO_LEAD_STAGE_COPY);
  });

  it("title-cases a posted stage token", () => {
    expect(formatAdmissionsNewLeadStage("needs_follow_up")).toBe("Needs Follow Up");
  });
});

describe("formatAdmissionsNewLeadContact", () => {
  it("names a missing lead contact", () => {
    expect(formatAdmissionsNewLeadContact("")).toBe(ADMISSIONS_NEW_NO_LEAD_CONTACT_COPY);
  });
});

describe("formatAdmissionsNewLastContactDate", () => {
  it("names a missing last-contact date", () => {
    expect(formatAdmissionsNewLastContactDate(null, null)).toBe(ADMISSIONS_NEW_NO_LAST_CONTACT_DATE_COPY);
  });

  it("falls back to a raw iso date fragment when formatting failed", () => {
    expect(formatAdmissionsNewLastContactDate(null, "2026-08-01")).toBe("2026-08-01");
  });
});

describe("formatAdmissionsNewBedMonthlyRate", () => {
  it("names a missing monthly rate", () => {
    expect(formatAdmissionsNewBedMonthlyRate(null)).toBe(`${ADMISSIONS_NEW_NO_MONTHLY_RATE_COPY}/mo`);
  });
});

describe("formatAdmissionsNewRoomNumber", () => {
  it("names a missing room number", () => {
    expect(formatAdmissionsNewRoomNumber(null)).toBe(ADMISSIONS_NEW_NO_ROOM_NUMBER_COPY);
  });
});

describe("formatAdmissionsNewIntakeSummarySubject", () => {
  it("names gaps for unmatched selections and empty paths", () => {
    expect(
      formatAdmissionsNewIntakeSummarySubject("inquiry", {
        residentId: "r1",
        residentLabel: null,
        leadId: "",
        leadLabel: null,
        directName: "",
      }),
    ).toBe(ADMISSIONS_NEW_NO_RESIDENT_MATCH_COPY);

    expect(
      formatAdmissionsNewIntakeSummarySubject("lead", {
        residentId: "",
        residentLabel: null,
        leadId: "l1",
        leadLabel: null,
        directName: "",
      }),
    ).toBe(ADMISSIONS_NEW_NO_LEAD_MATCH_COPY);

    expect(
      formatAdmissionsNewIntakeSummarySubject("inquiry", {
        residentId: "",
        residentLabel: null,
        leadId: "",
        leadLabel: null,
        directName: "",
      }),
    ).toBe(ADMISSIONS_NEW_NO_INTAKE_SUBJECT_COPY);
  });

  it("uses Direct admit when direct path has no name yet", () => {
    expect(
      formatAdmissionsNewIntakeSummarySubject("direct", {
        residentId: "",
        residentLabel: null,
        leadId: "",
        leadLabel: null,
        directName: "",
      }),
    ).toBe("Direct admit");
  });
});

describe("formatAdmissionsNewTargetMoveIn", () => {
  it("names a missing target move-in date", () => {
    expect(formatAdmissionsNewTargetMoveIn("")).toBe("No target move-in date");
    expect(formatAdmissionsNewTargetMoveIn("")).not.toBe(EM_DASH);
  });
});

describe("formatAdmissionsNewDirectDob", () => {
  it("names a missing date of birth in the confirm dialog", () => {
    expect(formatAdmissionsNewDirectDob("")).toBe("No date of birth posted");
  });
});

describe("formatAdmissionsNewDirectGender", () => {
  it("names a missing gender in the confirm dialog", () => {
    expect(formatAdmissionsNewDirectGender(null)).toBe(ADMISSIONS_NEW_NO_GENDER_COPY);
  });
});

describe("formatAdmissionsNewAdmissionSource", () => {
  it("names a missing admission source in the confirm dialog", () => {
    expect(formatAdmissionsNewAdmissionSource(null)).toBe(ADMISSIONS_NEW_NO_ADMISSION_SOURCE_COPY);
  });
});
