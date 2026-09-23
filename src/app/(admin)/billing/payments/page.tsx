"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatInvoiceRowNumberForDisplay } from "@/lib/billing/invoices-display-copy";
import { paymentMethodLabel, paymentsEmptyCopy, summarizePayments } from "@/lib/billing/payments-list";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

import { BillingHubNav } from "../billing-hub-nav";
import { billingCurrency } from "../billing-invoice-ledger";

const PAGE_LIMIT = 500;

type PaymentDbRow = {
  id: string;
  resident_id: string;
  facility_id: string;
  invoice_id: string | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  reference_number: string | null;
  payer_name: string | null;
  deposited: boolean;
  refunded: boolean;
  refund_amount: number | null;
};

type InvoiceMini = { id: string; invoice_number: string; invoice_date: string };
type ResidentMini = { id: string; first_name: string | null; last_name: string | null };
type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function AdminBillingPaymentsIndexPage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const [rows, setRows] = useState<PaymentDbRow[]>([]);
  const [residentNames, setResidentNames] = useState<Record<string, string>>({});
  const [invoiceLabels, setInvoiceLabels] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopeLabel = useMemo(() => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) return "all facilities";
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? "this facility";
  }, [availableFacilities, selectedFacilityId]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let q = supabase
        .from("payments" as never)
        .select(
          "id, resident_id, facility_id, invoice_id, payment_date, amount, payment_method, reference_number, payer_name, deposited, refunded, refund_amount",
        )
        .is("deleted_at", null)
        .order("payment_date", { ascending: false })
        .limit(PAGE_LIMIT);
      if (isValidFacilityIdForQuery(selectedFacilityId)) q = q.eq("facility_id", selectedFacilityId);
      const res = (await q) as unknown as QueryListResult<PaymentDbRow>;
      if (res.error) throw res.error;
      const payments = res.data ?? [];

      const residentIds = [...new Set(payments.map((p) => p.resident_id))];
      const invoiceIds = [...new Set(payments.map((p) => p.invoice_id).filter((v): v is string => Boolean(v)))];
      const [resRes, invRes] = await Promise.all([
        residentIds.length > 0
          ? (supabase
              .from("residents" as never)
              .select("id, first_name, last_name")
              .in("id", residentIds) as unknown as Promise<QueryListResult<ResidentMini>>)
          : Promise.resolve({ data: [], error: null } as QueryListResult<ResidentMini>),
        invoiceIds.length > 0
          ? (supabase
              .from("invoices" as never)
              .select("id, invoice_number, invoice_date")
              .in("id", invoiceIds) as unknown as Promise<QueryListResult<InvoiceMini>>)
          : Promise.resolve({ data: [], error: null } as QueryListResult<InvoiceMini>),
      ]);
      if (resRes.error) throw resRes.error;
      if (invRes.error) throw invRes.error;

      const names: Record<string, string> = {};
      for (const r of resRes.data ?? []) {
        names[r.id] = `${r.first_name?.trim() ?? ""} ${r.last_name?.trim() ?? ""}`.trim() || "Resident";
      }
      const labels: Record<string, string> = {};
      for (const inv of invRes.data ?? []) labels[inv.id] = formatInvoiceRowNumberForDisplay(inv);

      setResidentNames(names);
      setInvoiceLabels(labels);
      setRows(payments);
    } catch (err) {
      setRows([]);
      setError(formatLiveDataLoadError(err, "Recorded payments are unavailable right now."));
    } finally {
      setIsLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () =>
      summarizePayments(
        rows.map((r) => ({
          id: r.id,
          paymentDate: r.payment_date,
          amountCents: r.amount,
          refunded: r.refunded,
          refundAmountCents: r.refund_amount,
        })),
      ),
    [rows],
  );
  const empty = paymentsEmptyCopy(scopeLabel);

  return (
    <div className="w-full space-y-6 pb-12">
      <BillingHubNav />

      <div className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">Payments</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Payments recorded in Haven for {scopeLabel}, newest first.
          </p>
        </div>
        <Link href="/admin/billing/payments/new" className={cn(buttonVariants({ size: "sm" }), "h-9")}>
          Record payment
        </Link>
      </div>

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} /> : null}
      {isLoading ? <AdminTableLoadingState /> : null}

      {!isLoading && !error && rows.length === 0 ? (
        <AdminEmptyState title={empty.title} description={empty.description} />
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <>
          <p className="text-[13px] text-muted-foreground" role="status">
            {summary.count} payment{summary.count === 1 ? "" : "s"} · {billingCurrency.format(summary.receivedCents / 100)}{" "}
            received
            {summary.refundedCents > 0 ? ` · ${billingCurrency.format(summary.refundedCents / 100)} refunded` : ""}
            {rows.length === PAGE_LIMIT ? ` · showing the latest ${PAGE_LIMIT}` : ""}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(p.payment_date)}</TableCell>
                    <TableCell>
                      <Link href={`/admin/residents/${p.resident_id}/billing`} className="text-primary underline-offset-4 hover:underline">
                        {residentNames[p.resident_id] ?? "Resident"}
                      </Link>
                      {p.payer_name ? <span className="block text-[12px] text-muted-foreground">Paid by {p.payer_name}</span> : null}
                    </TableCell>
                    <TableCell>
                      {p.invoice_id ? (
                        <Link href={`/admin/billing/invoices/${p.invoice_id}`} className="text-primary underline-offset-4 hover:underline">
                          {invoiceLabels[p.invoice_id] ?? "Invoice"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Not applied to an invoice</span>
                      )}
                    </TableCell>
                    <TableCell>{paymentMethodLabel(p.payment_method)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.reference_number ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{billingCurrency.format(p.amount / 100)}</TableCell>
                    <TableCell className="text-[13px]">
                      {p.refunded ? "Refunded" : p.deposited ? "Deposited" : "Not yet deposited"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}
