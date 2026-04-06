"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { postInvoiceToGl } from "@/lib/finance/post-to-gl";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";

import { BillingHubNav } from "../../billing-hub-nav";
import {
  InvoiceStatusBadge,
  PayerTypeBadge,
  billingCurrency,
  mapDbInvoiceStatusToUi,
  mapDbPayerTypeToUi,
} from "../../billing-invoice-ledger";

type SupabaseInvoice = {
  id: string;
  resident_id: string;
  facility_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  status: string;
  subtotal: number;
  adjustments: number;
  tax: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  payer_type: string | null;
  payer_name: string | null;
  notes: string | null;
  deleted_at: string | null;
};

type SupabaseLine = {
  id: string;
  description: string;
  line_type: string;
  quantity: number | string;
  unit_price: number;
  total: number;
  sort_order: number;
};

type SupabaseResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryListResult<T> = { data: T[] | null; error: QueryError | null };

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function AdminInvoiceDetailPage() {
  const params = useParams();
  const rawId = typeof params?.id === "string" ? params.id : "";
  const id = UUID_STRING_RE.test(rawId) ? rawId : "";
  const { selectedFacilityId } = useFacilityStore();

  const [invoice, setInvoice] = useState<SupabaseInvoice | null>(null);
  const [lines, setLines] = useState<SupabaseLine[]>([]);
  const [residentName, setResidentName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [glPosting, setGlPosting] = useState(false);
  const [glResult, setGlResult] = useState<{ journalEntryId: string; alreadyPosted?: boolean } | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [canPost, setCanPost] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const supabase = createClient();
      const invRes = (await supabase
        .from("invoices" as never)
        .select(
          "id, resident_id, facility_id, invoice_number, invoice_date, due_date, period_start, period_end, status, subtotal, adjustments, tax, total, amount_paid, balance_due, payer_type, payer_name, notes, deleted_at",
        )
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle()) as unknown as QueryResult<SupabaseInvoice>;

      if (invRes.error) throw invRes.error;
      const inv = invRes.data;

      if (!inv) {
        setNotFound(true);
        return;
      }

      if (isValidFacilityIdForQuery(selectedFacilityId) && inv.facility_id !== selectedFacilityId) {
        setNotFound(true);
        return;
      }

      const lineRes = (await supabase
        .from("invoice_line_items" as never)
        .select("id, description, line_type, quantity, unit_price, total, sort_order")
        .eq("invoice_id", id)
        .order("sort_order", { ascending: true })) as unknown as QueryListResult<SupabaseLine>;
      if (lineRes.error) throw lineRes.error;

      const resRes = (await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .eq("id", inv.resident_id)
        .maybeSingle()) as unknown as QueryResult<SupabaseResidentMini>;
      if (resRes.error) throw resRes.error;
      const r = resRes.data;
      const fn = r?.first_name?.trim() ?? "";
      const ln = r?.last_name?.trim() ?? "";
      setResidentName(`${fn} ${ln}`.trim() || "Resident");

      setInvoice(inv);
      setLines(lineRes.data ?? []);

      const finCtx = await loadFinanceRoleContext(supabase);
      if (finCtx.ok && canMutateFinance(finCtx.ctx.appRole)) {
        setCanPost(true);
        const existingJe = await supabase
          .from("journal_entries")
          .select("id")
          .eq("source_type", "invoice")
          .eq("source_id", inv.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (existingJe.data) {
          setGlResult({ journalEntryId: existingJe.data.id, alreadyPosted: true });
        }
      }
    } catch {
      setError("Could not load this invoice.");
      setInvoice(null);
      setLines([]);
    } finally {
      setIsLoading(false);
    }
  }, [id, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!id || notFound) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <Card>
          <CardHeader>
            <CardTitle>Invoice not found</CardTitle>
            <CardDescription>Check the link or your facility selection.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/billing/invoices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Back to invoices
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <AdminTableLoadingState />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <AdminLiveDataFallbackNotice
          message={error ?? "Unknown error."}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  async function postToGl() {
    if (!invoice) return;
    setGlPosting(true);
    setGlError(null);
    try {
      const supabase = createClient();
      const result = await postInvoiceToGl(supabase, invoice.id);
      if (result.ok) {
        setGlResult({ journalEntryId: result.journalEntryId, alreadyPosted: result.alreadyPosted });
      } else {
        setGlError(result.error);
      }
    } finally {
      setGlPosting(false);
    }
  }

  const uiStatus = mapDbInvoiceStatusToUi(invoice.status);
  const uiPayer = mapDbPayerTypeToUi(invoice.payer_type);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/admin/billing/invoices"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex w-fit gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
        <Link
          href={`/admin/residents/${invoice.resident_id}/billing`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Resident billing
        </Link>
      </div>

      <header className="space-y-2">
        <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {invoice.invoice_number}
        </h2>
        <p className="text-slate-500 dark:text-slate-400">
          {residentName} · Period {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <InvoiceStatusBadge status={uiStatus} />
          <PayerTypeBadge payerType={uiPayer} />
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
            <p>
              <span className="font-medium text-slate-800 dark:text-slate-200">Invoice date:</span>{" "}
              {formatDate(invoice.invoice_date)}
            </p>
            <p>
              <span className="font-medium text-slate-800 dark:text-slate-200">Due:</span> {formatDate(invoice.due_date)}
            </p>
            {invoice.payer_name ? (
              <p>
                <span className="font-medium text-slate-800 dark:text-slate-200">Payer on file:</span>{" "}
                {invoice.payer_name}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Subtotal</span>
              <span className="tabular-nums">{billingCurrency.format(invoice.subtotal / 100)}</span>
            </p>
            <p className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Adjustments</span>
              <span className="tabular-nums">{billingCurrency.format(invoice.adjustments / 100)}</span>
            </p>
            <p className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Tax</span>
              <span className="tabular-nums">{billingCurrency.format(invoice.tax / 100)}</span>
            </p>
            <p className="flex justify-between font-medium text-slate-900 dark:text-slate-100">
              <span>Total</span>
              <span className="tabular-nums">{billingCurrency.format(invoice.total / 100)}</span>
            </p>
            <p className="flex justify-between text-slate-600 dark:text-slate-400">
              <span>Amount paid</span>
              <span className="tabular-nums">{billingCurrency.format(invoice.amount_paid / 100)}</span>
            </p>
            <p className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
              <span>Balance due</span>
              <span className="tabular-nums">{billingCurrency.format(Math.max(0, invoice.balance_due) / 100)}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {invoice.notes?.trim() ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 dark:text-slate-400">{invoice.notes.trim()}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Line items</CardTitle>
          <CardDescription>Charges that make up this invoice.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {lines.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500 dark:text-slate-400">No line items returned.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.description}</TableCell>
                    <TableCell className="hidden text-slate-500 sm:table-cell">{line.line_type}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(line.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {billingCurrency.format(line.unit_price / 100)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {billingCurrency.format(line.total / 100)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canPost && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General ledger</CardTitle>
            <CardDescription>Post this invoice to the GL as a balanced journal entry (Debit AR / Credit Revenue).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {glError && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {glError}
              </p>
            )}
            {glResult ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-emerald-700 dark:text-emerald-400">
                  {glResult.alreadyPosted ? "Already posted to GL." : "Posted to GL."}
                </span>
                <Link
                  href={`/admin/finance/journal-entries/${glResult.journalEntryId}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  View journal entry
                </Link>
              </div>
            ) : (
              <Button
                type="button"
                onClick={() => void postToGl()}
                disabled={glPosting || invoice.total <= 0}
              >
                {glPosting ? "Posting…" : "Post to GL"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
