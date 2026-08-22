/**
 * Document Vault KPI math for FacilityHeader (tab=document).
 * Category keys must align with `facility_documents.document_category` CHECK constraint.
 */

import {
  facilityDateIsoDaysFromToday,
  todayFacilityDateIso,
} from "@/lib/facility-wall-clock";
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

/** Eastern calendar today + 60-day window for vault expiration KPIs. */
export function getDocumentVaultKpiDateWindow(now: Date = new Date()) {
  const today = todayFacilityDateIso(now);
  const plus60 = facilityDateIsoDaysFromToday(60, now);
  return { today, plus60 };
}

/** Calendar-day distance from Eastern today to a date-only expiration (negative = expired). */
export function daysUntilFacilityExpirationDate(
  expirationYmd: string,
  now: Date = new Date(),
): number {
  const today = todayFacilityDateIso(now);
  const expMs = new Date(`${expirationYmd}T12:00:00.000Z`).getTime();
  const todayMs = new Date(`${today}T12:00:00.000Z`).getTime();
  return Math.round((expMs - todayMs) / 86_400_000);
}

/** Document counts as active for requirement coverage when not expired. */
export function isDocumentRequirementSatisfied(expirationDate: string | null, todayISO: string): boolean {
  if (expirationDate == null || expirationDate === "") return true;
  return expirationDate >= todayISO;
}

export function computeDocumentVaultKpi(rows: VaultDocSlice[], now: Date = new Date()): DocumentVaultKpiPayload {
  const { today, plus60 } = getDocumentVaultKpiDateWindow(now);

  let expiringLt60 = 0;
  let expired = 0;

  for (const r of rows) {
    const exp = r.expiration_date;
    if (exp == null || exp === "") continue;
    if (exp < today) {
      expired += 1;
    } else if (exp <= plus60) {
      expiringLt60 += 1;
    }
  }

  const categoriesCovered = new Set<string>();
  for (const r of rows) {
    if (isDocumentRequirementSatisfied(r.expiration_date, today)) {
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
