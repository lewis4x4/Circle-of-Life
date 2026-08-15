/**
 * Quiet Operator copy for the facility detail licensing tab.
 * Missing license facts and survey rows name real gaps — never fabricate values.
 */

import { isValid, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const LICENSING_TAB_NO_DATE_POSTED_COPY = "No date posted";
export const LICENSING_TAB_NO_EXPIRATION_CAPTION_COPY = "No expiration caption posted";
export const LICENSING_TAB_NO_LAST_EDITED_COPY = "No last-edited date posted";
export const LICENSING_TAB_NO_LICENSE_NUMBER_COPY = "No license number posted";
export const LICENSING_TAB_NO_EXPIRATION_DATE_COPY = "No expiration date posted";
export const LICENSING_TAB_NO_CITATIONS_COPY = "No citations";
export const LICENSING_TAB_NO_SURVEY_DATE_POSTED_COPY = "No survey date posted";
export const LICENSING_TAB_NO_NEXT_DUE_DATE_COPY = "No next-due date posted";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YMD date on the licensing tab when unset, blank, or unparseable. */
export function formatLicensingTabYmdDate(
  dateYmd: string | null | undefined,
  timezone: string,
): string {
  if (!dateYmd || !YMD_RE.test(dateYmd)) return LICENSING_TAB_NO_DATE_POSTED_COPY;
  try {
    const d = parseISO(`${dateYmd}T12:00:00.000Z`);
    if (!isValid(d)) return LICENSING_TAB_NO_DATE_POSTED_COPY;
    return formatInTimeZone(d, timezone, "MMM d, yyyy");
  } catch {
    return dateYmd;
  }
}

/** License number when unset or blank. */
export function formatLicensingTabLicenseNumber(licenseNum: string | null | undefined): string {
  if (licenseNum == null || String(licenseNum).trim() === "") {
    return LICENSING_TAB_NO_LICENSE_NUMBER_COPY;
  }
  return String(licenseNum);
}

/** Expiration YMD when unset or blank. */
export function formatLicensingTabExpirationDate(expiryYmd: string | null | undefined): string {
  if (!expiryYmd || !YMD_RE.test(expiryYmd)) return LICENSING_TAB_NO_EXPIRATION_DATE_COPY;
  return expiryYmd;
}

/** Relative expiration caption when expiry facts are missing. */
export function formatLicensingTabExpirationCaption(
  expiryYmd: string | null | undefined,
  daysToExpiry: number | null,
): string {
  if (!expiryYmd || daysToExpiry === null) return LICENSING_TAB_NO_EXPIRATION_CAPTION_COPY;
  if (daysToExpiry < 0) {
    const daysPast = Math.abs(daysToExpiry);
    return `${daysPast} day${daysPast === 1 ? "" : "s"} past due`;
  }
  if (daysToExpiry === 0) return "Renews today";
  return `${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"} remaining`;
}

/** Last-edited timestamp for the care pathway footer. */
export function formatLicensingTabLastEditedLabel(
  updatedAt: string | null | undefined,
  timezone: string,
): string {
  if (!updatedAt) return LICENSING_TAB_NO_LAST_EDITED_COPY;
  try {
    const d = parseISO(String(updatedAt));
    if (!isValid(d)) return LICENSING_TAB_NO_LAST_EDITED_COPY;
    return `${formatInTimeZone(d, timezone, "MMM d, yyyy h:mm a")} (${timezone})`;
  } catch {
    return LICENSING_TAB_NO_LAST_EDITED_COPY;
  }
}

export type LicensingTabPlanOfCorrectionInput = {
  citation_count: number;
  poc_submitted_date: string | null;
  poc_accepted_date: string | null;
};

/** Plan-of-correction status; zero citations are named explicitly, not shown as a missing POC. */
export function formatLicensingTabPlanOfCorrectionStatus(row: LicensingTabPlanOfCorrectionInput): string {
  if (row.citation_count <= 0) return LICENSING_TAB_NO_CITATIONS_COPY;
  if (row.poc_accepted_date) return "POC accepted";
  if (row.poc_submitted_date) return "POC submitted";
  return "Outstanding";
}

/** Citation count label; real zero stays explicit instead of a silent dash. */
export function formatLicensingTabCitationCount(citationCount: number): string {
  if (citationCount <= 0) return LICENSING_TAB_NO_CITATIONS_COPY;
  return String(citationCount);
}

/** Whether the citations cell should link to compliance (count is a real positive integer). */
export function licensingTabCitationCountHasLink(citationCount: number): boolean {
  return citationCount > 0;
}

/** Survey history date when unset, blank, or unparseable. */
export function formatLicensingTabSurveyDateLabel(surveyDateYmd: string | null | undefined): string {
  if (!surveyDateYmd || !YMD_RE.test(surveyDateYmd)) return LICENSING_TAB_NO_SURVEY_DATE_POSTED_COPY;
  return surveyDateYmd;
}

/** Next annual survey target when approximate date cannot be derived. */
export function formatLicensingTabNextDueDate(nextDueIso: string | null | undefined): string {
  if (!nextDueIso || !YMD_RE.test(nextDueIso)) return LICENSING_TAB_NO_NEXT_DUE_DATE_COPY;
  return nextDueIso;
}
