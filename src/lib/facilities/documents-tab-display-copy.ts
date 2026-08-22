/**
 * Quiet Operator copy for the facility detail documents tab.
 * Missing uploader attribution names real gaps — never fabricate staff names.
 */

import type { DocumentVaultCategoryKey } from "@/lib/admin/facilities/document-vault-taxonomy";
import {
  DOCUMENT_CATEGORY_EXPIRATION_NA,
  vaultCategoryExpirationRequired,
} from "@/lib/admin/facilities/document-vault-taxonomy";
import {
  daysUntilFacilityExpirationDate,
} from "@/lib/admin/facilities/document-vault-kpi";

export const DOCUMENTS_TAB_NO_UPLOADER_COPY = "No uploader posted";

/** Required-category vault rows with no expiration_date — named gap, not a silent zero. */
export const DOCUMENTS_TAB_EXPIRATION_REQUIRED_GAP_COPY = "Expiration required — not posted";

export type DocumentsTabExpirationVisual = {
  line: string;
  className: string;
};

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

/** Expiration line for vault cards and attention queue — Eastern calendar today, not UTC slice. */
export function formatDocumentsTabExpirationVisual(
  documentCategory: string,
  expirationDate: string | null,
  now: Date = new Date(),
): DocumentsTabExpirationVisual {
  const key = documentCategory as DocumentVaultCategoryKey;
  if (DOCUMENT_CATEGORY_EXPIRATION_NA.has(key)) {
    return { line: "N/A", className: "text-muted-foreground" };
  }
  if (!expirationDate) {
    if (vaultCategoryExpirationRequired(key)) {
      return {
        line: DOCUMENTS_TAB_EXPIRATION_REQUIRED_GAP_COPY,
        className: "text-warning font-medium",
      };
    }
    return { line: "No expiry on file", className: "text-muted-foreground" };
  }

  const days = daysUntilFacilityExpirationDate(expirationDate, now);
  const formatted = new Date(`${expirationDate}T12:00:00`).toLocaleDateString();
  if (days < 0) {
    return {
      line: `Expired ${Math.abs(days)} days ago`,
      className: "text-destructive font-medium",
    };
  }
  if (days < 60) {
    return {
      line: `Expires ${formatted} · in ${days} days`,
      className: "text-warning font-medium",
    };
  }
  return {
    line: `Expires ${formatted} · in ${days} days`,
    className: "text-muted-foreground",
  };
}

/** Attention queue: expiring/expired rows plus required categories missing expiration_date. */
export function isDocumentsTabAttentionRequired(
  documentCategory: string,
  expirationDate: string | null,
  now: Date = new Date(),
): boolean {
  const key = documentCategory as DocumentVaultCategoryKey;
  if (DOCUMENT_CATEGORY_EXPIRATION_NA.has(key)) return false;
  if (!expirationDate) {
    return vaultCategoryExpirationRequired(key);
  }
  return daysUntilFacilityExpirationDate(expirationDate, now) <= 60;
}
