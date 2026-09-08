"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Banknote, Check, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { formatInvoiceRowNumberForDisplay } from "@/lib/billing/invoices-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import { BillingHubNav } from "../../billing-hub-nav";
import { billingCurrency } from "../../billing-invoice-ledger";

const PAYMENT_METHODS = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / EFT" },
  { value: "credit_card", label: "Credit card" },
  { value: "cash", label: "Cash" },
  { value: "medicaid_payment", label: "Medicaid payment" },
  { value: "insurance_payment", label: "Insurance payment" },
  { value: "other", label: "Other" },
] as const;

type ResidentOption = { id: string; name: string };
type InvoiceOption = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  balance_due: number;
  amount_paid: number | null;
  status: string;
  period_start: string;
  period_end: string;
};

type QueryError = { message: string };
class PaymentConfirmationError extends Error {}

type PaymentRequest = {
  p_expected_caller: string; p_request_id: string; p_resident_id: string; p_invoice_id: string | null;
  p_payment_date: string; p_amount_cents: number; p_payment_method: string;
  p_reference_number: string | null; p_payer_name: string | null; p_notes: string | null;
};
type PaymentReceipt = {
  request_id: string; payment_id: string; resident_id: string;
  invoice_id: string | null; amount_cents: number; applied_cents: number;
};

type ResidentRowMini = { id: string; first_name: string | null; last_name: string | null };

/** Billing cohort: residents that can carry an open balance. */
const BILLING_RESIDENT_STATUSES = ["active", "hospital_hold", "loa"] as const;

function toResidentOption(r: ResidentRowMini): ResidentOption {
  return {
    id: r.id,
    name: `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(/^, |, $/, ""),
  };
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export default function AdminNewPaymentPage() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const requestedResidentId = searchParams.get("residentId") ?? "";
  const requestedInvoiceId = searchParams.get("invoiceId") ?? "";
  const requestedAmount = searchParams.get("amount") ?? "";

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const [residentId, setResidentId] = useState(() => requestedResidentId);
  const [invoiceId, setInvoiceId] = useState(() => requestedInvoiceId);
  const [amountDollars, setAmountDollars] = useState(() => requestedAmount);
  const [paymentMethod, setPaymentMethod] = useState("check");
  const [paymentDate, setPaymentDate] = useState(() => todayFacilityDateIso());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [payerName, setPayerName] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const request = useRef<PaymentRequest | null>(null);
  const ambiguous = useRef(false);
  const requestScope = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    setResidentsLoading(true);
    try {
      let q = supabase
        .from("residents" as never)
        .select("id, first_name, last_name, facility_id")
        .is("deleted_at", null)
        .in("status", [...BILLING_RESIDENT_STATUSES])
        .order("last_name", { ascending: true })
        .limit(200);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const { data, error: err } = (await q) as {
        data: ResidentRowMini[] | null;
        error: QueryError | null;
      };

      if (err) throw err;
      const opts = (data ?? []).map(toResidentOption);

      // A deep-linked resident may fall outside the billing cohort or the pinned
      // facility (e.g. discharged with an open invoice). Ensure they are still a
      // selectable option so the prefill isn't silently dropped.
      if (requestedResidentId && !opts.some((o) => o.id === requestedResidentId)) {
        const { data: prefill } = (await supabase
          .from("residents" as never)
          .select("id, first_name, last_name, facility_id")
          .eq("id", requestedResidentId)
          .is("deleted_at", null)
          .maybeSingle()) as { data: ResidentRowMini | null; error: QueryError | null };
        if (prefill) opts.unshift(toResidentOption(prefill));
      }

      setResidents(opts);
    } catch (err) {
      setResidents([]);
      setError(formatLiveDataLoadError(err, "Residents list is unavailable right now."));
    } finally {
      setResidentsLoading(false);
    }
  }, [supabase, selectedFacilityId, requestedResidentId]);

  const loadInvoices = useCallback(
    async (rid: string): Promise<InvoiceOption[]> => {
      if (!rid) {
        setInvoices([]);
        return [];
      }
      setInvoicesLoading(true);
      try {
        const { data, error: err } = (await supabase
          .from("invoices" as never)
          .select(
            "id, invoice_number, invoice_date, balance_due, amount_paid, status, period_start, period_end",
          )
          .eq("resident_id", rid)
          .is("deleted_at", null)
          .in("status", ["draft", "sent", "partial", "overdue"])
          .order("invoice_date", { ascending: false })
          .limit(50)) as {
          data: InvoiceOption[] | null;
          error: QueryError | null;
        };

        if (err) throw err;
        const rows = data ?? [];
        // A valid deep link can be older than the first 50 open invoices.
        // Keep the same resident/status/RLS scope when resolving it directly.
        if (rid === requestedResidentId && requestedInvoiceId && !rows.some((row) => row.id === requestedInvoiceId)) {
          const { data: requested, error: requestedError } = (await supabase
            .from("invoices" as never)
            .select("id, invoice_number, invoice_date, balance_due, amount_paid, status, period_start, period_end")
            .eq("id", requestedInvoiceId)
            .eq("resident_id", rid)
            .is("deleted_at", null)
            .in("status", ["draft", "sent", "partial", "overdue"])
            .maybeSingle()) as { data: InvoiceOption | null; error: QueryError | null };
          if (requestedError) throw requestedError;
          if (requested) rows.unshift(requested);
        }
        setInvoices(rows);
        return rows;
      } catch (err) {
        setInvoices([]);
        setError(formatLiveDataLoadError(err, "Open invoices are unavailable right now."));
        return [];
      } finally {
        setInvoicesLoading(false);
      }
    },
    [supabase, requestedResidentId, requestedInvoiceId],
  );

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  // A requested invoice remains explicit intent even when it is closed or the
  // list cannot load. Only an operator selection may turn it into unapplied.
  useEffect(() => {
    setInvoiceId(residentId === requestedResidentId ? requestedInvoiceId : "");
    if (residentId) void loadInvoices(residentId);
    else setInvoices([]);
  }, [loadInvoices, requestedInvoiceId, requestedResidentId, residentId]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId);
  const amountCents = Math.round(parseFloat(amountDollars || "0") * 100);
  const isValid =
    residentId && Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 2147483647 && /^\d+(?:\.\d{1,2})?$/.test(amountDollars) && paymentMethod && paymentDate;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if ((!request.current && (!isValid || invoicesLoading || (invoiceId && !selectedInvoice))) || submitting) return;

      setSubmitting(true);
      setError(null);

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) throw new PaymentConfirmationError("Sign in to confirm this payment with the original account.");
        const session = sessionData.session;
        // A renewed session for the same caller can recover the receipt.
        // The server rechecks current session authority before any receipt return.
        const scope = JSON.stringify([session.user.id, selectedFacilityId]);
        if (requestScope.current && requestScope.current !== scope) throw new PaymentConfirmationError("Return to the original account and facility before retrying this payment.");
        requestScope.current = scope;
        const args = request.current ?? {
          p_expected_caller: session.user.id, p_request_id: crypto.randomUUID(), p_resident_id: residentId,
          p_invoice_id: invoiceId || null, p_payment_date: paymentDate,
          p_amount_cents: amountCents, p_payment_method: paymentMethod,
          p_reference_number: referenceNumber.trim() || null,
          p_payer_name: payerName.trim() || null, p_notes: notes.trim() || null,
        };
        request.current = args;
        setPending(true);
        const { data, error: commandError } = await supabase.rpc("record_payment" as never, args as never);
        if (commandError) {
          // PostgreSQL exceptions confirm transaction rollback. Transport failures
          // and missing receipts remain ambiguous and must keep their identity.
          if (!ambiguous.current && ["P0001", "42501", "23514", "23503", "22003", "22007", "22P02"].includes(commandError.code)) {
            request.current = null;
            requestScope.current = null;
            setPending(false);
          }
          if (request.current) ambiguous.current = true;
          throw commandError;
        }
        const receipt = data as PaymentReceipt | null;
        if (!receipt?.payment_id || receipt.request_id !== args.p_request_id || receipt.amount_cents !== args.p_amount_cents || receipt.resident_id !== args.p_resident_id || receipt.invoice_id !== args.p_invoice_id || receipt.applied_cents !== (args.p_invoice_id ? args.p_amount_cents : 0)) {
          throw new PaymentConfirmationError("The payment receipt could not be confirmed. Retry this same request.");
        }
        setSuccess(true);
      } catch (err) {
        if (request.current) ambiguous.current = true;
        const rejected = err as { code?: string; message?: string };
        const message = err instanceof PaymentConfirmationError ? err.message : rejected?.code === "P0001" && rejected.message ? rejected.message : formatLiveDataLoadError(err, "Payment is not confirmed.");
        setError(message + (request.current ? " Retry the same request to confirm its outcome. Details are locked to prevent a duplicate payment." : " Nothing was recorded. Correct the details and try again."));
      } finally {
        setSubmitting(false);
      }
    },
    [
      isValid,
      submitting,
      supabase,
      residentId,
      invoiceId,
      paymentDate,
      amountCents,
      paymentMethod,
      referenceNumber,
      payerName,
      notes,
      selectedFacilityId,
      selectedInvoice,
      invoicesLoading,
    ],
  );

  if (success) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <BillingHubNav />
        <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <CardTitle className="text-lg text-emerald-900 dark:text-emerald-200">
                Payment recorded
              </CardTitle>
            </div>
            <CardDescription>
              {billingCurrency.format(amountCents / 100)} applied
              {selectedInvoice
                ? ` to ${formatInvoiceRowNumberForDisplay(selectedInvoice)}`
                : " (unapplied)"}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                ambiguous.current = false;
                requestScope.current = null;
                request.current = null;
                setPending(false);
                setSuccess(false);
                setResidentId("");
                setInvoiceId("");
                setAmountDollars("");
                setReferenceNumber("");
                setPayerName("");
                setNotes("");
                setInvoices([]);
              }}
            >
              Record another
            </Button>
            <Link
              href={residentId ? `/admin/residents/${residentId}/billing` : "/admin/billing/invoices"}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {residentId ? "Resident billing" : "Back to invoices"}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <BillingHubNav />

      <div className="flex items-center gap-2">
        <Link
          href="/admin/billing/invoices"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "inline-flex w-fit gap-1",
          )}
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            <CardTitle className="text-xl">Record payment</CardTitle>
          </div>
          <CardDescription>
            Select a resident, optionally apply to an open invoice, and record
            payment details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="grid gap-6 sm:grid-cols-2"
          >
            <fieldset disabled={pending || submitting} className="contents">
            {/* Resident selector */}
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Resident <span className="text-red-500">*</span>
              </label>
              {residentsLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading residents…
                </div>
              ) : (
                <select
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  <option value="">Select resident…</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Invoice selector */}
            {residentId && (
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Apply to invoice{" "}
                  <span className="text-xs font-normal text-slate-500">
                    (optional)
                  </span>
                </label>
                {invoicesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading invoices…
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={invoiceId}
                      onChange={(e) => setInvoiceId(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">Unapplied payment</option>
                      {invoiceId && !selectedInvoice && <option value={invoiceId}>Selected invoice unavailable — {invoiceId}</option>}
                      {invoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {formatInvoiceRowNumberForDisplay(inv)} — Balance{" "}
                          {billingCurrency.format(inv.balance_due / 100)} (
                          {formatDate(inv.period_start)} –{" "}
                          {formatDate(inv.period_end)})
                        </option>
                      ))}
                    </select>
                    {invoiceId && !selectedInvoice && <p role="alert" className="text-sm text-red-600">The selected invoice is not available as an open invoice. Reload its details or explicitly select another invoice or unapplied payment.</p>}
                    {selectedInvoice && (
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-xs capitalize"
                        >
                          {selectedInvoice.status}
                        </Badge>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Balance:{" "}
                          {billingCurrency.format(
                            selectedInvoice.balance_due / 100,
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Amount ($) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                className="tabular-nums"
              />
              {selectedInvoice && amountCents > selectedInvoice.balance_due && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Amount exceeds invoice balance of{" "}
                  {billingCurrency.format(selectedInvoice.balance_due / 100)}.
                </p>
              )}
            </div>

            {/* Payment method */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Payment method <span className="text-red-500">*</span>
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Payment date */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Payment date (ET) <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                aria-label="Payment date (Eastern Time)"
              />
            </div>

            {/* Reference number */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Reference #{" "}
                <span className="text-xs font-normal text-slate-500">
                  (check #, txn ID)
                </span>
              </label>
              <Input
                type="text"
                placeholder="e.g. 10482"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>

            {/* Payer name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Payer name
              </label>
              <Input
                type="text"
                placeholder="Who made the payment"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional internal notes"
                className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600"
              />
            </div>

            </fieldset>
            {pending && <p className="sm:col-span-2 text-sm">Request: {String(request.current?.p_request_id)}. Keep this page open and retry to recover the confirmed receipt.</p>}
            {error && (
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {error}
                </p>
              </div>
            )}

            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={submitting || (!pending && (!isValid || invoicesLoading || Boolean(invoiceId && !selectedInvoice)))}
                className="min-w-[160px]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Recording…
                  </>
                ) : (
                  <>
                    <Banknote className="mr-2 h-4 w-4" />
                    {pending ? "Retry same payment" : "Record payment"}
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
