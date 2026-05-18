/**
 * Document Vault KPI math for FacilityHeader (tab=document).
 * Category keys must align with `facility_documents.document_category` CHECK constraint.
 */

import { DOCUMENT_VAULT_REQUIRED_SLOTS } from "@/lib/admin/facilities/document-vault-taxonomy";

export type DocumentVaultKpiPayload = {
  total: number;
  expiringLt60: number;
  expired: number;
  missingRequired: number;
};

export type VaultDocSlice = {
  document_category: string;
  expiration_date: string | null;
};

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Document counts as active for requirement coverage when not expired. */
export function isDocumentRequirementSatisfied(expirationDate: string | null, todayISO: string): boolean {
  if (expirationDate == null || expirationDate === "") return true;
  return expirationDate >= todayISO;
}

export function computeDocumentVaultKpi(rows: VaultDocSlice[], today = new Date()): DocumentVaultKpiPayload {
  const todayISO = isoDateUTC(today);
  const plus60 = new Date(today);
  plus60.setUTCDate(plus60.getUTCDate() + 60);
  const plus60ISO = isoDateUTC(plus60);

  let expiringLt60 = 0;
  let expired = 0;

  for (const r of rows) {
    const exp = r.expiration_date;
    if (exp == null || exp === "") continue;
    if (exp < todayISO) {
      expired += 1;
    } else if (exp <= plus60ISO) {
      expiringLt60 += 1;
    }
  }

  const categoriesCovered = new Set<string>();
  for (const r of rows) {
    if (isDocumentRequirementSatisfied(r.expiration_date, todayISO)) {
      categoriesCovered.add(r.document_category);
    }
  }

  let missingRequired = 0;
  for (const req of DOCUMENT_VAULT_REQUIRED_SLOTS) {
    if (!categoriesCovered.has(req)) missingRequired += 1;
  }

  return {
    total: rows.length,
    expiringLt60,
    expired,
    missingRequired,
  };
}
