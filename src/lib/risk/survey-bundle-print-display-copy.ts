/**
 * Quiet Operator copy for the AHCA survey bundle print packet.
 * Missing facility, POC, and risk fields name real gaps — never fabricate values.
 */

const EM_DASH = "—";

export const SURVEY_BUNDLE_PRINT_NO_DATE_COPY = "No date posted";
export const SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY = "No entity posted";
export const SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY = "No administrator posted";
export const SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY = "No license posted";
export const SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY = "No license type posted";
export const SURVEY_BUNDLE_PRINT_NO_RISK_COPY = "No risk posted";
export const SURVEY_BUNDLE_PRINT_NO_POC_COPY = "No POC posted";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === EM_DASH;
}

/** POC status on a deficiency row when unset, blank, or em dash. */
export function formatSurveyBundlePrintPocStatus(
  pocStatus: string | null | undefined,
): string {
  if (isBlankOrEmDash(pocStatus)) return SURVEY_BUNDLE_PRINT_NO_POC_COPY;
  return pocStatus!.trim();
}

/** POC submission due date on a deficiency row when unset, blank, or em dash. */
export function formatSurveyBundlePrintPocSubmissionDueDate(
  dueDate: string | null | undefined,
): string {
  if (isBlankOrEmDash(dueDate)) return SURVEY_BUNDLE_PRINT_NO_DATE_COPY;
  return dueDate!.trim();
}

/** Legal entity on the print packet when unset, blank, or em dash. */
export function formatSurveyBundlePrintEntityName(entityName: string | null | undefined): string {
  if (isBlankOrEmDash(entityName)) return SURVEY_BUNDLE_PRINT_NO_ENTITY_COPY;
  return entityName!.trim();
}

/** Administrator of record on the print packet when unset, blank, or em dash. */
export function formatSurveyBundlePrintAdministratorName(
  administratorName: string | null | undefined,
): string {
  if (isBlankOrEmDash(administratorName)) return SURVEY_BUNDLE_PRINT_NO_ADMINISTRATOR_COPY;
  return administratorName!.trim();
}

/** Facility license number on the print packet when unset, blank, or em dash. */
export function formatSurveyBundlePrintLicenseNumber(
  licenseNumber: string | null | undefined,
): string {
  if (isBlankOrEmDash(licenseNumber)) return SURVEY_BUNDLE_PRINT_NO_LICENSE_COPY;
  return licenseNumber!.trim();
}

/** Facility license type on the print packet — prefers alfLicenseType, then licenseType. */
export function formatSurveyBundlePrintLicenseType(
  alfLicenseType: string | null | undefined,
  licenseType: string | null | undefined,
): string {
  if (!isBlankOrEmDash(alfLicenseType)) return alfLicenseType!.trim();
  if (!isBlankOrEmDash(licenseType)) return licenseType!.trim();
  return SURVEY_BUNDLE_PRINT_NO_LICENSE_TYPE_COPY;
}

function isFiniteRiskScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Risk score metric on the print packet — real zero stays `0/100`; missing snapshot names the gap. */
export function formatSurveyBundlePrintRiskScore(
  riskSnapshot: { riskScore: number } | null | undefined,
): string {
  if (!riskSnapshot || !isFiniteRiskScore(riskSnapshot.riskScore)) {
    return SURVEY_BUNDLE_PRINT_NO_RISK_COPY;
  }
  return `${riskSnapshot.riskScore}/100`;
}
