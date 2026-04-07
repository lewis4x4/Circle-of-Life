"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronRight, CreditCard } from "lucide-react";

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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <div className="relative overflow-hidden rounded-2xl border border-white/10 dark:border-white/5 bg-white/40 dark:bg-[#0A0A0A]/50 backdrop-blur-2xl shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-white/10 dark:from-white/5 dark:to-transparent pointer-events-none" />
          <div className="relative z-10 border-b border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 p-6 flex flex-col gap-1">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">{cardTitle}</h3>
            <p className="text-sm font-mono text-slate-500 dark:text-slate-400">{cardDescription}</p>
          </div>
          <div className="relative z-10 overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/40 dark:bg-black/40 border-b border-white/20 dark:border-white/10">
                <TableRow className="border-none hover:bg-transparent">
                  <TableHead className="pl-4 font-medium">Invoice #</TableHead>
                  <TableHead className="font-medium">Resident</TableHead>
                  <TableHead className="font-medium">Payer Type</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium">Amount Due</TableHead>
                  <TableHead className="font-medium">Due Date</TableHead>
                  <TableHead className="font-medium">
                    <span className="inline-flex items-center gap-1">
                      Updated
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </TableHead>
                  <TableHead className="w-10 pr-4 text-right font-medium"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800 hover:bg-emerald-500/5 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer group">
                    <TableCell className="pl-4 font-medium text-slate-900 dark:text-slate-100">
                      {row.invoiceNumber}
                    </TableCell>
                    <TableCell>{row.residentName}</TableCell>
                    <TableCell>
                      <PayerTypeBadge payerType={row.payerType} />
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>{billingCurrency.format(row.amountDueCents / 100)}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{row.dueDate}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{row.updatedAt}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link
                        href={`/admin/billing/invoices/${row.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                        aria-label={`Open invoice ${row.invoiceNumber}`}
                      >
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
    private_pay: { label: "Private Pay", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    medicaid: { label: "Medicaid", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    ltc_insurance: {
      label: "LTC Insurance",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    },
  };
  return <Badge className={map[payerType].className}>{map[payerType].label}</Badge>;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusUi }) {
  const map: Record<InvoiceStatusUi, { label: string; className: string }> = {
    draft: { label: "Draft", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    sent: { label: "Sent", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    partial: { label: "Partial", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    paid: { label: "Paid", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    overdue: { label: "Overdue", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
    void: { label: "Void", className: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200" },
    written_off: { label: "Written Off", className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200" },
  };
  return <Badge className={map[status].className}>{map[status].label}</Badge>;
}
