"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Banknote, Loader2 } from "lucide-react";

import { fetchFamilyPaymentsList, formatUsd, type FamilyPaymentRow } from "@/lib/family/family-billing-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function FamilyPaymentsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FamilyPaymentRow[]>([]);
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
      const [paymentsResult, residentResult] = await Promise.all([
        fetchFamilyPaymentsList(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!paymentsResult.ok) {
        setLoadError(paymentsResult.error);
        setRows([]);
      } else {
        setRows(paymentsResult.rows);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load payments.");
      setRows([]);
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
        Loading payments…
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

  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <FamilySectionIntro
        active="billing"
        title="Payments"
        description="A simple record of posted payments for the people linked to your account."
        residentSummary={residentSummary || undefined}
      />
      <Link href="/family/billing" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-stone-600 hover:text-stone-900")}>
        <ArrowLeft className="h-4 w-4" />
        Back to billing summary
      </Link>

      <div className="glass-card-light rounded-[2rem] p-6 md:p-8 bg-white/70">
        <div className="mb-5 flex items-center gap-3">
          <Banknote className="h-6 w-6 text-amber-600" />
          <div>
            <h2 className="text-2xl font-serif text-stone-800">Payments</h2>
            <p className="text-sm text-stone-500">Posted payments visible for linked residents. This page is for review only.</p>
          </div>
        </div>
        <div className="mb-4">
          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
            Read-only history
          </Badge>
        </div>
        <div className="space-y-3">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-600">
              No payments are visible right now, or your current family access does not include payment history.
            </p>
          ) : (
            rows.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-1 rounded-[1.5rem] border border-stone-200 bg-white/60 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-lg font-serif text-stone-900">{formatUsd(p.amount)}</p>
                  <p className="text-sm text-stone-600">
                    {p.dateLabel} · {p.methodLabel}
                  </p>
                  <p className="text-xs text-stone-500">{p.residentName}</p>
                </div>
                <p className="text-xs text-stone-500 sm:text-right">{p.reference}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
