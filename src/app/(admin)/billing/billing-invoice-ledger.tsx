"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, CreditCard } from "lucide-react";

import {
  AdminEmptyState,
  AdminFilterBar,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { adminListFilteredEmptyCopy } from "@/lib/admin-list-empty-copy";
import {
  fetchInvoicesFromSupabase,
  type BillingRow,
  type InvoiceStatusUi,
  type PayerTypeUi,
} from "@/lib/billing/load-invoices";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
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
  description?: string;
  cardTitle?: string;
  cardDescription?: string;
  /** When set, restricts the ledger to one resident (e.g. resident billing tab). */
  residentIdFilter?: string | null;
  initialRows?: BillingRow[];
  initialError?: string | null;
  initialFacilityId?: string | null;
};

export function BillingInvoiceLedger({
  title = "Billing Core",
  cardTitle = "Invoice Ledger",
  cardDescription = "Open invoices and balances from the billing schema (RLS-scoped).",
  residentIdFilter = null,
  initialRows,
  initialError,
  initialFacilityId,
}: BillingInvoiceLedgerProps) {
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

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [payerType, setPayerType] = useState(DEFAULT_FILTERS.payerType);

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

  const outstandingCents = rows
    .filter((row) => row.status !== "paid" && row.status !== "written_off" && row.status !== "void")
    .reduce((acc, row) => acc + row.amountDueCents, 0);
  const overdueCount = rows.filter((row) => row.status === "overdue").length;

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <></>
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              {title} {overdueCount > 0 && <></>}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
              <></>
              <MonolithicWatermark value={Math.round((outstandingCents / 100) / 1000) + 'k'} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <CreditCard className="h-3.5 w-3.5" /> Total Outstanding AR
                </h3>
                <p className="text-4xl lg:text-2xl font-mono tracking-tighter tabular-nums text-emerald-600 dark:text-emerald-400 pb-1 flex flex-col">
                  {billingCurrency.format(outstandingCents / 100)}
                </p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="rose" className="border-rose-500/20 dark:border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]">
              <></>
              <MonolithicWatermark value={overdueCount} className="text-rose-600/5 dark:text-rose-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-wider uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                   Overdue Invoices
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-rose-600 dark:text-rose-400 pb-1">{overdueCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[180px]">
            <V2Card hoverColor="indigo" className="p-5 lg:p-6">
              <div className="relative z-10 flex h-full w-full flex-col justify-center gap-4 text-left">
                 <p className="hidden text-[10px] font-mono uppercase tracking-wider text-slate-500 lg:block">Batch Actions</p>
                 <Link href="/admin/billing/invoices/generate" className={cn(buttonVariants({ variant: "default", size: "default" }), "font-mono uppercase tracking-wider text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none w-full whitespace-nowrap")} >
                   Generate Cycle
                 </Link>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      <AdminFilterBar
        searchValue={search}
        searchPlaceholder="Search invoice # or resident..."
        onSearchChange={setSearch}
        filters={[
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "all", label: "All Statuses" },
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
              { value: "partial", label: "Partial" },
              { value: "paid", label: "Paid" },
              { value: "overdue", label: "Overdue" },
              { value: "void", label: "Void" },
              { value: "written_off", label: "Written Off" },
            ],
          },
          {
            id: "payerType",
            value: payerType,
            onChange: setPayerType,
            options: [
              { value: "all", label: "All Payer Types" },
              { value: "private_pay", label: "Private Pay" },
              { value: "medicaid", label: "Medicaid" },
              { value: "ltc_insurance", label: "LTC Insurance" },
            ],
          },
        ]}
        onReset={() => {
          setSearch(DEFAULT_FILTERS.search);
          setStatus(DEFAULT_FILTERS.status);
          setPayerType(DEFAULT_FILTERS.payerType);
        }}
      />

      {isLoading ? <AdminTableLoadingState /> : null}
      {!isLoading && error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={() => void loadBilling()} />
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState title={listEmptyCopy.title} description={listEmptyCopy.description} />
      ) : null}

      {!isLoading && filteredRows.length > 0 ? (
        <div className="relative overflow-visible z-10 w-full mt-4">
          <div className="relative z-10 p-4 sm:p-6 mb-4 rounded-lg border border-white/20 dark:border-white/5 bg-card shadow-2xl">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-1">{cardTitle}</h3>
            <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">{cardDescription}</p>
          </div>
          <MotionList className="space-y-3">
             {filteredRows.map((row) => (
                <MotionItem key={row.id}>
                  <Link href={`/admin/billing/invoices/${row.id}`} className="block focus-visible:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl">
                     <div className="p-4 sm:p-5 rounded-2xl group transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/20 dark:border-white/5 bg-card dark:bg-slate-900/40 w-full flex flex-col md:flex-row lg:items-center justify-between gap-4">
                        
                        <div className="flex flex-col min-w-[200px] gap-1 shrink-0">
                           <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Invoice #</span>
                           <span className="font-bold font-mono text-slate-900 dark:text-slate-100 uppercase tracking-wider text-xs">
                              {row.invoiceNumber}
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 w-full items-center">
                           <div className="flex flex-col gap-1.5 lg:col-span-2">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Resident</span>
                              <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">{row.residentName}</span>
                           </div>
                           <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Payer Type</span>
                              <div className="flex"><PayerTypeBadge payerType={row.payerType} /></div>
                           </div>
                           <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Status</span>
                              <div className="flex"><InvoiceStatusBadge status={row.status} /></div>
                           </div>
                           <div className="flex flex-col gap-1.5 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Amount Due</span>
                              <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">{billingCurrency.format(row.amountDueCents / 100)}</span>
                           </div>
                           <div className="flex flex-col gap-1.5 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-wider text-slate-400">Due / Updated</span>
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">{row.dueDate}</span>
                           </div>
                        </div>

                        <div className="hidden sm:flex shrink-0 ml-4">
                            <div className="w-8 h-8 rounded-full bg-white/50 dark:bg-white/5 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/50 transition-colors">
                            <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
                            </div>
                        </div>

                     </div>
                  </Link>
                </MotionItem>
             ))}
          </MotionList>
        </div>
      ) : null}
      </div>
    </div>
  );
}


export function PayerTypeBadge({ payerType }: { payerType: PayerTypeUi }) {
  const map: Record<PayerTypeUi, { label: string; className: string }> = {
    private_pay: { label: "Private Pay", className: "bg-slate-500/20 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    medicaid: { label: "Medicaid", className: "bg-blue-500/20 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    ltc_insurance: { label: "LTC Insurance", className: "bg-violet-500/20 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
  };
  return <Badge className={map[payerType].className}>{map[payerType].label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusUi }) {
  const map: Record<InvoiceStatusUi, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-slate-500/20 text-slate-800 dark:bg-slate-800/50 dark:text-slate-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    sent: { label: "Sent", className: "bg-blue-500/20 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    partial: { label: "Partial", className: "bg-amber-500/20 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    paid: { label: "Paid", className: "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    overdue: { label: "Overdue", className: "bg-rose-500/20 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    void: { label: "Void", className: "bg-zinc-500/20 text-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-200 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
    written_off: { label: "Written Off", className: "bg-orange-500/20 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200 uppercase tracking-widest font-mono text-[9px] font-bold border-0 shadow-sm px-2" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
