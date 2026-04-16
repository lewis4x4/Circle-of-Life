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
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

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
  const [residentSummary, setResidentSummary] = useState("");

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
      const [invoiceResult, residentResult] = await Promise.all([
        fetchFamilyBillingContext(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!invoiceResult.ok) {
        setLoadError(invoiceResult.error);
        setData(null);
      } else {
        setData(invoiceResult.data);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
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
      <FamilySectionIntro
        active="billing"
        title="Invoices"
        description="Every visible statement in one place, with due dates and current balances."
        residentSummary={residentSummary || undefined}
      />
      <Link href="/family/billing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-stone-600 hover:text-stone-900")}>
        <ArrowLeft className="h-4 w-4" />
        Back to billing summary
      </Link>

      <div className="glass-card-light rounded-[2rem] p-6 md:p-8 bg-white/70">
        <div className="mb-5 flex items-center gap-3">
          <FileText className="h-6 w-6 text-amber-600" />
          <div>
            <h2 className="text-2xl font-serif text-stone-800">Invoices</h2>
            <p className="text-sm text-stone-500">
              Open balance across visible invoices: <span className="font-semibold text-stone-700">{formatUsd(data.totalBalanceDue)}</span>
            </p>
          </div>
        </div>
        <div className="space-y-3">
          {data.invoices.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-600">
              No invoices are visible right now, or your current family access does not include billing records.
            </p>
          ) : (
            data.invoices.map((inv) => (
              <div key={inv.id} className="rounded-[1.5rem] border border-stone-200 bg-white/60 p-5 shadow-sm">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-stone-400 font-bold">{inv.invoiceNumber}</p>
                    <p className="text-lg font-serif text-stone-800">{inv.periodLabel}</p>
                  </div>
                  <Badge className={invoiceStatusBadgeClass(inv.status)}>{inv.statusLabel}</Badge>
                </div>
                <div className="pt-3 border-t border-stone-100 text-sm text-stone-600 space-y-1">
                  <p>{inv.residentName}</p>
                  <p>Total: {formatUsd(inv.total)}</p>
                  <p>
                    {inv.status === "paid" ? "Paid in full" : `Due ${formatDue(inv.dueDate)} · Balance ${formatUsd(inv.balanceDue)}`}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
