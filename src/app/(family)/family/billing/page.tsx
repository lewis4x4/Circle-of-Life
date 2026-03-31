"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, FileText, Loader2, ShieldCheck } from "lucide-react";

import {
  fetchFamilyBillingContext,
  formatUsd,
  invoiceStatusBadgeClass,
  type FamilyBillingContext,
} from "@/lib/family/family-billing-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatDue(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

export default function FamilyBillingSummaryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FamilyBillingContext | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }
    try {
      const result = await fetchFamilyBillingContext(supabase);
      if (!result.ok) {
        setLoadError(result.error);
        setData(null);
      } else {
        setData(result.data);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load billing.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading billing…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 pb-16 md:pb-0">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{loadError}</div>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }), "border-stone-300")}
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const recent = data.invoices.slice(0, 4);
  const balanceTone: "neutral" | "warning" | "success" =
    data.hasOverdue ? "warning" : data.totalBalanceDue > 0 ? "warning" : "success";
  const accountStatus = data.hasOverdue
    ? "Overdue balance"
    : data.totalBalanceDue > 0
      ? "Balance due"
      : "In good standing";
  const accountTone: "neutral" | "warning" | "success" = data.hasOverdue ? "warning" : data.totalBalanceDue > 0 ? "warning" : "success";

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Billing Summary</CardTitle>
          <CardDescription>Read-only overview from invoices and payments visible to your account.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <SummaryPill label="Open balance" value={formatUsd(data.totalBalanceDue)} tone={balanceTone} />
          <SummaryPill
            label="Last payment"
            value={data.lastPaymentAmount != null ? formatUsd(data.lastPaymentAmount) : "—"}
            tone="neutral"
          />
          <SummaryPill label="Payment date" value={data.lastPaymentDateLabel ?? "—"} tone="neutral" />
          <SummaryPill label="Account status" value={accountStatus} tone={accountTone} />
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-600">No invoices to show yet.</p>
          ) : (
            recent.map((invoice) => (
              <div key={invoice.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{invoice.invoiceNumber}</p>
                  <Badge className={invoiceStatusBadgeClass(invoice.status)}>{invoice.statusLabel}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-stone-600">
                  <p>{invoice.periodLabel}</p>
                  <p>{formatUsd(invoice.total)}</p>
                  <p>
                    {invoice.status === "paid"
                      ? "Paid"
                      : `Due ${formatDue(invoice.dueDate)}`}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardContent className="p-4">
          <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Phase 1 billing scope
          </p>
          <p className="mb-3 text-sm text-stone-700">
            Family billing is read-only during this phase. Online payment actions are scheduled for a future release.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/family/invoices"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
              )}
            >
              <FileText className="mr-1.5 h-4 w-4" />
              View Invoices
            </Link>
            <Link
              href="/family/payments"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
              )}
            >
              <CreditCard className="mr-1.5 h-4 w-4" />
              View Payments
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-300 bg-amber-50"
      : tone === "success"
        ? "border-emerald-300 bg-emerald-50"
        : "border-stone-200 bg-stone-50";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}
