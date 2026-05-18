import type { BillingRow, InvoiceStatusUi } from "@/lib/billing/load-invoices";

const OPEN_AR_STATUSES: ReadonlySet<InvoiceStatusUi> = new Set([
  "draft",
  "sent",
  "partial",
  "overdue",
]);

export function rowContributesOpenAr(row: BillingRow): boolean {
  return OPEN_AR_STATUSES.has(row.status) && row.amountDueCents > 0;
}

/** Days past due (0 when not yet due or invalid). Matches AR aging hub bucketing. */
export function daysPastDue(dueDateIso: string): number {
  if (!dueDateIso) return 0;
  const due = new Date(`${dueDateIso}T23:59:59`);
  if (Number.isNaN(due.getTime())) return 0;
  const ms = Date.now() - due.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export type ArAgingBucketTotalsCents = {
  current030: number;
  d3160: number;
  d6190: number;
  d91Plus: number;
};

export function summarizeOpenArBucketTotals(rows: BillingRow[]): ArAgingBucketTotalsCents {
  const acc: ArAgingBucketTotalsCents = { current030: 0, d3160: 0, d6190: 0, d91Plus: 0 };
  for (const row of rows) {
    if (!rowContributesOpenAr(row)) continue;
    const d = daysPastDue(row.dueDateIso);
    const c = row.amountDueCents;
    if (d <= 30) acc.current030 += c;
    else if (d <= 60) acc.d3160 += c;
    else if (d <= 90) acc.d6190 += c;
    else acc.d91Plus += c;
  }
  return acc;
}

export function totalOpenArCents(rows: BillingRow[]): number {
  return rows.filter(rowContributesOpenAr).reduce((sum, r) => sum + r.amountDueCents, 0);
}

/** Total outstanding line item — semantic color only (Quiet Operator; no full-card chrome). */
export function outstandingArValueClass(params: {
  outstandingCents: number;
  cohortResidentCount: number;
  ninetyPlusCents: number;
}): string {
  const { outstandingCents, cohortResidentCount, ninetyPlusCents } = params;
  if (outstandingCents === 0) {
    return cohortResidentCount === 0 ? "text-muted-foreground" : "text-destructive";
  }
  const ratio90 = ninetyPlusCents / outstandingCents;
  if (ratio90 > 0.1) return "text-destructive";
  if (ninetyPlusCents > 0) return "text-warning";
  return "text-foreground";
}

export function overdueInvoicesValueClass(count: number): string {
  if (count === 0) return "text-success";
  if (count <= 3) return "text-foreground";
  if (count <= 10) return "text-warning";
  return "text-destructive";
}

export function ninetyPlusBucketValueClass(outstandingCents: number, ninetyPlusCents: number): string {
  if (ninetyPlusCents <= 0) return "text-muted-foreground";
  if (outstandingCents <= 0) return "text-warning";
  if (ninetyPlusCents / outstandingCents > 0.1) return "text-destructive";
  return "text-warning";
}

export function ninetyPlusRiskShareClass(outstandingCents: number, ninetyPlusCents: number): string {
  if (ninetyPlusCents <= 0 || outstandingCents <= 0) return "text-muted-foreground";
  const ratio = ninetyPlusCents / outstandingCents;
  if (ratio > 0.05) return "text-destructive";
  return "text-warning";
}

/** Rolling collection-rate KPI tone — thresholds align with Quiet Operator billing handoff until engine lands. */
export function collectionRateSemanticClass(ratePct: number | null | undefined): string {
  if (ratePct == null || Number.isNaN(ratePct)) return "text-muted-foreground";
  if (ratePct >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (ratePct >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

export function standardBucketValueClass(cents: number): string {
  return cents > 0 ? "text-foreground" : "text-muted-foreground";
}
