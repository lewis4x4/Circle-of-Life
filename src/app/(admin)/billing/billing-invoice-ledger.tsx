"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";

export type InvoiceStatusUi = "draft" | "sent" | "partial" | "paid" | "overdue" | "void" | "written_off";
export type PayerTypeUi = "private_pay" | "medicaid" | "ltc_insurance";

export type BillingRow = {
  id: string;
  invoiceNumber: string;
  residentName: string;
  payerType: PayerTypeUi;
  status: InvoiceStatusUi;
  amountDueCents: number;
  dueDate: string;
  updatedAt: string;
};

const DEFAULT_FILTERS = {
  search: "",
  status: "all",
  payerType: "all",
};

export const billingCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

type SupabaseInvoiceRow = {
  id: string;
  resident_id: string;
  invoice_number: string;
  status: string;
  balance_due: number;
  due_date: string;
  updated_at: string;
  payer_type: string | null;
  deleted_at: string | null;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export type BillingInvoiceLedgerProps = {
  title?: string;
  description?: string;
  cardTitle?: string;
  cardDescription?: string;
  /** When set, restricts the ledger to one resident (e.g. resident billing tab). */
  residentIdFilter?: string | null;
};

export function BillingInvoiceLedger({
  title = "Billing Core",
  cardTitle = "Invoice Ledger",
  cardDescription = "Open invoices and balances from the billing schema (RLS-scoped).",
  residentIdFilter = null,
}: BillingInvoiceLedgerProps) {
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [payerType, setPayerType] = useState(DEFAULT_FILTERS.payerType);

  const loadBilling = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const liveRows = await fetchInvoicesFromSupabase(selectedFacilityId, residentIdFilter);
      setRows(liveRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId, residentIdFilter]);

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
      <AmbientMatrix hasCriticals={overdueCount > 0} />
      
      <div className="relative z-10 space-y-6">
        <header className="mb-8">
          <div>
            <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500 mb-2">SYS: Module 05 / Accounts Receivable</p>
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-3">
              {title} {overdueCount > 0 && <PulseDot />}
            </h2>
          </div>
        </header>

        <KineticGrid className="grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6" staggerMs={75}>
          <div className="col-span-1 md:col-span-2 h-[160px]">
            <V2Card hoverColor="emerald" className="border-emerald-500/20 dark:border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.05)]">
              <Sparkline colorClass="text-emerald-500" variant={1} />
              <MonolithicWatermark value={Math.round((outstandingCents / 100) / 1000) + 'k'} className="text-emerald-600/5 dark:text-emerald-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <CreditCard className="h-3.5 w-3.5" /> Total Outstanding AR
                </h3>
                <p className="text-4xl lg:text-5xl font-mono tracking-tighter tabular-nums text-emerald-600 dark:text-emerald-400 pb-1 flex flex-col">
                  {billingCurrency.format(outstandingCents / 100)}
                </p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="rose" className="border-rose-500/20 dark:border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.05)]">
              <Sparkline colorClass="text-rose-500" variant={4} />
              <MonolithicWatermark value={overdueCount} className="text-rose-600/5 dark:text-rose-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                   Overdue Invoices
                </h3>
                <p className="text-4xl font-mono tracking-tighter text-rose-600 dark:text-rose-400 pb-1">{overdueCount}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="indigo" className="flex flex-col justify-center items-start">
              <div className="relative z-10 w-full text-left">
                 <p className="hidden lg:block text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-4">Batch Actions</p>
                 <Link href="/admin/billing/invoices/generate" className={cn(buttonVariants({ variant: "default", size: "default" }), "font-mono uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 border-none w-full")} >
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
          <div className="relative z-10 p-4 sm:p-6 mb-4 glass-panel rounded-3xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 backdrop-blur-2xl shadow-2xl">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">{cardTitle}</h3>
            <p className="text-sm font-mono tracking-wide text-slate-500 dark:text-slate-400">{cardDescription}</p>
          </div>
          <MotionList className="space-y-3">
             {filteredRows.map((row) => (
                <MotionItem key={row.id}>
                  <Link href={`/admin/billing/invoices/${row.id}`} className="block focus-visible:outline-none focus:ring-2 focus:ring-indigo-500 rounded-2xl">
                     <div className="p-4 sm:p-5 rounded-2xl glass-panel group transition-all duration-300 hover:scale-[1.01] hover:border-indigo-500/30 hover:bg-white/70 dark:hover:bg-indigo-900/10 cursor-pointer border border-white/20 dark:border-white/5 bg-white/40 dark:bg-slate-900/40 w-full flex flex-col md:flex-row lg:items-center justify-between gap-4">
                        
                        <div className="flex flex-col min-w-[200px] gap-1 shrink-0">
                           <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Invoice #</span>
                           <span className="font-bold font-mono text-slate-900 dark:text-slate-100 uppercase tracking-widest text-xs">
                              {row.invoiceNumber}
                           </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 w-full items-center">
                           <div className="flex flex-col gap-1.5 lg:col-span-2">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Resident</span>
                              <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">{row.residentName}</span>
                           </div>
                           <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Payer Type</span>
                              <div className="flex"><PayerTypeBadge payerType={row.payerType} /></div>
                           </div>
                           <div className="flex flex-col gap-1.5">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Status</span>
                              <div className="flex"><InvoiceStatusBadge status={row.status} /></div>
                           </div>
                           <div className="flex flex-col gap-1.5 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Amount Due</span>
                              <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">{billingCurrency.format(row.amountDueCents / 100)}</span>
                           </div>
                           <div className="flex flex-col gap-1.5 align-right text-left md:text-right">
                              <span className="text-[9px] uppercase font-mono tracking-widest text-slate-400">Due / Updated</span>
                              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">{row.dueDate}</span>
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

async function fetchInvoicesFromSupabase(
  selectedFacilityId: string | null,
  residentIdFilter?: string | null,
): Promise<BillingRow[]> {
  const supabase = createClient();
  let invQuery = supabase
    .from("invoices" as never)
    .select(
      "id, resident_id, invoice_number, status, balance_due, due_date, updated_at, payer_type, deleted_at",
    )
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })
    .limit(200);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    invQuery = invQuery.eq("facility_id", selectedFacilityId);
  }
  if (residentIdFilter && UUID_STRING_RE.test(residentIdFilter)) {
    invQuery = invQuery.eq("resident_id", residentIdFilter);
  }

  const invResult = (await invQuery) as unknown as QueryResult<SupabaseInvoiceRow>;
  const invoices = invResult.data ?? [];
  if (invResult.error) {
    throw invResult.error;
  }
  if (invoices.length === 0) {
    return [];
  }

  const residentIds = Array.from(new Set(invoices.map((i) => i.resident_id)));
  const resResult = (await supabase
    .from("residents" as never)
    .select("id, first_name, last_name")
    .in("id", residentIds)) as unknown as QueryResult<SupabaseResidentMini>;
  if (resResult.error) {
    throw resResult.error;
  }
  const residentById = new Map((resResult.data ?? []).map((r) => [r.id, r] as const));

  return invoices.map((inv) => {
    const res = residentById.get(inv.resident_id);
    const fn = res?.first_name?.trim() ?? "";
    const ln = res?.last_name?.trim() ?? "";
    const residentName = `${fn} ${ln}`.trim() || "Resident";
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      residentName,
      payerType: mapDbPayerTypeToUi(inv.payer_type),
      status: mapDbInvoiceStatusToUi(inv.status),
      amountDueCents: Math.max(0, inv.balance_due),
      dueDate: formatDueDisplay(inv.due_date, inv.status),
      updatedAt: formatUpdatedAt(inv.updated_at),
    };
  });
}

export function mapDbPayerTypeToUi(value: string | null): PayerTypeUi {
  if (value === "medicaid_oss") return "medicaid";
  if (value === "ltc_insurance" || value === "va_aid_attendance") return "ltc_insurance";
  if (value === "private_pay") return "private_pay";
  return "private_pay";
}

export function mapDbInvoiceStatusToUi(value: string): InvoiceStatusUi {
  if (
    value === "draft" ||
    value === "sent" ||
    value === "paid" ||
    value === "partial" ||
    value === "overdue" ||
    value === "void" ||
    value === "written_off"
  ) {
    return value;
  }
  return "draft";
}

function formatDueDisplay(dueDate: string, status: string): string {
  if (status === "paid") return "Paid";
  const parsed = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatUpdatedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
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
