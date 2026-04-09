"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Calculator, FileText, StickyNote } from "lucide-react";

import { AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { UUID_STRING_RE, isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
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
        <div className="glass-panel p-6 sm:p-8 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm">
          <div className="mb-4 border-b border-slate-200 dark:border-white/5 pb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Invoice not found</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Check the link or your facility selection.</p>
          </div>
          <Link href="/admin/billing/invoices" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Back to invoices
          </Link>
        </div>
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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix />
      
      <div className="relative z-10 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <BillingHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-3">
             <Link
               href="/admin/billing/invoices"
               className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
             >
                 <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> BACK TO INVOICES
             </Link>
             <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
               {invoice.invoice_number}
             </h1>
            <p className="mt-2 text-sm font-medium tracking-wide text-slate-600 dark:text-zinc-400">
               {residentName} · Period {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <InvoiceStatusBadge status={uiStatus} />
              <PayerTypeBadge payerType={uiPayer} />
            </div>
          </div>
          <div>
            <Link
              href={`/admin/residents/${invoice.resident_id}/billing`}
              className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-slate-100 hover:bg-slate-200 text-slate-900 shadow-lg flex items-center gap-2 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-white/10")}
            >
              Resident Billing Profile
            </Link>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
               <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">Timeline & Parties</h3>
            </div>
            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
              <div className="flex justify-between items-center bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400">Invoice date</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{formatDate(invoice.invoice_date)}</span>
              </div>
              <div className="flex justify-between items-center bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400">Due</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{formatDate(invoice.due_date)}</span>
              </div>
              {invoice.payer_name && (
                <div className="flex justify-between items-center bg-white dark:bg-slate-900/40 p-4 rounded-2xl border border-slate-100 dark:border-white/5 shadow-sm">
                  <span className="font-bold uppercase tracking-widest text-[9px] text-slate-400">Payer on file</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{invoice.payer_name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-emerald-500/20 dark:border-emerald-500/10 bg-emerald-50/30 dark:bg-emerald-900/10 backdrop-blur-3xl shadow-[inset_0_0_15px_rgba(16,185,129,0.02)] relative overflow-hidden transition-all">
            <div className="mb-6 border-b border-emerald-500/20 dark:border-white/5 pb-4 flex items-center justify-between">
               <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2"><Calculator className="h-4 w-4 text-emerald-500" /> Totals</h3>
            </div>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between text-slate-600 dark:text-slate-400 px-2">
                <span>Subtotal</span>
                <span className="tabular-nums font-mono">{billingCurrency.format(invoice.subtotal / 100)}</span>
              </p>
              <p className="flex justify-between text-slate-600 dark:text-slate-400 px-2">
                <span>Adjustments</span>
                <span className="tabular-nums font-mono">{billingCurrency.format(invoice.adjustments / 100)}</span>
              </p>
              <p className="flex justify-between text-slate-600 dark:text-slate-400 px-2 pb-2">
                <span>Tax</span>
                <span className="tabular-nums font-mono">{billingCurrency.format(invoice.tax / 100)}</span>
              </p>
              <div className="h-px w-full bg-slate-200 dark:bg-white/10 my-2"></div>
              <p className="flex justify-between font-medium text-slate-900 dark:text-slate-100 px-2">
                <span>Total</span>
                <span className="tabular-nums font-mono">{billingCurrency.format(invoice.total / 100)}</span>
              </p>
              <p className="flex justify-between text-slate-600 dark:text-slate-400 px-2">
                <span>Amount Paid</span>
                <span className="tabular-nums font-mono">{billingCurrency.format(invoice.amount_paid / 100)}</span>
              </p>
              <div className="h-px w-full bg-emerald-500/20 dark:bg-emerald-500/30 my-3"></div>
              <p className="flex justify-between font-semibold text-emerald-800 dark:text-emerald-400 px-2 text-lg">
                <span>Balance Due</span>
                <span className="tabular-nums font-mono">{billingCurrency.format(Math.max(0, invoice.balance_due) / 100)}</span>
              </p>
            </div>
          </div>
        </div>

        {invoice.notes?.trim() && (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-amber-500/20 dark:border-amber-500/10 bg-amber-50/50 dark:bg-amber-900/10 backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
             <div className="flex items-center gap-2 mb-2">
                <StickyNote className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-amber-700 dark:text-amber-500">Notes</h3>
             </div>
             <p className="text-sm text-slate-700 dark:text-slate-300 left-leading relative z-10 font-medium">
               {invoice.notes.trim()}
             </p>
          </div>
        )}

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative mt-4">
          <div className="mb-6 border-b border-slate-200 dark:border-white/5 pb-4 flex items-center justify-between">
            <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1 flex items-center gap-2">
               <FileText className="h-5 w-5 text-brand-500" /> Line Items
            </h3>
            <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Charges comprising this invoice</p>
          </div>
          
          <div className="relative z-10 w-full overflow-hidden">
             {lines.length === 0 ? (
               <p className="text-sm text-slate-500 dark:text-slate-400 py-4">No line items returned.</p>
             ) : (
                <>
                  <div className="hidden sm:grid grid-cols-[2fr_1fr_0.5fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10 text-left">
                     <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Description</div>
                     <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Type</div>
                     <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Qty</div>
                     <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Unit</div>
                     <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Total</div>
                  </div>

                  <div className="space-y-3 mt-6 relative z-10">
                     <MotionList className="space-y-3">
                        {lines.map((line) => (
                           <MotionItem key={line.id}>
                              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_0.5fr_1fr_1fr] gap-4 sm:items-center p-5 rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 hover:shadow-lg transition-all duration-300 w-full outline-none">
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Description</span>
                                   <span className="font-semibold text-base text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{line.description}</span>
                                </div>
                                <div className="flex flex-col">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Type</span>
                                   <span className="text-xs font-mono tracking-widest text-slate-500 dark:text-slate-400 uppercase">{line.line_type}</span>
                                </div>
                                <div className="flex flex-col sm:items-end">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Qty</span>
                                   <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{Number(line.quantity)}</span>
                                </div>
                                <div className="flex flex-col sm:items-end">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Unit</span>
                                   <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{billingCurrency.format(line.unit_price / 100)}</span>
                                </div>
                                <div className="flex flex-col sm:items-end p-3 sm:p-0 bg-slate-50 sm:bg-transparent rounded-lg dark:bg-white/5 dark:sm:bg-transparent mt-2 sm:mt-0">
                                   <span className="sm:hidden text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-0.5">Total</span>
                                   <span className="text-lg font-mono font-bold text-slate-900 dark:text-slate-100">{billingCurrency.format(line.total / 100)}</span>
                                </div>
                              </div>
                           </MotionItem>
                        ))}
                     </MotionList>
                  </div>
                </>
             )}
          </div>
        </div>

        {canPost && (
          <div className="glass-panel p-6 sm:p-8 rounded-[2.5rem] border border-indigo-500/20 dark:border-indigo-500/10 bg-indigo-50/50 dark:bg-indigo-900/10 backdrop-blur-3xl shadow-sm relative overflow-hidden transition-all">
             <div className="mb-6 border-b border-indigo-200 dark:border-white/5 pb-4 flex items-center justify-between">
                <h3 className="text-xl font-display font-semibold text-slate-900 dark:text-white mt-1">General Ledger</h3>
                <p className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase">Financial Posting Control</p>
             </div>
             
             <div className="space-y-4 relative z-10 w-full max-w-xl">
               <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-4">Post this invoice to the GL as a balanced journal entry (Debit AR / Credit Revenue).</p>
               {glError && (
                 <p className="text-sm font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 p-3 flex border border-rose-200 dark:border-rose-500/30 rounded-xl" role="alert">
                   {glError}
                 </p>
               )}
               {glResult ? (
                 <div className="flex flex-wrap items-center gap-4 bg-emerald-50 dark:bg-emerald-500/10 p-4 rounded-xl border border-emerald-200 dark:border-emerald-500/20">
                   <div className="flex flex-col">
                      <span className="font-bold text-[10px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Status</span>
                      <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                        {glResult.alreadyPosted ? "Reconciliation confirmed. Previously posted to GL." : "Commit successful. Posted to GL."}
                      </span>
                   </div>
                   <Link
                     href={`/admin/finance/journal-entries/${glResult.journalEntryId}`}
                     className={cn(buttonVariants({ size: "default" }), "h-10 px-5 rounded-xl font-bold uppercase tracking-widest text-[10px] tap-responsive bg-emerald-600 hover:bg-emerald-700 text-white border-none ml-auto")}
                   >
                     View Journal Entry
                   </Link>
                 </div>
               ) : (
                 <Button
                   type="button"
                   onClick={() => void postToGl()}
                   disabled={glPosting || invoice.total <= 0}
                   className={cn(buttonVariants({ size: "default" }), "h-14 px-8 rounded-full font-bold uppercase tracking-widest text-xs tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg flex items-center gap-2")}
                 >
                   {glPosting ? "Posting…" : "Post to GL"}
                 </Button>
               )}
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
