/**
 * Quiet Operator copy for the risk survey bundle page (`/admin/risk/survey-bundle`).
 * Missing facility and POC fields name real gaps — never fabricate values.
 */

import { formatStaffingTabAdministratorName } from "@/lib/facilities/staffing-tab-display-copy";

export const SURVEY_BUNDLE_NO_ENTITY_COPY = "No entity posted";
export const SURVEY_BUNDLE_NO_LICENSE_COPY = "No license posted";
export const SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY = "No POC due date posted";
export const SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY = "No responsible party posted";

/** Legal entity on the facility record when unset or blank. */
export function formatSurveyBundleEntityName(entityName: string | null | undefined): string {
  if (!entityName || !entityName.trim()) return SURVEY_BUNDLE_NO_ENTITY_COPY;
  return entityName.trim();
}

/** Facility license on the packet record when unset or blank. */
export function formatSurveyBundleLicenseValue(
  licenseNumber: string | null | undefined,
  alfLicenseType: string | null | undefined,
  licenseType: string | null | undefined,
): string {
  const trimmedNumber = licenseNumber?.trim();
  if (!trimmedNumber) return SURVEY_BUNDLE_NO_LICENSE_COPY;
  const typeLabel = (alfLicenseType ?? licenseType ?? "").trim();
  return typeLabel ? `${trimmedNumber} · ${typeLabel}` : trimmedNumber;
}

/** Administrator of record — reuses staffing-tab copy when unset or blank. */
export function formatSurveyBundleAdministratorName(
  administratorName: string | null | undefined,
): string {
  return formatStaffingTabAdministratorName(administratorName);
}

/** POC submission due date on a deficiency row when unset or blank. */
export function formatSurveyBundlePocSubmissionDueDate(
  dueDate: string | null | undefined,
): string {
  if (!dueDate || !dueDate.trim()) return SURVEY_BUNDLE_NO_POC_DUE_DATE_COPY;
  return dueDate.trim();
}

/** POC responsible party on a deficiency row when unset or blank. */
export function formatSurveyBundlePocResponsibleParty(
  responsibleParty: string | null | undefined,
): string {
  if (!responsibleParty || !responsibleParty.trim()) return SURVEY_BUNDLE_NO_RESPONSIBLE_PARTY_COPY;
  return responsibleParty.trim();
}
