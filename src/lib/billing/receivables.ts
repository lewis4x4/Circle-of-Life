/**
 * The one definition of "receivable" for every Haven money page (COL-650).
 *
 * A receivable is money a payer has been asked for: an invoice that was sent
 * (`sent`, `partial`, `overdue`) and still carries a balance. A `draft` has not
 * been sent, so nothing is owed on it yet — Rent roll, Revenue and the resident
 * ledger bridge (migration 458) already draw the line here. Drafts are reported
 * next to receivables as "not yet sent", never inside them, never aged and never
 * offered for collections.
 *
 * "Past due" is a receivable whose due date is before the as-of day. The due
 * date itself is the business setting (it is written onto each invoice when it
 * is generated); this module adds no grace period of its own.
 *
 * Every page that shows outstanding, overdue or aged money reads its statuses
 * from here. `receivables.test.ts` fails if another status list appears.
 */
import { daysPastDueAsOf } from "@/lib/billing/ar-aging-as-of";

/** Sent to a payer and possibly still owed. The only receivable statuses. */
export const RECEIVABLE_INVOICE_STATUSES = ["sent", "partial", "overdue"] as const;

/** Built but not sent — not billed yet, shown separately as "not yet sent". */
export const NOT_YET_SENT_INVOICE_STATUSES = ["draft"] as const;

/** Sent at some point (receivable or settled) — what "billed" means on forecast and revenue views. */
export const BILLED_INVOICE_STATUSES = [...RECEIVABLE_INVOICE_STATUSES, "paid"] as const;

/**
 * Not yet settled: drafts plus receivables. Used where work can still happen on
 * an invoice (recording a payment against it, ordering the ledger). The one
 * money total it feeds is Stand Up Current AR, by ruling (below).
 */
export const UNSETTLED_INVOICE_STATUSES = [
  ...NOT_YET_SENT_INVOICE_STATUSES,
  ...RECEIVABLE_INVOICE_STATUSES,
] as const;

/**
 * Stand Up "Current AR" (COL-374 / COL-665). Brian's ruling, 2026-09-23:
 * "CURRENT AR IS THE AMOUNT WE SHOULD OBTAIN 'IF' EVERYONE PAYS." So it is every
 * open charge, sent or not: the receivable plus the drafts. Billing's
 * "Outstanding AR" stays sent-only with the drafts beside it; the two add up to
 * this figure, so they differ by definition and each label says so.
 */
export const CURRENT_AR_INVOICE_STATUSES = UNSETTLED_INVOICE_STATUSES;

/** What Stand Up Current AR counts, in words. */
export const CURRENT_AR_DEFINITION_COPY =
  "Everything owed if every resident pays: sent invoices with a balance plus drafts not yet sent. Billing's Outstanding AR counts sent invoices only.";

/** Per-scope note for a Current AR figure: how much of it has not been sent yet. */
export function currentArNotYetSentNote(count: number, formattedCents: string): string {
  if (count <= 0) return "Includes no drafts; every invoice in it has been sent.";
  return `Includes ${formattedCents} in ${count} draft${count === 1 ? "" : "s"} not yet sent.`;
}

export type ReceivableInvoiceStatus = (typeof RECEIVABLE_INVOICE_STATUSES)[number];

const RECEIVABLE_SET: ReadonlySet<string> = new Set(RECEIVABLE_INVOICE_STATUSES);
const NOT_YET_SENT_SET: ReadonlySet<string> = new Set(NOT_YET_SENT_INVOICE_STATUSES);
const BILLED_SET: ReadonlySet<string> = new Set(BILLED_INVOICE_STATUSES);
const UNSETTLED_SET: ReadonlySet<string> = new Set(UNSETTLED_INVOICE_STATUSES);

export function isReceivableStatus(status: string): boolean {
  return RECEIVABLE_SET.has(status);
}

export function isNotYetSentStatus(status: string): boolean {
  return NOT_YET_SENT_SET.has(status);
}

export function isBilledStatus(status: string): boolean {
  return BILLED_SET.has(status);
}

export function isUnsettledStatus(status: string): boolean {
  return UNSETTLED_SET.has(status);
}

/** A receivable that still carries a balance. */
export function isOpenReceivable(invoice: { status: string; balanceDueCents: number }): boolean {
  return isReceivableStatus(invoice.status) && invoice.balanceDueCents > 0;
}

/** An open receivable whose due date is before `asOfIso` (YYYY-MM-DD). */
export function isPastDueReceivable(
  invoice: { status: string; balanceDueCents: number; dueDateIso: string },
  asOfIso: string,
): boolean {
  return isOpenReceivable(invoice) && daysPastDueAsOf(invoice.dueDateIso, asOfIso) > 0;
}

export type ReceivablesSummary = {
  receivableCents: number;
  receivableCount: number;
  pastDueCents: number;
  pastDueCount: number;
  notYetSentCents: number;
  notYetSentCount: number;
};

/** Totals every AR tile reads, so two pages given the same invoices cannot disagree. */
export function summarizeReceivables(
  invoices: ReadonlyArray<{ status: string; balanceDueCents: number; dueDateIso: string }>,
  asOfIso: string,
): ReceivablesSummary {
  const summary: ReceivablesSummary = {
    receivableCents: 0,
    receivableCount: 0,
    pastDueCents: 0,
    pastDueCount: 0,
    notYetSentCents: 0,
    notYetSentCount: 0,
  };
  for (const invoice of invoices) {
    const balance = Math.max(0, invoice.balanceDueCents);
    if (isNotYetSentStatus(invoice.status)) {
      summary.notYetSentCount += 1;
      summary.notYetSentCents += balance;
      continue;
    }
    if (!isOpenReceivable(invoice)) continue;
    summary.receivableCount += 1;
    summary.receivableCents += balance;
    if (isPastDueReceivable(invoice, asOfIso)) {
      summary.pastDueCount += 1;
      summary.pastDueCents += balance;
    }
  }
  return summary;
}

/** What every receivable figure counts, in words, for tile captions and page subtitles. */
export const RECEIVABLE_DEFINITION_COPY =
  "Sent, partly paid and overdue invoices with a balance. Drafts are not billed until they are sent and are counted separately.";

/** Caption for the drafts that a receivable figure leaves out. */
export function notYetSentCaption(count: number, formattedCents: string): string | null {
  if (count <= 0) return null;
  return `${count} draft${count === 1 ? "" : "s"} (${formattedCents}) not yet sent — not included`;
}
