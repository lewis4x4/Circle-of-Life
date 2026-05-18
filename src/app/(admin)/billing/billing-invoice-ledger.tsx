"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { AdminFilterBar, AdminOperationalListPanel, AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import {
  ninetyPlusBucketValueClass,
  outstandingArValueClass,
  overdueInvoicesValueClass,
  standardBucketValueClass,
  summarizeOpenArBucketTotals,
  totalOpenArCents,
} from "@/lib/billing/billing-ar-semantics";
import {
  fetchInvoicesFromSupabase,
  fetchActiveResidentCountForBillingScope,
  type BillingRow,
  type InvoiceStatusUi,
  type PayerTypeUi,
} from "@/lib/billing/load-invoices";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export {
  mapDbInvoiceStatusToUi,
  mapDbPayerTypeToUi,
  type BillingRow,
  type InvoiceStatusUi,
  type PayerTypeUi,
} from "@/lib/billing/load-invoices";

const DEFAULT_FILTERS = {
  search: "",
  status: "all",
  payerType: "all",
};

export const billingCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export type BillingInvoiceLedgerProps = {
  title?: string;
  layout?: "overview" | "standard";
  /** Overview-only: cohort for $0 AR semantic (facility scope when set). */
  initialCohortResidentCount?: number;
  cardTitle?: string;
  cardDescription?: string;
  residentIdFilter?: string | null;
  initialRows?: BillingRow[];
  initialError?: string | null;
  initialFacilityId?: string | null;
};

type MetricLinkProps = {
  href: string;
  label: string;
  value: string;
  valueClassName: string;
};

function MetricTile({ href, label, value, valueClassName }: MetricLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center rounded-xl border border-border bg-card px-2 py-3 text-center shadow-[var(--shadow-card)] ring-1 ring-border/60",
        "transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className={cn(
          "text-[28px] font-semibold tabular-nums leading-tight tracking-tight md:text-[28px]",
          valueClassName,
        )}
      >
        {value}
      </span>
      <span className="mt-2 max-w-[10rem] text-[13px] leading-snug text-muted-foreground">{label}</span>
    </Link>
  );
}

function BillingInvoiceLedgerInner({
  title,
  layout = "standard",
  initialCohortResidentCount = 0,
  cardTitle = "Invoice ledger",
  cardDescription = "Open invoices and balances from the billing schema (RLS-scoped).",
  residentIdFilter = null,
  initialRows,
  initialError,
  initialFacilityId,
}: BillingInvoiceLedgerProps) {
  const searchParams = useSearchParams();
  const urlStatusAppliedRef = useRef(false);

  const hasInitialLoad =
    initialRows !== undefined || initialError !== undefined || initialFacilityId !== undefined;
  const initialLoadSucceeded = hasInitialLoad && initialError == null;
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<BillingRow[]>(initialRows ?? []);
  const [isLoading, setIsLoading] = useState(!hasInitialLoad);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const skippedInitialLoadRef = useRef(false);
  const loadedFacilityIdRef = useRef<string | null>(initialLoadSucceeded ? (initialFacilityId ?? null) : null);
  const hasLoadedFacilityScopeRef = useRef(initialLoadSucceeded);

  const [cohortCount, setCohortCount] = useState<number>(initialCohortResidentCount);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [payerType, setPayerType] = useState(DEFAULT_FILTERS.payerType);

  useEffect(() => {
    void (async () => {
      const n = await fetchActiveResidentCountForBillingScope(selectedFacilityId);
      setCohortCount(n);
    })();
  }, [selectedFacilityId]);

  useEffect(() => {
    if (urlStatusAppliedRef.current) return;
    const st = searchParams.get("status");
    if (st === "overdue") {
      setStatus("overdue");
      urlStatusAppliedRef.current = true;
    }
  }, [searchParams]);

  const loadBilling = useCallback(async () => {
    if (!skippedInitialLoadRef.current) {
      skippedInitialLoadRef.current = true;

      if (initialLoadSucceeded) {
        loadedFacilityIdRef.current = initialFacilityId ?? null;
        hasLoadedFacilityScopeRef.current = true;
        setIsLoading(false);
        return;
      }
    }

    if (hasLoadedFacilityScopeRef.current && selectedFacilityId === loadedFacilityIdRef.current) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchInvoicesFromSupabase(selectedFacilityId, residentIdFilter);
      setRows(liveRows);
      loadedFacilityIdRef.current = selectedFacilityId;
      hasLoadedFacilityScopeRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, residentIdFilter, initialLoadSucceeded, initialFacilityId]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const filteredRows = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        row.invoiceNumber.toLowerCase().includes(loweredSearch) ||
        row.residentName.toLowerCase().includes(loweredSearch);
      const matchesStatus = status === "all" || row.status === status;
      const matchesPayerType = payerType === "all" || row.payerType === payerType;
      return matchesSearch && matchesStatus && matchesPayerType;
    });
  }, [rows, search, status, payerType]);

  const listEmptyCopy = useMemo(() => {
    if (residentIdFilter) {
      return adminListFilteredEmptyCopy({
        datasetRowCount: rows.length,
        whenDatasetEmpty: {
          title: "No invoices for this resident",
          description:
            "There are no invoices linked to this resident in the current scope. They will appear here once billing generates statements.",
        },
        whenFiltersExcludeAll: {
          title: "No invoices match the current filters",
          description: "Adjust status or payer filters to widen the ledger view.",
        },
      });
    }
    return adminListFilteredEmptyCopy({
      datasetRowCount: rows.length,
      whenDatasetEmpty: {
        title: "No invoices in this scope",
        description:
          "Live billing returned no invoices for the selected facility or organization filter. Generate invoices or adjust scope.",
      },
      whenFiltersExcludeAll: {
        title: "No invoices match the current filters",
        description:
          "Adjust status or payer filters. Live ledger is scoped by your current facility selection.",
      },
    });
  }, [rows.length, residentIdFilter]);

  const openArTotalCents = useMemo(() => totalOpenArCents(rows), [rows]);
  const aging = useMemo(() => summarizeOpenArBucketTotals(rows), [rows]);
  const overdueCount = rows.filter((row) => row.status === "overdue").length;

  const isOverviewChrome = layout === "overview" && !residentIdFilter;

  /** Activity sidebar */
  type PayLine = { id: string; payment_date: string; amount: number };
  type RatePeek = { id: string; name: string; effective_date: string };
  const [activityPayments, setActivityPayments] = useState<PayLine[]>([]);
  const [activityRatesSoon, setActivityRatesSoon] = useState<RatePeek[]>([]);
  const [activityRatesRecent, setActivityRatesRecent] = useState<RatePeek[]>([]);

  useEffect(() => {
    if (!isOverviewChrome) return;
    void (async () => {
      const supabase = createClient();
      const today = new Date();
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAhead = new Date(today);
      weekAhead.setDate(weekAhead.getDate() + 7);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      try {
        let pq = supabase
          .from("payments" as never)
          .select("id, payment_date, amount")
          .is("deleted_at", null)
          .eq("refunded", false)
          .gte("payment_date", iso(weekAgo))
          .order("payment_date", { ascending: false })
          .limit(10);
        if (isValidFacilityIdForQuery(selectedFacilityId)) {
          pq = pq.eq("facility_id", selectedFacilityId!);
        }
        const pres = await pq as unknown as { data: PayLine[] | null; error: { message: string } | null };
        if (!pres.error) setActivityPayments(((pres.data ?? []) as PayLine[]) ?? []);

        let rq = supabase
          .from("rate_schedules" as never)
          .select("id, name, effective_date, deleted_at")
          .is("deleted_at", null)
          .order("effective_date", { ascending: false })
          .limit(40);
        if (isValidFacilityIdForQuery(selectedFacilityId)) {
          rq = rq.eq("facility_id", selectedFacilityId!);
        }
        const rres = await rq as unknown as {
          data: RatePeek[] | null;
          error: { message: string } | null;
        };
        if (!rres.error) {
          const list = (rres.data ?? []) as RatePeek[];
          const t = iso(today);
          const w = iso(weekAhead);
          const wa = iso(weekAgo);
          setActivityRatesSoon(list.filter((r) => r.effective_date >= t && r.effective_date <= w).slice(0, 8));
          setActivityRatesRecent(
            list.filter((r) => r.effective_date < t && r.effective_date >= wa).slice(0, 8),
          );
        }
      } catch {
        setActivityPayments([]);
        setActivityRatesSoon([]);
        setActivityRatesRecent([]);
      }
    })();
  }, [isOverviewChrome, selectedFacilityId]);

  return (
    <div className={cn("w-full space-y-6 pb-12", layout === "overview" ? "" : "")}>
      {!isOverviewChrome && title ? (
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        </header>
      ) : null}

      {isOverviewChrome ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-xl text-[13px] text-muted-foreground">
            Operational billing snapshot scoped to your facility selector. Use destination tabs above for ledger,
            aging, revenue, org AR, or rate library.
          </p>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Link
              href="/admin/billing/invoices/generate"
              className={cn(buttonVariants({ size: "sm", variant: "default" }), "h-9")}
            >
              Generate invoices
            </Link>
            <Link href="/admin/billing/payments/new" className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-9")}>
              Record payment
            </Link>
            <Link href="/admin/billing/collections" className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-9")}>
              Run collections
            </Link>
          </div>
        </div>
      ) : null}

      {isOverviewChrome ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricTile
            href="/admin/billing/ar-aging"
            label="Outstanding AR"
            value={billingCurrency.format(openArTotalCents / 100)}
            valueClassName={outstandingArValueClass({
              outstandingCents: openArTotalCents,
              cohortResidentCount: cohortCount,
              ninetyPlusCents: aging.d91Plus,
            })}
          />

          <MetricTile
            href="/admin/billing/ar-aging?bucket=current"
            label="Current (0–30 d)"
            value={billingCurrency.format(aging.current030 / 100)}
            valueClassName={standardBucketValueClass(aging.current030)}
          />
          <MetricTile
            href="/admin/billing/ar-aging?bucket=31-60"
            label="31–60 day AR"
            value={billingCurrency.format(aging.d3160 / 100)}
            valueClassName={standardBucketValueClass(aging.d3160)}
          />
          <MetricTile
            href="/admin/billing/ar-aging?bucket=61-90"
            label="61–90 day AR"
            value={billingCurrency.format(aging.d6190 / 100)}
            valueClassName={standardBucketValueClass(aging.d6190)}
          />
          <MetricTile
            href="/admin/billing/ar-aging?bucket=91-plus"
            label="90+ day AR"
            value={billingCurrency.format(aging.d91Plus / 100)}
            valueClassName={ninetyPlusBucketValueClass(openArTotalCents, aging.d91Plus)}
          />
          <MetricTile
            href="/admin/billing/invoices?status=overdue"
            label="Overdue invoices"
            value={String(overdueCount)}
            valueClassName={overdueInvoicesValueClass(overdueCount)}
          />
        </div>
      ) : null}

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search invoice # or resident..."
        onSearchChange={setSearch}
        suppressResetUnlessDirty
        filters={[
          {
            id: "invoice-status-filter",
            ariaLabel: "Invoice status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
              { value: "partial", label: "Partial" },
              { value: "paid", label: "Paid" },
              { value: "overdue", label: "Overdue" },
              { value: "void", label: "Void" },
              { value: "written_off", label: "Written off" },
            ],
          },
          {
            id: "payer-type-filter",
            ariaLabel: "Payer type",
            value: payerType,
            onChange: setPayerType,
            options: [
              { value: "all", label: "All payer types" },
              { value: "private_pay", label: "Private pay" },
              { value: "medicaid", label: "Medicaid" },
              { value: "ltc_insurance", label: "LTC insurance" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setStatus(DEFAULT_FILTERS.status);
          setPayerType(DEFAULT_FILTERS.payerType);
        }}
      />

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadBilling()} /> : null}

      <div
        className={cn(
          "grid gap-6",
          isOverviewChrome ? "lg:grid-cols-5 lg:items-start" : "",
        )}
      >
        <div className={cn(isOverviewChrome ? "min-w-0 lg:col-span-3" : "min-w-0")}>
          <AdminOperationalListPanel
            toolbar={
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-foreground">{cardTitle}</p>
                {cardDescription ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{cardDescription}</p>
                ) : null}
              </div>
            }
          >
            <Table className="min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Invoice #
                  </TableHead>
                  <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Resident
                  </TableHead>
                  <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Payer
                  </TableHead>
                  <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Amount
                  </TableHead>
                  <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Status
                  </TableHead>
                  <TableHead className="text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Due date
                  </TableHead>
                  <TableHead className="text-right text-[12px] font-medium normal-case tracking-normal text-muted-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="py-8 text-[13px] text-muted-foreground">
                      Loading invoices…
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filteredRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium tabular-nums text-foreground">
                          {row.invoiceNumber}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate text-[13px] text-foreground">
                          {row.residentName}
                        </TableCell>
                        <TableCell>
                          <PayerTypeBadge payerType={row.payerType} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[13px] text-foreground">
                          {billingCurrency.format(row.amountDueCents / 100)}
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{row.dueDate}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/admin/billing/invoices/${row.id}`}
                            className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                          >
                            Open
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredRows.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="align-top py-8">
                          <p className="text-[13px] font-medium text-foreground">{listEmptyCopy.title}</p>
                          <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-muted-foreground">
                            {listEmptyCopy.description}
                          </p>
                          {isOverviewChrome && rows.length === 0 ? (
                            <Link
                              href="/admin/billing/invoices/generate"
                              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-4 inline-flex h-8")}
                            >
                              Generate invoices
                            </Link>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </>
                )}
              </TableBody>
            </Table>
          </AdminOperationalListPanel>
        </div>

        {isOverviewChrome ? (
          <aside className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-[14px] shadow-[var(--shadow-card)] ring-1 ring-border/60">
              <h2 className="text-[14px] font-semibold text-foreground">Activity this week</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Recent cash application, rate effective dates, and upcoming schedule notes.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Payments applied</p>
                  {activityPayments.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">No payments in the last 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {activityPayments.map((p) => (
                        <li key={p.id} className="text-[13px] text-foreground">
                          <span className="tabular-nums font-medium">{billingCurrency.format(p.amount / 100)}</span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-muted-foreground">{p.payment_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Rate changes (effective)</p>
                  {activityRatesRecent.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">No rate schedule starts in the last 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {activityRatesRecent.map((r) => (
                        <li key={r.id} className="text-[13px]">
                          <Link href="/admin/billing/rates" className="text-primary hover:underline">
                            {r.name}
                          </Link>
                          <span className="text-muted-foreground"> · effective {r.effective_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Upcoming rate effective dates</p>
                  {activityRatesSoon.length === 0 ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">None in the next 7 days.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {activityRatesSoon.map((r) => (
                        <li key={r.id} className="text-[13px] text-foreground">
                          {r.name}
                          <span className="text-muted-foreground"> · {r.effective_date}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-[12px] font-medium text-muted-foreground">Scheduled auto-generated invoices</p>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    Cron-driven generation will surface here when scheduled runs are wired to Supabase metadata.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export function BillingInvoiceLedger(props: BillingInvoiceLedgerProps) {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-border bg-card p-6 text-[13px] text-muted-foreground shadow-[var(--shadow-card)] ring-1 ring-border/60">
          Loading billing ledger…
        </div>
      }
    >
      <BillingInvoiceLedgerInner {...props} />
    </Suspense>
  );
}

export function PayerTypeBadge({ payerType }: { payerType: PayerTypeUi }) {
  const map: Record<PayerTypeUi, { label: string; className: string }> = {
    private_pay: {
      label: "Private pay",
      className: "border-0 bg-muted/80 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    medicaid: {
      label: "Medicaid",
      className: "border-0 bg-blue-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    ltc_insurance: {
      label: "LTC insurance",
      className: "border-0 bg-primary/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
  };
  return <Badge className={map[payerType].className}>{map[payerType].label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusUi }) {
  const map: Record<InvoiceStatusUi, { label: string; className: string }> = {
    draft: {
      label: "Draft",
      className: "border-0 bg-muted/80 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    sent: {
      label: "Sent",
      className: "border-0 bg-blue-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    partial: {
      label: "Partial",
      className: "border-0 bg-amber-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    paid: {
      label: "Paid",
      className: "border-0 bg-emerald-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    overdue: {
      label: "Overdue",
      className: "border-0 bg-destructive/15 text-destructive text-[11px] font-medium normal-case tracking-normal",
    },
    void: {
      label: "Void",
      className: "border-0 bg-muted text-muted-foreground text-[11px] font-medium normal-case tracking-normal",
    },
    written_off: {
      label: "Written off",
      className: "border-0 bg-orange-500/15 text-foreground text-[11px] font-medium normal-case tracking-normal",
    },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
