import { describe, expect, it } from "vitest";

import {
  SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY,
  SURVEY_BUNDLE_PRINT_NO_DATE_COPY,
  SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY,
  SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY,
  SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY,
  SURVEY_BUNDLE_PRINT_NO_RISK_COPY,
  formatSurveyBundlePrintAdministratorName,
  formatSurveyBundlePrintEntityName,
  formatSurveyBundlePrintLicenseNumber,
  formatSurveyBundlePrintLicenseType,
  formatSurveyBundlePrintPocSubmissionDueDate,
  formatSurveyBundlePrintRiskScore,
} from "./survey-bundle-print-display-copy";

const EM_DASH = "—";

describe("formatSurveyBundlePrintPocSubmissionDueDate", () => {
  it("names a missing due date instead of an em dash", () => {
    expect(formatSurveyBundlePrintPocSubmissionDueDate(null)).toBe(SURVEY_BUNDLE_PRINT_NO_DATE_COPY);
    expect(formatSurveyBundlePrintPocSubmissionDueDate(undefined)).toBe(SURVEY_BUNDLE_PRINT_NO_DATE_COPY);
    expect(formatSurveyBundlePrintPocSubmissionDueDate("")).toBe(SURVEY_BUNDLE_PRINT_NO_DATE_COPY);
    expect(formatSurveyBundlePrintPocSubmissionDueDate("   ")).toBe(SURVEY_BUNDLE_PRINT_NO_DATE_COPY);
    expect(formatSurveyBundlePrintPocSubmissionDueDate(EM_DASH)).toBe(SURVEY_BUNDLE_PRINT_NO_DATE_COPY);
    expect(formatSurveyBundlePrintPocSubmissionDueDate(`  ${EM_DASH}  `)).toBe(SURVEY_BUNDLE_PRINT_NO_DATE_COPY);
    expect(formatSurveyBundlePrintPocSubmissionDueDate(null)).not.toBe(EM_DASH);
  });

  it("returns posted due dates trimmed", () => {
    expect(formatSurveyBundlePrintPocSubmissionDueDate("2026-04-15")).toBe("2026-04-15");
    expect(formatSurveyBundlePrintPocSubmissionDueDate("  2026-04-15  ")).toBe("2026-04-15");
  });
});

describe("formatSurveyBundlePrintEntityName", () => {
  it("names a missing entity instead of an em dash", () => {
    expect(formatSurveyBundlePrintEntityName(null)).toBe(SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY);
    expect(formatSurveyBundlePrintEntityName(undefined)).toBe(SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY);
    expect(formatSurveyBundlePrintEntityName("")).toBe(SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY);
    expect(formatSurveyBundlePrintEntityName("   ")).toBe(SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY);
    expect(formatSurveyBundlePrintEntityName(EM_DASH)).toBe(SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY);
    expect(formatSurveyBundlePrintEntityName(null)).not.toBe(EM_DASH);
  });

  it("returns posted entity names trimmed", () => {
    expect(formatSurveyBundlePrintEntityName("Oakridge Entity")).toBe("Oakridge Entity");
    expect(formatSurveyBundlePrintEntityName("  Oakridge Entity  ")).toBe("Oakridge Entity");
  });
});

describe("formatSurveyBundlePrintAdministratorName", () => {
  it("names a missing administrator instead of an em dash", () => {
    expect(formatSurveyBundlePrintAdministratorName(null)).toBe(SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundlePrintAdministratorName(undefined)).toBe(SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundlePrintAdministratorName("")).toBe(SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundlePrintAdministratorName("   ")).toBe(SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundlePrintAdministratorName(EM_DASH)).toBe(SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY);
    expect(formatSurveyBundlePrintAdministratorName(null)).not.toBe(EM_DASH);
  });

  it("returns posted administrator names trimmed", () => {
    expect(formatSurveyBundlePrintAdministratorName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatSurveyBundlePrintAdministratorName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});

describe("formatSurveyBundlePrintLicenseNumber", () => {
  it("names a missing license number instead of an em dash", () => {
    expect(formatSurveyBundlePrintLicenseNumber(null)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY);
    expect(formatSurveyBundlePrintLicenseNumber(undefined)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY);
    expect(formatSurveyBundlePrintLicenseNumber("")).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY);
    expect(formatSurveyBundlePrintLicenseNumber("   ")).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY);
    expect(formatSurveyBundlePrintLicenseNumber(EM_DASH)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY);
    expect(formatSurveyBundlePrintLicenseNumber(`  ${EM_DASH}  `)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY);
    expect(formatSurveyBundlePrintLicenseNumber(null)).not.toBe(EM_DASH);
  });

  it("returns posted license numbers trimmed", () => {
    expect(formatSurveyBundlePrintLicenseNumber("ALF-001")).toBe("ALF-001");
    expect(formatSurveyBundlePrintLicenseNumber("  ALF-001  ")).toBe("ALF-001");
  });
});

describe("formatSurveyBundlePrintLicenseType", () => {
  it("names a missing license type instead of unspecified", () => {
    expect(formatSurveyBundlePrintLicenseType(null, null)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType(undefined, undefined)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType("", "")).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType("   ", "   ")).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType(EM_DASH, EM_DASH)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType(null, EM_DASH)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType(EM_DASH, null)).toBe(SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY);
    expect(formatSurveyBundlePrintLicenseType(null, null)).not.toBe("unspecified");
  });

  it("prefers alfLicenseType over licenseType", () => {
    expect(formatSurveyBundlePrintLicenseType("standard", "limited")).toBe("standard");
    expect(formatSurveyBundlePrintLicenseType("  standard  ", "limited")).toBe("standard");
    expect(formatSurveyBundlePrintLicenseType("", "limited")).toBe("limited");
    expect(formatSurveyBundlePrintLicenseType(EM_DASH, "limited")).toBe("limited");
  });

  it("falls back to licenseType when alfLicenseType is missing", () => {
    expect(formatSurveyBundlePrintLicenseType(null, "limited")).toBe("limited");
    expect(formatSurveyBundlePrintLicenseType(null, "  limited  ")).toBe("limited");
  });
});

describe("formatSurveyBundlePrintRiskScore", () => {
  it("names a missing risk snapshot instead of an em dash", () => {
    expect(formatSurveyBundlePrintRiskScore(null)).toBe(SURVEY_BUNDLE_PRINT_NO_RISK_COPY);
    expect(formatSurveyBundlePrintRiskScore(undefined)).toBe(SURVEY_BUNDLE_PRINT_NO_RISK_COPY);
    expect(formatSurveyBundlePrintRiskScore(null)).not.toBe(EM_DASH);
  });

  it("names a snapshot with a non-finite score as missing", () => {
    expect(formatSurveyBundlePrintRiskScore({ riskScore: Number.NaN })).toBe(SURVEY_BUNDLE_PRINT_NO_RISK_COPY);
  });

  it("keeps real zero as 0/100", () => {
    expect(formatSurveyBundlePrintRiskScore({ riskScore: 0 })).toBe("0/100");
  });

  it("formats posted scores with /100 suffix", () => {
    expect(formatSurveyBundlePrintRiskScore({ riskScore: 72 })).toBe("72/100");
    expect(formatSurveyBundlePrintRiskScore({ riskScore: 100 })).toBe("100/100");
  });
});
