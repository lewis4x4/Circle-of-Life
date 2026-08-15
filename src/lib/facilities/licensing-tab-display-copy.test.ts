import { describe, expect, it } from "vitest";

import {
  LICENSING_TAB_NO_CITATIONS_COPY,
  LICENSING_TAB_NO_DATE_POSTED_COPY,
  LICENSING_TAB_NO_EXPIRATION_CAPTION_COPY,
  LICENSING_TAB_NO_EXPIRATION_DATE_COPY,
  LICENSING_TAB_NO_LAST_EDITED_COPY,
  LICENSING_TAB_NO_LICENSE_NUMBER_COPY,
  LICENSING_TAB_NO_NEXT_DUE_DATE_COPY,
  LICENSING_TAB_NO_SURVEY_LINK_COPY,
  formatLicensingTabCitationCount,
  formatLicensingTabExpirationCaption,
  formatLicensingTabExpirationDate,
  formatLicensingTabLastEditedLabel,
  formatLicensingTabLicenseNumber,
  formatLicensingTabNextDueDate,
  formatLicensingTabPlanOfCorrectionStatus,
  formatLicensingTabSurveyLink,
  formatLicensingTabYmdDate,
  licensingTabCitationCountHasLink,
} from "./licensing-tab-display-copy";

const EM_DASH = "—";
const TZ = "America/New_York";
const FIXTURE_LICENSE = "AL1234";
const FIXTURE_DATE = "2026-04-08";

describe("formatLicensingTabYmdDate", () => {
  it("names a missing YMD date instead of an em dash", () => {
    expect(formatLicensingTabYmdDate(null, TZ)).toBe(LICENSING_TAB_NO_DATE_POSTED_COPY);
    expect(formatLicensingTabYmdDate(undefined, TZ)).toBe(LICENSING_TAB_NO_DATE_POSTED_COPY);
    expect(formatLicensingTabYmdDate("", TZ)).toBe(LICENSING_TAB_NO_DATE_POSTED_COPY);
    expect(formatLicensingTabYmdDate("not-a-date", TZ)).toBe(LICENSING_TAB_NO_DATE_POSTED_COPY);
    expect(formatLicensingTabYmdDate(null, TZ)).not.toBe(EM_DASH);
  });

  it("formats a posted YMD in the facility timezone", () => {
    const formatted = formatLicensingTabYmdDate(FIXTURE_DATE, TZ);
    expect(formatted).toMatch(/Apr/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).not.toBe(LICENSING_TAB_NO_DATE_POSTED_COPY);
  });
});

describe("formatLicensingTabLicenseNumber", () => {
  it("names a missing license number instead of an em dash", () => {
    expect(formatLicensingTabLicenseNumber(null)).toBe(LICENSING_TAB_NO_LICENSE_NUMBER_COPY);
    expect(formatLicensingTabLicenseNumber(undefined)).toBe(LICENSING_TAB_NO_LICENSE_NUMBER_COPY);
    expect(formatLicensingTabLicenseNumber("")).toBe(LICENSING_TAB_NO_LICENSE_NUMBER_COPY);
    expect(formatLicensingTabLicenseNumber("   ")).toBe(LICENSING_TAB_NO_LICENSE_NUMBER_COPY);
    expect(formatLicensingTabLicenseNumber(null)).not.toBe(EM_DASH);
  });

  it("returns a posted license number", () => {
    expect(formatLicensingTabLicenseNumber(FIXTURE_LICENSE)).toBe(FIXTURE_LICENSE);
  });
});

describe("formatLicensingTabExpirationDate", () => {
  it("names a missing expiration date instead of an em dash", () => {
    expect(formatLicensingTabExpirationDate(null)).toBe(LICENSING_TAB_NO_EXPIRATION_DATE_COPY);
    expect(formatLicensingTabExpirationDate(undefined)).toBe(LICENSING_TAB_NO_EXPIRATION_DATE_COPY);
    expect(formatLicensingTabExpirationDate("")).toBe(LICENSING_TAB_NO_EXPIRATION_DATE_COPY);
    expect(formatLicensingTabExpirationDate(null)).not.toBe(EM_DASH);
  });

  it("returns a posted expiration YMD", () => {
    expect(formatLicensingTabExpirationDate(FIXTURE_DATE)).toBe(FIXTURE_DATE);
  });
});

describe("formatLicensingTabExpirationCaption", () => {
  it("names a missing expiration caption instead of an em dash", () => {
    expect(formatLicensingTabExpirationCaption(null, null)).toBe(LICENSING_TAB_NO_EXPIRATION_CAPTION_COPY);
    expect(formatLicensingTabExpirationCaption(FIXTURE_DATE, null)).toBe(
      LICENSING_TAB_NO_EXPIRATION_CAPTION_COPY,
    );
    expect(formatLicensingTabExpirationCaption(null, 10)).toBe(LICENSING_TAB_NO_EXPIRATION_CAPTION_COPY);
    expect(formatLicensingTabExpirationCaption(null, null)).not.toBe(EM_DASH);
  });

  it("returns relative captions when expiry facts are posted", () => {
    expect(formatLicensingTabExpirationCaption(FIXTURE_DATE, 0)).toBe("Renews today");
    expect(formatLicensingTabExpirationCaption(FIXTURE_DATE, 3)).toBe("3 days remaining");
    expect(formatLicensingTabExpirationCaption(FIXTURE_DATE, -1)).toBe("1 day past due");
  });
});

describe("formatLicensingTabLastEditedLabel", () => {
  it("names a missing last-edited timestamp instead of an em dash", () => {
    expect(formatLicensingTabLastEditedLabel(null, TZ)).toBe(LICENSING_TAB_NO_LAST_EDITED_COPY);
    expect(formatLicensingTabLastEditedLabel(undefined, TZ)).toBe(LICENSING_TAB_NO_LAST_EDITED_COPY);
    expect(formatLicensingTabLastEditedLabel("not-a-date", TZ)).toBe(LICENSING_TAB_NO_LAST_EDITED_COPY);
    expect(formatLicensingTabLastEditedLabel(null, TZ)).not.toBe(EM_DASH);
  });

  it("formats a posted last-edited timestamp in the facility timezone", () => {
    const formatted = formatLicensingTabLastEditedLabel("2026-04-08T16:30:00.000Z", TZ);
    expect(formatted).toMatch(/Apr/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/America\/New_York/);
    expect(formatted).not.toBe(LICENSING_TAB_NO_LAST_EDITED_COPY);
  });
});

describe("formatLicensingTabPlanOfCorrectionStatus", () => {
  it("names zero citations instead of an em dash", () => {
    expect(
      formatLicensingTabPlanOfCorrectionStatus({
        citation_count: 0,
        poc_submitted_date: null,
        poc_accepted_date: null,
      }),
    ).toBe(LICENSING_TAB_NO_CITATIONS_COPY);
    expect(
      formatLicensingTabPlanOfCorrectionStatus({
        citation_count: -1,
        poc_submitted_date: null,
        poc_accepted_date: null,
      }),
    ).toBe(LICENSING_TAB_NO_CITATIONS_COPY);
  });

  it("returns POC workflow labels when citations are posted", () => {
    expect(
      formatLicensingTabPlanOfCorrectionStatus({
        citation_count: 2,
        poc_submitted_date: null,
        poc_accepted_date: null,
      }),
    ).toBe("Outstanding");
    expect(
      formatLicensingTabPlanOfCorrectionStatus({
        citation_count: 2,
        poc_submitted_date: FIXTURE_DATE,
        poc_accepted_date: null,
      }),
    ).toBe("POC submitted");
    expect(
      formatLicensingTabPlanOfCorrectionStatus({
        citation_count: 2,
        poc_submitted_date: FIXTURE_DATE,
        poc_accepted_date: FIXTURE_DATE,
      }),
    ).toBe("POC accepted");
  });
});

describe("formatLicensingTabCitationCount", () => {
  it("names zero citations instead of an em dash", () => {
    expect(formatLicensingTabCitationCount(0)).toBe(LICENSING_TAB_NO_CITATIONS_COPY);
    expect(formatLicensingTabCitationCount(-1)).toBe(LICENSING_TAB_NO_CITATIONS_COPY);
    expect(formatLicensingTabCitationCount(0)).not.toBe(EM_DASH);
  });

  it("keeps real positive citation counts numeric", () => {
    expect(formatLicensingTabCitationCount(3)).toBe("3");
    expect(licensingTabCitationCountHasLink(3)).toBe(true);
    expect(licensingTabCitationCountHasLink(0)).toBe(false);
  });
});

describe("formatLicensingTabSurveyLink", () => {
  it("names a missing survey document link instead of an em dash", () => {
    expect(formatLicensingTabSurveyLink(null)).toBe(LICENSING_TAB_NO_SURVEY_LINK_COPY);
    expect(formatLicensingTabSurveyLink(undefined)).toBe(LICENSING_TAB_NO_SURVEY_LINK_COPY);
    expect(formatLicensingTabSurveyLink("")).toBe(LICENSING_TAB_NO_SURVEY_LINK_COPY);
    expect(formatLicensingTabSurveyLink("   ")).toBe(LICENSING_TAB_NO_SURVEY_LINK_COPY);
    expect(formatLicensingTabSurveyLink(null)).not.toBe(EM_DASH);
  });

  it("returns a posted survey document id", () => {
    expect(formatLicensingTabSurveyLink("doc-uuid-fixture")).toBe("doc-uuid-fixture");
  });
});

describe("formatLicensingTabNextDueDate", () => {
  it("names a missing next-due date instead of an em dash", () => {
    expect(formatLicensingTabNextDueDate(null)).toBe(LICENSING_TAB_NO_NEXT_DUE_DATE_COPY);
    expect(formatLicensingTabNextDueDate(undefined)).toBe(LICENSING_TAB_NO_NEXT_DUE_DATE_COPY);
    expect(formatLicensingTabNextDueDate("")).toBe(LICENSING_TAB_NO_NEXT_DUE_DATE_COPY);
    expect(formatLicensingTabNextDueDate(null)).not.toBe(EM_DASH);
  });

  it("returns a posted next-due YMD", () => {
    expect(formatLicensingTabNextDueDate(FIXTURE_DATE)).toBe(FIXTURE_DATE);
  });
});
