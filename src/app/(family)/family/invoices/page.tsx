"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";

import {
  fetchFamilyBillingContext,
  formatUsd,
  invoiceStatusBadgeClass,
  type FamilyBillingContext,
} from "@/lib/family/family-billing-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatDue(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export default function FamilyInvoicesPage() {
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
      setLoadError(e instanceof Error ? e.message : "Could not load invoices.");
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
        Loading invoices…
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

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Link
        href="/family/billing"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-stone-600 hover:text-stone-900")}
      >
        <ArrowLeft className="h-4 w-4" />
        Billing summary
      </Link>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xl font-display">
            <FileText className="h-6 w-6 text-orange-600" />
            Invoices
          </CardTitle>
          <CardDescription>
            Statements available for your linked residents. Open balance across visible invoices:{" "}
            <span className="font-medium text-stone-800">{formatUsd(data.totalBalanceDue)}</span>.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.invoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-600">
              No invoices are visible right now, or your current family access does not include billing records.
            </p>
          ) : (
            data.invoices.map((inv) => (
              <div key={inv.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900">{inv.invoiceNumber}</p>
                  <Badge className={invoiceStatusBadgeClass(inv.status)}>{inv.statusLabel}</Badge>
                </div>
                <p className="mb-2 text-xs text-stone-500">{inv.residentName}</p>
                <div className="grid gap-1 text-xs text-stone-600 sm:grid-cols-3">
                  <span>Period: {inv.periodLabel}</span>
                  <span>Total: {formatUsd(inv.total)}</span>
                  <span>
                    {inv.status === "paid" ? "Paid in full" : `Due ${formatDue(inv.dueDate)} · Balance ${formatUsd(inv.balanceDue)}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
