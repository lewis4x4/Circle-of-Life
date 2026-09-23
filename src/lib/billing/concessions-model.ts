/**
 * Concession register (COL-666).
 *
 * Brian's ruling 4c (default): a concession is a discount against the SAME
 * payer's posted rate. The posted rate schedule is the private-pay rate, so
 * only a resident who pays privately can have a concession against it. A
 * resident whose terms are split with Medicaid, long-term-care insurance, VA
 * or another source is a payer split: each payer's share is listed, and the
 * lower private share is not a discount. `billing_rate_rules.
 * payer_split_is_concession` can turn the old comparison back on per facility.
 *
 * The room a resident is compared against comes from their agreement, or else
 * from the room their bed is in. With neither, no comparison is made.
 */

export type ConcessionRoomClass = "private" | "companion";

export type ConcessionPayerInput = {
  payerType: string;
  payerName: string | null;
  payerShareType: string;
  payerFixedAmountCents: number | null;
  medicaidRateCents: number | null;
  medicaidPatientResponsibilityCents: number | null;
};

export type ConcessionResidentInput = {
  id: string;
  name: string;
  acuityLevel: string | null;
  monthlyTotalRateCents: number | null;
  rateEffectiveDate: string | null;
  /** Room type of the resident's bed (`rooms.room_type`), if assigned. */
  bedRoomType: string | null;
  payers: ConcessionPayerInput[];
};

export type ConcessionAgreementInput = {
  roomClass: string;
  effectiveDate: string;
  negotiatedMonthlyTotalCents: number;
  standardMonthlyTotalAtSigningCents: number;
  concessionReason: string;
  concessionExpiresOn: string | null;
};

export type ConcessionScheduleInput = {
  basePrivateCents: number;
  baseSemiPrivateCents: number | null;
  careLevel1Cents: number;
  careLevel2Cents: number;
  careLevel3Cents: number;
};

export type PayerSplitLine = { label: string; cents: number | null };

export type ConcessionRow = {
  residentId: string;
  residentName: string;
  kind: "concession" | "payer_split";
  source: "agreement" | "imported";
  /** Null when the resident's room is not known, so no posted rate applies. */
  roomClass: ConcessionRoomClass | null;
  roomClassFrom: "agreement" | "bed" | null;
  /** The same payer's posted rate (private-pay schedule), or null when not comparable. */
  postedCents: number | null;
  agreedCents: number;
  /** Posted minus agreed; negative is a premium. Null for payer splits and unknown rooms. */
  concessionCents: number | null;
  splits: PayerSplitLine[];
  reason: string;
  effectiveDate: string | null;
  expiresOn: string | null;
};

export type ConcessionTotals = {
  concessionResidents: number;
  postedCents: number;
  agreedCents: number;
  concessionsCents: number;
  premiumsCents: number;
  payerSplitResidents: number;
  payerSplitTermsCents: number;
  notComparedResidents: number;
};

const PAYER_LABEL: Record<string, string> = {
  private_pay: "Private pay",
  medicaid_oss: "Medicaid",
  ltc_insurance: "Long-term care insurance",
  va_aid_attendance: "VA Aid & Attendance",
  other: "Other payer",
};

export function roomClassFromRoomType(roomType: string | null): ConcessionRoomClass | null {
  if (roomType === "private") return "private";
  if (roomType === "semi_private" || roomType === "shared") return "companion";
  return null;
}

function roomClassFromAgreement(roomClass: string): ConcessionRoomClass | null {
  if (roomClass === "private") return "private";
  if (roomClass === "companion") return "companion";
  return null;
}

function careForAcuity(schedule: ConcessionScheduleInput, acuity: string | null): number {
  if (acuity === "level_1") return schedule.careLevel1Cents;
  if (acuity === "level_2") return schedule.careLevel2Cents;
  if (acuity === "level_3") return schedule.careLevel3Cents;
  return 0;
}

export function postedPrivatePayCents(
  schedule: ConcessionScheduleInput | null,
  roomClass: ConcessionRoomClass | null,
  acuity: string | null,
): number | null {
  if (!schedule || !roomClass) return null;
  const base = roomClass === "companion" ? schedule.baseSemiPrivateCents ?? schedule.basePrivateCents : schedule.basePrivateCents;
  return base + careForAcuity(schedule, acuity);
}

/** True when anyone other than the resident pays part of the terms. */
export function isPayerSplit(payers: ReadonlyArray<ConcessionPayerInput>): boolean {
  return payers.some((payer) => payer.payerType !== "private_pay");
}

/** Each payer's monthly share, as recorded; a missing amount stays null rather than zero. */
export function payerSplitLines(payers: ReadonlyArray<ConcessionPayerInput>): PayerSplitLine[] {
  const lines: PayerSplitLine[] = [];
  for (const payer of payers) {
    const label = payer.payerName?.trim() ? `${PAYER_LABEL[payer.payerType] ?? "Payer"} (${payer.payerName.trim()})` : PAYER_LABEL[payer.payerType] ?? "Payer";
    if (payer.payerType === "medicaid_oss") {
      lines.push({ label, cents: payer.medicaidRateCents });
      if (payer.medicaidPatientResponsibilityCents != null) {
        lines.push({ label: "Resident share", cents: payer.medicaidPatientResponsibilityCents });
      }
      continue;
    }
    const fixed = payer.payerShareType === "fixed_amount" ? payer.payerFixedAmountCents : null;
    lines.push({ label, cents: fixed });
  }
  return lines;
}

export function buildConcessionRows(input: {
  residents: ReadonlyArray<ConcessionResidentInput>;
  agreementsByResident: ReadonlyMap<string, ConcessionAgreementInput>;
  schedule: ConcessionScheduleInput | null;
  payerSplitIsConcession: boolean;
}): ConcessionRow[] {
  const rows: ConcessionRow[] = [];
  for (const resident of input.residents) {
    const agreement = input.agreementsByResident.get(resident.id);
    const agreedCents = agreement?.negotiatedMonthlyTotalCents ?? resident.monthlyTotalRateCents;
    if (agreedCents == null || agreedCents <= 0) continue;

    const agreementRoom = agreement ? roomClassFromAgreement(agreement.roomClass) : null;
    const bedRoom = roomClassFromRoomType(resident.bedRoomType);
    const roomClass = agreementRoom ?? bedRoom;
    const roomClassFrom = agreementRoom ? "agreement" : bedRoom ? "bed" : null;
    const split = isPayerSplit(resident.payers);
    const kind = split && !input.payerSplitIsConcession ? "payer_split" : "concession";

    let postedCents: number | null = null;
    let concessionCents: number | null = null;
    if (kind === "concession") {
      postedCents =
        postedPrivatePayCents(input.schedule, roomClass, resident.acuityLevel) ??
        (agreement && agreement.standardMonthlyTotalAtSigningCents > 0 ? agreement.standardMonthlyTotalAtSigningCents : null);
      concessionCents = postedCents == null ? null : postedCents - agreedCents;
    }

    rows.push({
      residentId: resident.id,
      residentName: resident.name,
      kind,
      source: agreement ? "agreement" : "imported",
      roomClass,
      roomClassFrom,
      postedCents,
      agreedCents,
      concessionCents,
      splits: split ? payerSplitLines(resident.payers) : [],
      reason: agreement?.concessionReason ?? "legacy_rate_lock",
      effectiveDate: agreement?.effectiveDate ?? resident.rateEffectiveDate,
      expiresOn: agreement?.concessionExpiresOn ?? null,
    });
  }
  return rows.sort(
    (a, b) =>
      Number(a.kind === "payer_split") - Number(b.kind === "payer_split") ||
      (b.concessionCents ?? Number.NEGATIVE_INFINITY) - (a.concessionCents ?? Number.NEGATIVE_INFINITY) ||
      a.residentName.localeCompare(b.residentName),
  );
}

export function summarizeConcessions(rows: ReadonlyArray<ConcessionRow>): ConcessionTotals {
  const totals: ConcessionTotals = {
    concessionResidents: 0,
    postedCents: 0,
    agreedCents: 0,
    concessionsCents: 0,
    premiumsCents: 0,
    payerSplitResidents: 0,
    payerSplitTermsCents: 0,
    notComparedResidents: 0,
  };
  for (const row of rows) {
    if (row.kind === "payer_split") {
      totals.payerSplitResidents += 1;
      totals.payerSplitTermsCents += row.agreedCents;
      continue;
    }
    if (row.concessionCents == null || row.postedCents == null) {
      totals.notComparedResidents += 1;
      continue;
    }
    totals.concessionResidents += 1;
    totals.postedCents += row.postedCents;
    totals.agreedCents += row.agreedCents;
    totals.concessionsCents += Math.max(0, row.concessionCents);
    totals.premiumsCents += Math.max(0, -row.concessionCents);
  }
  return totals;
}

/** What the page counts, in words (COL-667: every resident count on a money page states its filter). */
export function concessionsResidentCountLabel(count: number): string {
  return `${count} resident${count === 1 ? "" : "s"} active today with a monthly rate on file`;
}
