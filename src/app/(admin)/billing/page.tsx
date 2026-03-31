"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ChevronRight, CreditCard, Receipt } from "lucide-react";

import {
  AdminEmptyState,
  AdminErrorState,
  AdminFilterBar,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue";
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

export default function AdminBillingPage() {
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(DEFAULT_FILTERS.search);
  const [status, setStatus] = useState(DEFAULT_FILTERS.status);
  const [payerType, setPayerType] = useState(DEFAULT_FILTERS.payerType);

  const loadBilling = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      setRows(mockInvoices);
    } catch {
      setError("Billing feed is currently unavailable. Please retry.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBilling();
  }, []);

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
    .filter((row) => row.status !== "paid")
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
        <AdminErrorState title="Could not load billing records" message={error} onRetry={loadBilling} />
      ) : null}
      {!isLoading && !error && filteredRows.length === 0 ? (
        <AdminEmptyState
          title="No invoices match the current filters"
          description="Adjust status or payer filters to restore ledger results."
        />
      ) : null}

      {!isLoading && !error && filteredRows.length > 0 ? (
        <Card className="overflow-hidden border-slate-200/70 bg-white shadow-soft dark:border-slate-800 dark:bg-slate-950">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/30">
            <CardTitle className="text-lg font-display">Invoice Ledger</CardTitle>
            <CardDescription>Scaffolded billing queue for invoices, payments, and collections modules.</CardDescription>
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
