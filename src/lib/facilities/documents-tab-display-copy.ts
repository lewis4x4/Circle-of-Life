/**
 * Quiet Operator copy for the facility detail documents tab.
 * Missing uploader attribution names real gaps — never fabricate staff names.
 */

export const DOCUMENTS_TAB_NO_UPLOADER_COPY = "No uploader posted";

const LEGACY_UNKNOWN_UPLOADER = "Unknown";

/** Uploader display on document cards when unset, blank, a lone em dash, or legacy generic copy. */
export function formatDocumentsTabUploaderDisplay(
  uploadedByDisplay: string | null | undefined,
): string {
  if (uploadedByDisplay == null) return DOCUMENTS_TAB_NO_UPLOADER_COPY;
  const trimmed = uploadedByDisplay.trim();
  if (!trimmed || trimmed === "—" || trimmed === LEGACY_UNKNOWN_UPLOADER) {
    return DOCUMENTS_TAB_NO_UPLOADER_COPY;
  }
  return trimmed;
}
