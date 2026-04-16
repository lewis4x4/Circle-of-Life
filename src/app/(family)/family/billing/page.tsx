"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, FileText, Loader2, ShieldCheck, Banknote } from "lucide-react";

import { fetchFamilyBillingContext, formatUsd, type FamilyBillingContext } from "@/lib/family/family-billing-data";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { fetchFamilyLinkedResidentSummary } from "@/lib/family/family-linked-residents";
import { FamilySectionIntro } from "@/components/family/FamilySectionIntro";

import { cn } from "@/lib/utils";

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
      const [billingResult, residentResult] = await Promise.all([
        fetchFamilyBillingContext(supabase),
        fetchFamilyLinkedResidentSummary(supabase),
      ]);
      if (!billingResult.ok) {
        setLoadError(billingResult.error);
        setData(null);
      } else {
        setData(billingResult.data);
      }
      if (residentResult.ok) {
        setResidentSummary(residentResult.data.residentSummary);
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
      <div className="rounded-xl border border-rose-200 bg-white/60 backdrop-blur-md px-6 py-4 text-sm text-rose-800 shadow-sm max-w-lg mx-auto mt-20">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 text-stone-500 gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-sm font-medium tracking-wide">Crunching the numbers…</p>
      </div>
    );
  }

  if (loadError) {
    return (
     <div className="space-y-4 pb-16 md:pb-0 max-w-md mx-auto text-center mt-20">
        <div className="rounded-2xl border border-rose-200 bg-white/70 backdrop-blur-xl px-4 py-6 text-sm text-rose-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <Banknote className="w-8 h-8 text-rose-400 mx-auto mb-3" />
          <p>{loadError}</p>
        </div>
        <button
          type="button"
          className="w-full h-12 rounded-full bg-white text-stone-700 font-medium border border-stone-200 shadow-sm hover:bg-stone-50 transition-colors cursor-pointer tap-responsive"
          onClick={() => void load()}
        >
          Retry Connection
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
    <div className="pb-8 flex flex-col items-center max-w-3xl mx-auto w-full px-4 pt-12 md:pt-20">
      <FamilySectionIntro
        active="billing"
        title="Billing Summary"
        description="A calm overview of statements and payment history that are visible to your account."
        residentSummary={residentSummary || undefined}
      />

      <div className="w-full space-y-12">
         {/* Financial Overview Blocks */}
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryBlock label="Open balance" value={formatUsd(data.totalBalanceDue)} tone={balanceTone} />
            <SummaryBlock label="Account status" value={accountStatus} tone={accountTone} />
            <SummaryBlock
              label="Last payment"
              value={data.lastPaymentAmount != null ? formatUsd(data.lastPaymentAmount) : "—"}
              tone="neutral"
            />
            <SummaryBlock label="Payment date" value={data.lastPaymentDateLabel ?? "—"} tone="neutral" />
         </div>

         {/* Invoices */}
         <div className="glass-card-light rounded-[2rem] p-6 md:p-8 bg-white/70">
            <h2 className="text-2xl font-serif text-stone-800 tracking-tight mb-6 flex items-center gap-2">Recent Invoices</h2>
            
            {recent.length === 0 ? (
               <div className="p-8 text-center border-dashed border-2 border-stone-200/50 rounded-3xl">
                  <p className="text-stone-500 font-medium">No invoices to show yet.</p>
               </div>
            ) : (
               <div className="space-y-3">
                  {recent.map((invoice) => (
                    <div key={invoice.id} className="rounded-3xl border border-stone-100 bg-white/50 p-5 shadow-sm transition-all hover:bg-white hover:shadow-md">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                           <p className="text-xs uppercase tracking-widest text-stone-400 font-bold mb-0.5">{invoice.invoiceNumber}</p>
                           <p className="text-lg font-serif text-stone-800">{invoice.periodLabel}</p>
                        </div>
                        <span className={cn(
                           "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest",
                           invoice.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700" 
                        )}>
                           {invoice.statusLabel}
                        </span>
                      </div>
                      <div className="mt-4 pt-4 border-t border-stone-100 flex min-w-0 flex-wrap items-center justify-between gap-4">
                        <p className="text-2xl font-serif text-stone-900 tracking-tight">{formatUsd(invoice.total)}</p>
                        <p className={`text-sm font-medium ${invoice.status === 'paid' ? 'text-stone-400' : 'text-stone-600'}`}>
                          {invoice.status === "paid"
                            ? "Paid"
                            : `Due ${formatDue(invoice.dueDate)}`}
                        </p>
                      </div>
                    </div>
                  ))}
               </div>
            )}
         </div>

         {/* VISIBILITY SCOPE FOOTER */}
         <div className="glass-card-light rounded-[2rem] p-6 md:p-8 bg-white/70">
           <div className="mb-4 flex items-center justify-between gap-2">
             <p className="inline-flex items-center gap-2 text-sm font-semibold text-stone-800 uppercase tracking-widest">
               <ShieldCheck className="h-4 w-4 text-emerald-500" />
               What you can do here
             </p>
           </div>
           <p className="mb-6 text-sm text-stone-600 leading-relaxed max-w-xl">
             This space is read-only today. You can review statements and payment history here, then follow your facility&apos;s existing payment path if something is due.
           </p>
           <div className="flex flex-wrap gap-3">
             <Link
               href="/family/invoices"
               className="flex-1 min-w-[140px] h-12 rounded-2xl border border-stone-200 bg-white text-stone-700 font-medium hover:bg-stone-50 transition-colors shadow-sm inline-flex items-center justify-center tap-responsive"
             >
               <FileText className="mr-2 h-4 w-4 text-stone-400" />
               View Invoices
             </Link>
             <Link
               href="/family/payments"
               className="flex-1 min-w-[140px] h-12 rounded-2xl bg-amber-500 text-white font-medium hover:bg-amber-400 transition-colors shadow-[0_4px_14px_rgba(245,158,11,0.15)] inline-flex items-center justify-center tap-responsive"
             >
               <CreditCard className="mr-2 h-4 w-4 text-amber-100" />
               View Payments
             </Link>
           </div>
         </div>

      </div>
    </div>
  );
}

function SummaryBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "success";
}) {
  const styleClass =
    tone === "warning"
      ? "bg-amber-50 border-amber-200/50"
      : tone === "success"
        ? "bg-emerald-50 border-emerald-200/50"
        : "bg-white/70 border-white";

  const textTone = 
      tone === "warning" ? "text-amber-900" : tone === "success" ? "text-emerald-900" : "text-stone-800";

  return (
    <div className={`glass-card-light rounded-[2rem] p-6 shadow-sm border ${styleClass}`}>
      <p className="text-xs uppercase font-bold tracking-widest text-stone-400 mb-1">{label}</p>
      <p className={`text-2xl md:text-3xl font-serif tracking-tight ${textTone}`}>{value}</p>
    </div>
  );
}
