"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { formatInvoiceRowNumberForDisplay } from "@/lib/billing/invoices-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

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
  invoice_date: string;
  balance_due: number;
  status: string;
  period_start: string;
  period_end: string;
};

type QueryError = { message: string };

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

export default function AdminNewCollectionActivityPage() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const requestedResidentId = searchParams.get("residentId") ?? "";
  const requestedInvoiceId = searchParams.get("invoiceId") ?? "";

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const [residentId, setResidentId] = useState(() => requestedResidentId);
  const [invoiceId, setInvoiceId] = useState(() => requestedInvoiceId);
  const [activityType, setActivityType] = useState<string>("phone_call");
  const [activityDate, setActivityDate] = useState(() => todayFacilityDateIso());
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");

  const [activityId] = useState(() => crypto.randomUUID());
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
        .in("status", [...BILLING_RESIDENT_STATUSES])
        .order("last_name", { ascending: true })
        .limit(300);
      if (isValidFacilityIdForQuery(selectedFacilityId)) {
        q = q.eq("facility_id", selectedFacilityId);
      }
      const { data, error: err } = (await q) as {
        data: ResidentRowMini[] | null;
        error: QueryError | null;
      };
      if (err) throw err;
      const opts = (data ?? []).map(toResidentOption);

      // A deep-linked resident may fall outside the billing cohort or pinned
      // facility (e.g. discharged with an open invoice). Keep them selectable.
      if (requestedResidentId && !opts.some((o) => o.id === requestedResidentId)) {
        const { data: prefill } = (await supabase
          .from("residents" as never)
          .select("id, first_name, last_name")
          .eq("id", requestedResidentId)
          .is("deleted_at", null)
          .maybeSingle()) as { data: ResidentRowMini | null; error: QueryError | null };
        if (prefill) opts.unshift(toResidentOption(prefill));
      }
      setResidents(opts);
    } catch {
      setResidents([]);
    } finally {
      setResidentsLoading(false);
    }
  }, [supabase, selectedFacilityId, requestedResidentId]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  const loadInvoices = useCallback(
    async (rid: string): Promise<InvoiceOption[]> => {
      if (!rid) {
        setInvoices([]);
        return [];
      }
      setInvoicesLoading(true);
      try {
        // Scope to the resident only — the resident already determines the
        // facility, and an extra facility filter would hide a cross-facility
        // resident's invoices from the prefill.
        const { data, error: err } = (await supabase
          .from("invoices" as never)
          .select("id, invoice_number, invoice_date, balance_due, status, period_start, period_end")
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
        setInvoices(rows);
        return rows;
      } catch {
        setInvoices([]);
        return [];
      } finally {
        setInvoicesLoading(false);
      }
    },
    [supabase],
  );

  // Reset the invoice selection on resident change, then drop a prefilled
  // invoiceId that isn't among the resident's loaded open invoices.
  useEffect(() => {
    let cancelled = false;
    const prefillInvoiceId = residentId === requestedResidentId ? requestedInvoiceId : "";
    setInvoiceId(prefillInvoiceId);
    if (residentId) {
      void loadInvoices(residentId).then((rows) => {
        if (cancelled || !prefillInvoiceId) return;
        if (!rows.some((i) => i.id === prefillInvoiceId)) setInvoiceId("");
      });
    } else {
      setInvoices([]);
    }
    return () => {
      cancelled = true;
    };
  }, [loadInvoices, requestedInvoiceId, requestedResidentId, residentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      // Derive the facility from the resident so a deep-linked resident from
      // another facility logs against their own facility — the API rejects a
      // resident/facility mismatch.
      const { data: resRow, error: resErr } = (await supabase
        .from("residents" as never)
        .select("facility_id")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle()) as {
        data: { facility_id: string } | null;
        error: QueryError | null;
      };
      if (resErr) throw resErr;
      if (!resRow) throw new Error("Resident not found.");

      const payload: Record<string, unknown> = {
        id: activityId,
        resident_id: residentId,
        facility_id: resRow.facility_id,
        activity_type: activityType,
        activity_date: activityDate,
        description: description.trim(),
        outcome: outcome.trim() || null,
        follow_up_date: followUpDate.trim() || null,
        follow_up_notes: followUpNotes.trim() || null,
      };
      if (invoiceId.trim() && invoices.some((i) => i.id === invoiceId.trim())) {
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
          <h1 className="text-2xl font-semibold tracking-tight">Log collection activity</h1>
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
                        {formatInvoiceRowNumberForDisplay(inv)} — Balance {billingCurrency.format(inv.balance_due / 100)} (
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
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="activity-date">
                  Activity date (ET)
                </label>
                <Input
                  id="activity-date"
                  type="date"
                  value={activityDate}
                  onChange={(e) => setActivityDate(e.target.value)}
                  aria-label="Activity date (Eastern Time)"
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
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="follow-up-date">
                  Next follow-up date (ET)
                </label>
                <Input
                  id="follow-up-date"
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  aria-label="Next follow-up date (Eastern Time)"
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
