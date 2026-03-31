"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronRight, CreditCard, Receipt } from "lucide-react";

import { AdminEmptyState, AdminFilterBar, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "void" | "written_off";
type PayerType = "private_pay" | "medicaid" | "ltc_insurance";

type BillingRow = {
  id: string;
  invoiceNumber: string;
  residentName: string;
  payerType: PayerType;
  status: InvoiceStatus;
  amountDueCents: number;
  dueDate: string;
  updatedAt: string;
};

const DEFAULT_FILTERS = {
  search: "",
  status: "all",
  payerType: "all",
};

const currency = new Intl.NumberFormat("en-US", {
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

export default function AdminBillingPage() {
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
      const liveRows = await fetchInvoicesFromSupabase(selectedFacilityId);
      setRows(liveRows.length > 0 ? liveRows : mockInvoices);
    } catch {
      setRows(mockInvoices);
      setError("Live billing data is unavailable. Showing demo ledger data.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

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

  const outstandingCents = rows
    .filter((row) => row.status !== "paid" && row.status !== "written_off" && row.status !== "void")
    .reduce((acc, row) => acc + row.amountDueCents, 0);
  const overdueCount = rows.filter((row) => row.status === "overdue").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Billing Core
          </h2>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            Invoice queue, payer visibility, and AR signal layer for Phase 1 billing operations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-slate-200 bg-white px-3 py-1 dark:border-slate-800 dark:bg-slate-900"
          >
            <CreditCard className="mr-1 h-3.5 w-3.5" />
            {currency.format(outstandingCents / 100)} outstanding
          </Badge>
          <Badge
            variant="outline"
            className="border-red-200 bg-red-50 px-3 py-1 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
          >
            <Receipt className="mr-1 h-3.5 w-3.5" />
            {overdueCount} overdue
          </Badge>
        </div>
      </header>

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
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm text-amber-700 dark:text-amber-300">{error}</CardContent>
        </Card>
      ) : null}
      {!isLoading && filteredRows.length === 0 ? (
        <AdminEmptyState
          title="No invoices match the current filters"
          description="Adjust status or payer filters. Live ledger is scoped by your current facility selection."
        />
      ) : null}

      {!isLoading && filteredRows.length > 0 ? (
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30">
            <CardTitle className="text-lg font-display">Invoice Ledger</CardTitle>
            <CardDescription>Open invoices and balances from the billing schema (RLS-scoped).</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/70 dark:bg-slate-900/60">
                <TableRow className="border-slate-100 hover:bg-transparent dark:border-slate-800">
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
                  <TableRow key={row.id} className="border-slate-100 dark:border-slate-800">
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
                    <TableCell>{currency.format(row.amountDueCents / 100)}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{row.dueDate}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">{row.updatedAt}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="icon-sm" aria-label={`Open invoice ${row.invoiceNumber}`}>
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

async function fetchInvoicesFromSupabase(selectedFacilityId: string | null): Promise<BillingRow[]> {
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

function mapDbPayerTypeToUi(value: string | null): PayerType {
  if (value === "medicaid_oss") return "medicaid";
  if (value === "ltc_insurance" || value === "va_aid_attendance") return "ltc_insurance";
  if (value === "private_pay") return "private_pay";
  return "private_pay";
}

function mapDbInvoiceStatusToUi(value: string): InvoiceStatus {
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

function PayerTypeBadge({ payerType }: { payerType: PayerType }) {
  const map: Record<PayerType, { label: string; className: string }> = {
    private_pay: { label: "Private Pay", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    medicaid: { label: "Medicaid", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
    ltc_insurance: {
      label: "LTC Insurance",
      className: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    },
  };
  return <Badge className={map[payerType].className}>{map[payerType].label}</Badge>;
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const map: Record<InvoiceStatus, { label: string; className: string }> = {
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

const mockInvoices: BillingRow[] = [
  {
    id: "inv-001",
    invoiceNumber: "INV-2026-03-145",
    residentName: "Margaret Sullivan",
    payerType: "private_pay",
    status: "sent",
    amountDueCents: 754250,
    dueDate: "Apr 5, 2026",
    updatedAt: "12 min ago",
  },
  {
    id: "inv-002",
    invoiceNumber: "INV-2026-03-142",
    residentName: "Arthur Pendelton",
    payerType: "medicaid",
    status: "paid",
    amountDueCents: 0,
    dueDate: "Paid",
    updatedAt: "1 hr ago",
  },
  {
    id: "inv-003",
    invoiceNumber: "INV-2026-03-140",
    residentName: "Lucille Booth",
    payerType: "ltc_insurance",
    status: "partial",
    amountDueCents: 215300,
    dueDate: "Apr 2, 2026",
    updatedAt: "Today, 08:10",
  },
  {
    id: "inv-004",
    invoiceNumber: "INV-2026-02-098",
    residentName: "William Hastings",
    payerType: "private_pay",
    status: "overdue",
    amountDueCents: 198750,
    dueDate: "Mar 10, 2026",
    updatedAt: "Yesterday",
  },
];
