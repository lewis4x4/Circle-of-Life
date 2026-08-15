/**
 * Quiet Operator copy for operations template authoring (`/admin/operations/templates`).
 * Missing numeric and text fields name real gaps — never silent em dashes or fabricated values.
 */

export const OPERATIONS_TEMPLATES_NO_ESTIMATE_COPY = "No estimate posted";
export const OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY = "No compliance posted";
export const OPERATIONS_TEMPLATES_NO_ASSET_COPY = "No asset posted";
export const OPERATIONS_TEMPLATES_NO_VENDOR_COPY = "No vendor posted";
export const OPERATIONS_TEMPLATES_NO_AUTO_COMPLETE_COPY = "No auto-complete posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

function formatPostedNumber(
  value: number | null | undefined,
  unit: string,
  missingCopy: string,
): string {
  if (value == null) return missingCopy;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return missingCopy;
  return `${n}${unit}`;
}

/** Estimated minutes on a template card — real zero stays `0 min`; null names the gap. */
export function formatOperationsTemplateEstimatedMinutes(
  minutes: number | null | undefined,
): string {
  return formatPostedNumber(minutes, " min", OPERATIONS_TEMPLATES_NO_ESTIMATE_COPY);
}

/** Compliance requirement on a template card when unset, blank, or em dash. */
export function formatOperationsTemplateCompliance(
  complianceRequirement: string | null | undefined,
): string {
  if (isBlankOrEmDash(complianceRequirement)) return OPERATIONS_TEMPLATES_NO_COMPLIANCE_COPY;
  return String(complianceRequirement).trim();
}

/** Linked asset name on a template card when unset, blank, or em dash. */
export function formatOperationsTemplateAsset(assetName: string | null | undefined): string {
  if (isBlankOrEmDash(assetName)) return OPERATIONS_TEMPLATES_NO_ASSET_COPY;
  return String(assetName).trim();
}

/** Linked vendor name on a template card when unset, blank, or em dash. */
export function formatOperationsTemplateVendor(vendorName: string | null | undefined): string {
  if (isBlankOrEmDash(vendorName)) return OPERATIONS_TEMPLATES_NO_VENDOR_COPY;
  return String(vendorName).trim();
}

/** Auto-complete hours on a template card — real zero stays `0h`; null names the gap. */
export function formatOperationsTemplateAutoCompleteHours(
  hours: number | null | undefined,
): string {
  return formatPostedNumber(hours, "h", OPERATIONS_TEMPLATES_NO_AUTO_COMPLETE_COPY);
}
