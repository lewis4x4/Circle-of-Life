/**
 * Rent roll model (COL-583).
 *
 * Pure derivation from rows Haven already keeps — residents, resident_payers,
 * payments, invoices — into the shape of the office's monthly A/R sheet:
 * one row per resident with the contracted month split private vs Medicaid,
 * what was collected from each, and what is still outstanding.
 *
 * Nothing here invents a figure. When a resident has no rate on file the
 * contracted amount is null and the row says so; when the private + Medicaid
 * split does not total the contracted amount the row says that too (the sheet
 * carries the same warning: "Columns E & G should total column D").
 */

export type RentRollPeriod = { year: number; month: number };

export type RentRollPeriodBounds = {
  /** YYYY-MM */
  key: string;
  /** "September 2026" */
  label: string;
  /** "August 2026" — Medicaid is billed for the prior month's dates of service */
  priorMonthLabel: string;
  /** YYYY-MM-DD inclusive */
  startIso: string;
  /** YYYY-MM-DD exclusive (first day of the next month) */
  endExclusiveIso: string;
  /** YYYY-MM-DD inclusive (last day of the month) */
  endIso: string;
};

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

export function parseRentRollPeriod(raw: string | null | undefined, today: Date = new Date()): RentRollPeriod {
  const m = raw ? PERIOD_RE.exec(raw.trim()) : null;
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
  }
  return { year: today.getFullYear(), month: today.getMonth() + 1 };
}

function isoDate(year: number, monthIndex0: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex0, day)).toISOString().slice(0, 10);
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function rentRollPeriodBounds(period: RentRollPeriod): RentRollPeriodBounds {
  const start = new Date(Date.UTC(period.year, period.month - 1, 1));
  const prior = new Date(Date.UTC(period.year, period.month - 2, 1));
  return {
    key: `${period.year}-${String(period.month).padStart(2, "0")}`,
    label: MONTH_LABEL.format(start),
    priorMonthLabel: MONTH_LABEL.format(prior),
    startIso: isoDate(period.year, period.month - 1, 1),
    endExclusiveIso: isoDate(period.year, period.month, 1),
    endIso: isoDate(period.year, period.month, 0),
  };
}

export function shiftRentRollPeriod(period: RentRollPeriod, deltaMonths: number): RentRollPeriod {
  const d = new Date(Date.UTC(period.year, period.month - 1 + deltaMonths, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export type RentRollResidentInput = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  admissionDate: string | null;
  dischargeDate: string | null;
  admissionSource: string | null;
  monthlyTotalRateCents: number | null;
  roomLabel: string | null;
  bedLabel: string | null;
};

export type RentRollPayerInput = {
  residentId: string;
  payerType: string;
  payerName: string | null;
  /** Managed-care plan name when the payer is linked to the facility's Medicaid catalog */
  providerName: string | null;
  payerShareType: string;
  payerFixedAmountCents: number | null;
  medicaidRateCents: number | null;
  medicaidRateUnit: string | null;
  medicaidPatientResponsibilityCents: number | null;
  effectiveDate: string;
  endDate: string | null;
};

export type RentRollPaymentInput = {
  residentId: string;
  amountCents: number;
  paymentDate: string;
  paymentMethod: string;
  payerType: string | null;
  refunded: boolean;
  refundAmountCents: number | null;
};

export type RentRollCollectionNoteInput = {
  residentId: string;
  activityDate: string;
  activityType: string;
  description: string;
  outcome: string | null;
  followUpDate: string | null;
};

export type RentRollInvoiceInput = {
  residentId: string;
  status: string;
  totalCents: number;
  balanceDueCents: number;
  invoiceDate: string;
  periodStart: string | null;
};

export type RentRollRow = {
  residentId: string;
  /** "Last, First" as the sheet writes it */
  residentName: string;
  roomLabel: string | null;
  admissionDate: string | null;
  admittedFrom: string | null;
  contractedCents: number | null;
  privateShareCents: number | null;
  medicaidBilledCents: number | null;
  otherSourceCents: number | null;
  paidPrivatelyCents: number;
  medicaidPaidCents: number;
  outstandingCents: number | null;
  medicaidPlan: string | null;
  medicaidPending: boolean;
  invoice: { status: string; totalCents: number; balanceDueCents: number } | null;
  /** Latest collection activity on file up to the end of the month, if any */
  collectionNote: { date: string; text: string; followUpDate: string | null } | null;
  /** Plain-language caveats shown on the row; empty when nothing needs saying */
  flags: string[];
};

export type RentRollTotals = {
  residentCount: number;
  rowsWithoutRate: number;
  contractedCents: number;
  privateShareCents: number;
  medicaidBilledCents: number;
  otherSourceCents: number;
  paidPrivatelyCents: number;
  medicaidPaidCents: number;
  collectedCents: number;
  outstandingCents: number;
  /** collected / contracted, 0..1, or null when nothing is contracted */
  collectionRate: number | null;
};

export type RentRollInput = {
  period: RentRollPeriod;
  residents: RentRollResidentInput[];
  payers: RentRollPayerInput[];
  payments: RentRollPaymentInput[];
  invoices: RentRollInvoiceInput[];
  collectionNotes?: RentRollCollectionNoteInput[];
};

export type RentRoll = { bounds: RentRollPeriodBounds; rows: RentRollRow[]; totals: RentRollTotals };

const EXCLUDED_STATUSES = new Set(["inquiry", "pending_admission"]);
const LEFT_STATUSES = new Set(["discharged", "deceased"]);
const PENDING_RE = /pending/i;

function inPeriod(iso: string | null, bounds: RentRollPeriodBounds): boolean {
  return iso !== null && iso >= bounds.startIso && iso < bounds.endExclusiveIso;
}

/** A resident belongs on the month's sheet if they were in the building at any point in the month. */
export function residentOnRentRoll(resident: RentRollResidentInput, bounds: RentRollPeriodBounds): boolean {
  if (EXCLUDED_STATUSES.has(resident.status)) return false;
  if (resident.admissionDate && resident.admissionDate >= bounds.endExclusiveIso) return false;
  if (LEFT_STATUSES.has(resident.status)) {
    // A resident who left before the month started is not on it; one with no
    // discharge date recorded cannot be placed, so they are left off rather than guessed.
    return resident.dischargeDate !== null && resident.dischargeDate >= bounds.startIso;
  }
  return true;
}

function payerActiveInPeriod(payer: RentRollPayerInput, bounds: RentRollPeriodBounds): boolean {
  if (payer.effectiveDate > bounds.endIso) return false;
  if (payer.endDate !== null && payer.endDate < bounds.startIso) return false;
  return true;
}

function isMedicaidPayment(payment: RentRollPaymentInput): boolean {
  return payment.payerType === "medicaid_oss" || payment.paymentMethod === "medicaid_payment";
}

function netPaymentCents(payment: RentRollPaymentInput): number {
  const refund = payment.refunded ? (payment.refundAmountCents ?? 0) : 0;
  return payment.amountCents - refund;
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function shortDate(iso: string): string {
  return SHORT_DATE.format(new Date(`${iso}T00:00:00Z`));
}

/** Rooms sort the way the building reads them: 1, 1-A, 2, 7A, 7B, 10A, 18B — not "1, 10, 18, 2". */
export function compareRoomLabels(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const pa = a.match(/\d+|[A-Za-z]+/g) ?? [a];
  const pb = b.match(/\d+|[A-Za-z]+/g) ?? [b];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const bothNumeric = !Number.isNaN(nx) && !Number.isNaN(ny);
    const c = bothNumeric ? nx - ny : x.localeCompare(y, "en", { sensitivity: "base" });
    if (c !== 0) return c;
  }
  return 0;
}

function pickInvoice(invoices: RentRollInvoiceInput[], bounds: RentRollPeriodBounds): RentRollInvoiceInput | null {
  const inMonth = invoices.filter((inv) =>
    inv.periodStart ? inPeriod(inv.periodStart, bounds) : inPeriod(inv.invoiceDate, bounds),
  );
  if (inMonth.length === 0) return null;
  inMonth.sort((x, y) => y.invoiceDate.localeCompare(x.invoiceDate));
  return inMonth[0];
}

export function buildRentRoll(input: RentRollInput): RentRoll {
  const bounds = rentRollPeriodBounds(input.period);

  const payersByResident = new Map<string, RentRollPayerInput[]>();
  for (const payer of input.payers) {
    if (!payerActiveInPeriod(payer, bounds)) continue;
    const list = payersByResident.get(payer.residentId) ?? [];
    list.push(payer);
    payersByResident.set(payer.residentId, list);
  }

  const paymentsByResident = new Map<string, RentRollPaymentInput[]>();
  for (const payment of input.payments) {
    if (!inPeriod(payment.paymentDate, bounds)) continue;
    const list = paymentsByResident.get(payment.residentId) ?? [];
    list.push(payment);
    paymentsByResident.set(payment.residentId, list);
  }

  const invoicesByResident = new Map<string, RentRollInvoiceInput[]>();
  for (const invoice of input.invoices) {
    const list = invoicesByResident.get(invoice.residentId) ?? [];
    list.push(invoice);
    invoicesByResident.set(invoice.residentId, list);
  }

  const latestNoteByResident = new Map<string, RentRollCollectionNoteInput>();
  for (const note of input.collectionNotes ?? []) {
    if (note.activityDate > bounds.endIso) continue;
    const current = latestNoteByResident.get(note.residentId);
    if (!current || note.activityDate > current.activityDate) latestNoteByResident.set(note.residentId, note);
  }

  const rows: RentRollRow[] = [];

  for (const resident of input.residents) {
    if (!residentOnRentRoll(resident, bounds)) continue;

    const flags: string[] = [];
    const payers = payersByResident.get(resident.id) ?? [];

    let contracted: number | null = null;
    let privateShare: number | null = null;
    let medicaidBilled: number | null = null;
    let otherSource: number | null = null;
    let medicaidPlan: string | null = null;
    let medicaidPending = false;

    for (const payer of payers) {
      const fixed = payer.payerShareType === "fixed_amount" ? payer.payerFixedAmountCents : null;
      if (fixed !== null) contracted = (contracted ?? 0) + fixed;

      switch (payer.payerType) {
        case "private_pay": {
          if (fixed !== null) privateShare = (privateShare ?? 0) + fixed;
          break;
        }
        case "medicaid_oss": {
          const plan = payer.providerName ?? payer.payerName;
          if (plan && PENDING_RE.test(plan)) {
            medicaidPending = true;
          } else if (plan && plan.trim() !== "") {
            medicaidPlan = medicaidPlan ? `${medicaidPlan} / ${plan}` : plan;
          }
          if (payer.medicaidRateCents !== null) {
            if (payer.medicaidRateUnit === null || payer.medicaidRateUnit === "monthly") {
              medicaidBilled = (medicaidBilled ?? 0) + payer.medicaidRateCents;
            } else {
              flags.push(`Medicaid rate on file is ${payer.medicaidRateUnit.replace(/_/g, " ")}, not monthly`);
            }
          }
          if (payer.medicaidPatientResponsibilityCents !== null) {
            privateShare = (privateShare ?? 0) + payer.medicaidPatientResponsibilityCents;
          }
          break;
        }
        default: {
          if (fixed !== null) otherSource = (otherSource ?? 0) + fixed;
          break;
        }
      }
    }

    if (contracted === null && resident.monthlyTotalRateCents !== null) {
      contracted = resident.monthlyTotalRateCents;
      flags.push("Contracted amount is the resident's rate on file; no payer split recorded");
    }
    if (contracted === null) {
      flags.push(payers.length === 0 ? "No payer on file" : "No rate on file");
    } else {
      const known = (privateShare ?? 0) + (medicaidBilled ?? 0) + (otherSource ?? 0);
      if ((privateShare !== null || medicaidBilled !== null || otherSource !== null) && known !== contracted) {
        flags.push("Private + Medicaid split does not total the contracted amount");
      }
    }
    if (medicaidPending && medicaidPlan === null) medicaidPlan = "MCD Pending";

    let paidPrivately = 0;
    let medicaidPaid = 0;
    for (const payment of paymentsByResident.get(resident.id) ?? []) {
      const net = netPaymentCents(payment);
      if (isMedicaidPayment(payment)) medicaidPaid += net;
      else paidPrivately += net;
    }

    const outstanding = contracted === null ? null : contracted - paidPrivately - medicaidPaid;

    if (resident.admissionDate && inPeriod(resident.admissionDate, bounds)) {
      flags.push(`Moved in ${shortDate(resident.admissionDate)}`);
    }
    if (resident.dischargeDate && inPeriod(resident.dischargeDate, bounds)) {
      flags.push(`${resident.status === "deceased" ? "Deceased" : "Moved out"} ${shortDate(resident.dischargeDate)}`);
    } else if (resident.status === "hospital_hold") {
      flags.push("At hospital");
    } else if (resident.status === "loa") {
      flags.push("On leave");
    }

    const invoice = pickInvoice(invoicesByResident.get(resident.id) ?? [], bounds);
    const note = latestNoteByResident.get(resident.id) ?? null;
    const collectionNote = note
      ? {
          date: note.activityDate,
          text: note.outcome ? `${note.description} — ${note.outcome}` : note.description,
          followUpDate: note.followUpDate,
        }
      : null;

    rows.push({
      residentId: resident.id,
      residentName: `${resident.lastName}, ${resident.firstName}`.trim(),
      roomLabel: resident.roomLabel,
      admissionDate: resident.admissionDate,
      admittedFrom: resident.admissionSource,
      contractedCents: contracted,
      privateShareCents: privateShare,
      medicaidBilledCents: medicaidBilled,
      otherSourceCents: otherSource,
      paidPrivatelyCents: paidPrivately,
      medicaidPaidCents: medicaidPaid,
      outstandingCents: outstanding,
      medicaidPlan,
      medicaidPending,
      invoice: invoice ? { status: invoice.status, totalCents: invoice.totalCents, balanceDueCents: invoice.balanceDueCents } : null,
      collectionNote,
      flags,
    });
  }

  rows.sort((a, b) => compareRoomLabels(a.roomLabel, b.roomLabel) || a.residentName.localeCompare(b.residentName));

  const totals: RentRollTotals = {
    residentCount: rows.length,
    rowsWithoutRate: rows.filter((r) => r.contractedCents === null).length,
    contractedCents: 0,
    privateShareCents: 0,
    medicaidBilledCents: 0,
    otherSourceCents: 0,
    paidPrivatelyCents: 0,
    medicaidPaidCents: 0,
    collectedCents: 0,
    outstandingCents: 0,
    collectionRate: null,
  };
  for (const row of rows) {
    totals.contractedCents += row.contractedCents ?? 0;
    totals.privateShareCents += row.privateShareCents ?? 0;
    totals.medicaidBilledCents += row.medicaidBilledCents ?? 0;
    totals.otherSourceCents += row.otherSourceCents ?? 0;
    totals.paidPrivatelyCents += row.paidPrivatelyCents;
    totals.medicaidPaidCents += row.medicaidPaidCents;
    totals.outstandingCents += row.outstandingCents ?? 0;
  }
  totals.collectedCents = totals.paidPrivatelyCents + totals.medicaidPaidCents;
  totals.collectionRate = totals.contractedCents > 0 ? totals.collectedCents / totals.contractedCents : null;

  return { bounds, rows, totals };
}

/** CSV in the sheet's column order, so the office can drop it next to the workbook. */
export function rentRollToCsv(roll: RentRoll): string {
  const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
  const quote = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;
  const header = [
    "Room #",
    "Admit Date",
    "Resident",
    "Total PVT & MCD",
    "PVT",
    "Amount Paid Privately",
    `Medicaid Billed - DOS ${roll.bounds.priorMonthLabel}`,
    `Medicaid Amount PD for ${roll.bounds.priorMonthLabel}`,
    "Outstanding Amount",
    "Medicaid Plan",
    "Notes",
    "Admitted From",
  ];
  const lines = roll.rows.map((row) =>
    [
      quote(row.roomLabel),
      row.admissionDate ?? "",
      quote(row.residentName),
      dollars(row.contractedCents),
      dollars(row.privateShareCents),
      dollars(row.paidPrivatelyCents),
      dollars(row.medicaidBilledCents),
      dollars(row.medicaidPaidCents),
      dollars(row.outstandingCents),
      quote(row.medicaidPlan),
      quote([row.collectionNote ? `${row.collectionNote.date}: ${row.collectionNote.text}` : null, ...row.flags].filter(Boolean).join("; ")),
      quote(row.admittedFrom),
    ].join(","),
  );
  const t = roll.totals;
  lines.push(
    [
      "",
      "",
      quote("Totals"),
      dollars(t.contractedCents),
      dollars(t.privateShareCents),
      dollars(t.paidPrivatelyCents),
      dollars(t.medicaidBilledCents),
      dollars(t.medicaidPaidCents),
      dollars(t.outstandingCents),
      "",
      "",
      "",
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
