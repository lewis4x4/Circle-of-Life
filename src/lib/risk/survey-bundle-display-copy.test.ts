import { describe, expect, it } from "vitest";

import {
  STAFFING_TAB_NO_ADMINISTRATOR_COPY,
} from "@/lib/facilities/staffing-tab-display-copy";

import {
  SURVEY_BUNDLE_NO_ENTITY_COPY,
  SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY,
  SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY,
  formatSurveyBundleAdministratorName,
  formatSurveyBundleEntityName,
  formatSurveyBundlePocResponsibleParty,
  formatSurveyBundlePocSubmissionDueDate,
} from "./survey-bundle-display-copy";

const EM_DASH = "—";

describe("formatSurveyBundleEntityName", () => {
  it("names a missing entity instead of an em dash", () => {
    expect(formatSurveyBundleEntityName(null)).toBe(SURVEY_BUNDLE_NO_ENTITY_COPY);
    expect(formatSurveyBundleEntityName(undefined)).toBe(SURVEY_BUNDLE_NO_ENTITY_COPY);
    expect(formatSurveyBundleEntityName("")).toBe(SURVEY_BUNDLE_NO_ENTITY_COPY);
    expect(formatSurveyBundleEntityName("   ")).toBe(SURVEY_BUNDLE_NO_ENTITY_COPY);
    expect(formatSurveyBundleEntityName(null)).not.toBe(EM_DASH);
  });

  it("returns posted entity names trimmed", () => {
    expect(formatSurveyBundleEntityName("Oakridge ALF LLC")).toBe("Oakridge ALF LLC");
    expect(formatSurveyBundleEntityName("  Circle of Life Holdings  ")).toBe("Circle of Life Holdings");
  });
});

describe("formatSurveyBundleAdministratorName", () => {
  it("names a missing administrator instead of an em dash", () => {
    expect(formatSurveyBundleAdministratorName(null)).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundleAdministratorName(undefined)).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundleAdministratorName("")).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundleAdministratorName("   ")).toBe(STAFFING_TAB_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundleAdministratorName(null)).not.toBe(EM_DASH);
  });

  it("returns posted administrator names unchanged", () => {
    expect(formatSurveyBundleAdministratorName("Supervisor A")).toBe("Supervisor A");
  });
});

describe("formatSurveyBundlePocSubmissionDueDate", () => {
  it("names a missing POC due date instead of an em dash", () => {
    expect(formatSurveyBundlePocSubmissionDueDate(null)).toBe(SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY);
    expect(formatSurveyBundlePocSubmissionDueDate(undefined)).toBe(SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY);
    expect(formatSurveyBundlePocSubmissionDueDate("")).toBe(SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY);
    expect(formatSurveyBundlePocSubmissionDueDate("   ")).toBe(SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY);
    expect(formatSurveyBundlePocSubmissionDueDate(null)).not.toBe(EM_DASH);
  });

  it("returns posted due dates trimmed", () => {
    expect(formatSurveyBundlePocSubmissionDueDate("2026-04-15")).toBe("2026-04-15");
    expect(formatSurveyBundlePocSubmissionDueDate("  2026-04-15  ")).toBe("2026-04-15");
  });
});

describe("formatSurveyBundlePocResponsibleParty", () => {
  it("names a missing responsible party instead of an em dash", () => {
    expect(formatSurveyBundlePocResponsibleParty(null)).toBe(SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY);
    expect(formatSurveyBundlePocResponsibleParty(undefined)).toBe(SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY);
    expect(formatSurveyBundlePocResponsibleParty("")).toBe(SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY);
    expect(formatSurveyBundlePocResponsibleParty("   ")).toBe(SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY);
    expect(formatSurveyBundlePocResponsibleParty(null)).not.toBe(EM_DASH);
  });

  it("returns posted responsible parties trimmed", () => {
    expect(formatSurveyBundlePocResponsibleParty("Administrator")).toBe("Administrator");
    expect(formatSurveyBundlePocResponsibleParty("  DON  ")).toBe("DON");
  });
});
