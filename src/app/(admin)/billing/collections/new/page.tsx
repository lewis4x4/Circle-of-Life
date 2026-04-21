"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Phone } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import { BillingHubNav } from "../../billing-hub-nav";
import { billingCurrency } from "../../billing-invoice-ledger";

const ACTIVITY_TYPES = [
  { value: "phone_call", label: "Phone call" },
  { value: "email", label: "Email" },
  { value: "letter", label: "Letter / statement" },
  { value: "payment_promise", label: "Payment promise" },
  { value: "escalation", label: "Escalation" },
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

export default function AdminNewCollectionActivityPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const [residentId, setResidentId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [activityType, setActivityType] = useState<string>("phone_call");
  const [activityDate, setActivityDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    setResidentsLoading(true);
    try {
      let q = supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .is("deleted_at", null)
        .eq("status", "active")
        .order("last_name", { ascending: true })
        .limit(300);
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
      const opts =
        data?.map((r) => ({
          id: r.id,
          name: `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(
            /^, |, $/,
            "",
          ),
        })) ?? [];
      setResidents(opts);
    } catch {
      setResidents([]);
    } finally {
      setResidentsLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  const loadInvoices = useCallback(
    async (rid: string) => {
      if (!rid) {
        setInvoices([]);
        return;
      }
      setInvoicesLoading(true);
      try {
        let q = supabase
          .from("invoices" as never)
          .select("id, invoice_number, balance_due, status, period_start, period_end")
          .eq("resident_id", rid)
          .is("deleted_at", null)
          .in("status", ["draft", "sent", "partial", "overdue"])
          .order("invoice_date", { ascending: false })
          .limit(50);
        if (isValidFacilityIdForQuery(selectedFacilityId)) {
          q = q.eq("facility_id", selectedFacilityId);
        }
        const { data, error: err } = (await q) as {
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
    [supabase, selectedFacilityId],
  );

  useEffect(() => {
    setInvoiceId("");
    if (residentId) {
      void loadInvoices(residentId);
    } else {
      setInvoices([]);
    }
  }, [residentId, loadInvoices]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility first.");
      return;
    }
    if (!residentId.trim()) {
      setError("Choose a resident.");
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        resident_id: residentId,
        facility_id: selectedFacilityId,
        activity_type: activityType,
        activity_date: activityDate,
        description: description.trim(),
        outcome: outcome.trim() || null,
        follow_up_date: followUpDate.trim() || null,
        follow_up_notes: followUpNotes.trim() || null,
      };
      if (invoiceId.trim()) {
        payload.invoice_id = invoiceId.trim();
      }

      const response = await fetch("/api/admin/workflows/collection-activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || "Failed to save.");
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-6">
        <BillingHubNav />
        <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
          <CardHeader>
            <CardTitle className="text-lg text-emerald-900 dark:text-emerald-200">
              Collection activity logged
            </CardTitle>
            <CardDescription>
              It will appear on the collections ledger for this facility.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/admin/billing/collections" className={buttonVariants({ size: "sm" })}>
              View log
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSuccess(false);
                setDescription("");
                setOutcome("");
                setFollowUpDate("");
                setFollowUpNotes("");
                setInvoiceId("");
                setResidentId("");
              }}
            >
              Log another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BillingHubNav />
      <div>
        <Link
          href="/admin/billing/collections"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Collections
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Phone className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Log collection activity</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Record calls, letters, promises, and follow-ups for past-due accounts.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Required: resident, activity type, date, and description.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-xl">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Resident</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={residentId}
                onChange={(e) => setResidentId(e.target.value)}
                disabled={residentsLoading}
                required
              >
                <option value="">Select resident…</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            {residentId && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Invoice (optional)
                </label>
                {invoicesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading invoices…
                  </div>
                ) : invoices.length === 0 ? (
                  <p className="text-sm text-slate-500">No open invoices for this resident.</p>
                ) : (
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                  >
                    <option value="">Not linked to a specific invoice</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} — Balance {billingCurrency.format(inv.balance_due / 100)} (
                        {formatDate(inv.period_start)} – {formatDate(inv.period_end)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Type</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                >
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Activity date
                </label>
                <Input
                  type="date"
                  value={activityDate}
                  onChange={(e) => setActivityDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Description</label>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What was discussed or sent?"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Outcome</label>
              <textarea
                className="min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="Result of this touch (optional)"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Next follow-up date
                </label>
                <Input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Follow-up notes
                </label>
                <Input
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  placeholder="What to do next (optional)"
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting || residentsLoading}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save activity"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
