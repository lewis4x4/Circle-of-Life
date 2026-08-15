/**
 * Quiet Operator copy for facility document API uploader attribution.
 * Missing uploader names real gaps — never fabricate staff names or legacy "Unknown" copy.
 */

export const FACILITY_DOCUMENTS_NO_UPLOADER_COPY = "No uploader posted";

const LEGACY_UNKNOWN_UPLOADER = "Unknown";

function normalizeResolvedUploaderName(resolvedName: string | null | undefined): string {
  if (resolvedName == null) return FACILITY_DOCUMENTS_NO_UPLOADER_COPY;
  const trimmed = resolvedName.trim();
  if (!trimmed || trimmed === "—" || trimmed === LEGACY_UNKNOWN_UPLOADER) {
    return FACILITY_DOCUMENTS_NO_UPLOADER_COPY;
  }
  return trimmed;
}

/** Uploader display for facility document API rows from `uploaded_by` + profile lookup map. */
export function formatFacilityDocumentUploaderDisplay(
  uploadedBy: unknown,
  nameByUserId: Map<string, string>,
): string {
  if (typeof uploadedBy !== "string" || !uploadedBy.trim()) {
    return FACILITY_DOCUMENTS_NO_UPLOADER_COPY;
  }
  return normalizeResolvedUploaderName(nameByUserId.get(uploadedBy));
}
