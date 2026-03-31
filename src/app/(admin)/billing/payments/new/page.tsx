"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  balance_due: number;
  status: string;
  period_start: string;
  period_end: string;
};

type QueryError = { message: string };

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
  const { selectedFacilityId } = useFacilityStore();

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const [residentId, setResidentId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("check");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [referenceNumber, setReferenceNumber] = useState("");
  const [payerName, setPayerName] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    setResidentsLoading(true);
    try {
      let q = supabase
        .from("residents" as never)
        .select("id, first_name, last_name, facility_id")
        .is("deleted_at", null)
        .eq("status", "active")
        .order("last_name", { ascending: true })
        .limit(200);

      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }

      const { data, error: err } = (await q) as {
        data: {
          id: string;
          first_name: string | null;
          last_name: string | null;
        }[] | null;
        error: QueryError | null;
      };

      if (err) throw err;
      setResidents(
        (data ?? []).map((r) => ({
          id: r.id,
          name: `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(
            /^, |, $/,
            "",
          ),
        })),
      );
    } catch {
      setResidents([]);
    } finally {
      setResidentsLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  const loadInvoices = useCallback(
    async (rid: string) => {
      if (!rid) {
        setInvoices([]);
        return;
      }
      setInvoicesLoading(true);
      try {
        const { data, error: err } = (await supabase
          .from("invoices" as never)
          .select(
            "id, invoice_number, balance_due, status, period_start, period_end",
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
        setInvoices(data ?? []);
      } catch {
        setInvoices([]);
      } finally {
        setInvoicesLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  useEffect(() => {
    setInvoiceId("");
    if (residentId) {
      void loadInvoices(residentId);
    } else {
      setInvoices([]);
    }
  }, [residentId, loadInvoices]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId);
  const amountCents = Math.round(parseFloat(amountDollars || "0") * 100);
  const isValid =
    residentId && amountCents > 0 && paymentMethod && paymentDate;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || submitting) return;

      setSubmitting(true);
      setError(null);

      try {
        const resRow = (await supabase
          .from("residents" as never)
          .select("facility_id, organization_id")
          .eq("id", residentId)
          .maybeSingle()) as {
          data: {
            facility_id: string;
            organization_id: string;
          } | null;
          error: QueryError | null;
        };

        if (resRow.error) throw resRow.error;
        if (!resRow.data) throw new Error("Resident not found.");

        const entityRow = (await supabase
          .from("facilities" as never)
          .select("entity_id")
          .eq("id", resRow.data.facility_id)
          .maybeSingle()) as {
          data: { entity_id: string } | null;
          error: QueryError | null;
        };

        if (entityRow.error) throw entityRow.error;
        if (!entityRow.data) throw new Error("Facility entity not found.");

        const payload = {
          resident_id: residentId,
          facility_id: resRow.data.facility_id,
          organization_id: resRow.data.organization_id,
          entity_id: entityRow.data.entity_id,
          invoice_id: invoiceId || null,
          payment_date: paymentDate,
          amount: amountCents,
          payment_method: paymentMethod,
          reference_number: referenceNumber.trim() || null,
          payer_name: payerName.trim() || null,
          notes: notes.trim() || null,
        };

        const { error: insErr } = await supabase
          .from("payments" as never)
          .insert(payload as never);
        if (insErr) throw insErr;

        if (invoiceId && selectedInvoice) {
          const newPaid = (selectedInvoice.balance_due - amountCents >= 0)
            ? amountCents
            : selectedInvoice.balance_due;
          const newBalance = selectedInvoice.balance_due - newPaid;
          const newStatus =
            newBalance <= 0 ? "paid" : "partial";

          await supabase
            .from("invoices" as never)
            .update({
              amount_paid: amountCents,
              balance_due: Math.max(0, newBalance),
              status: newStatus,
            } as never)
            .eq("id", invoiceId);
        }

        setSuccess(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to record payment.",
        );
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
      selectedInvoice,
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
                ? ` to ${selectedInvoice.invoice_number}`
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
              href="/admin/billing/invoices"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Back to invoices
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
                ) : invoices.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No open invoices for this resident.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={invoiceId}
                      onChange={(e) => setInvoiceId(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <option value="">Unapplied payment</option>
                      {invoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoice_number} — Balance{" "}
                          {billingCurrency.format(inv.balance_due / 100)} (
                          {formatDate(inv.period_start)} –{" "}
                          {formatDate(inv.period_end)})
                        </option>
                      ))}
                    </select>
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
                Payment date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
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
                disabled={!isValid || submitting}
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
                    Record payment
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
