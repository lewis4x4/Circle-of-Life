"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Landmark } from "lucide-react";

import { FinanceHubNav } from "./finance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { Sparkline } from "@/components/ui/moonshot/sparkline";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { MotionList, MotionItem } from "@/components/ui/motion-list";

export default function AdminFinanceHubPage() {
  const supabase = createClient();
  const [postedCount, setPostedCount] = useState<number | null>(null);
  const [unpostedInvoices, setUnpostedInvoices] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setPostedCount(null);
        return;
      }
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      const iso = start.toISOString().slice(0, 10);
      const [{ count }, { count: invTotal }, { data: postedSources }] = await Promise.all([
        supabase
          .from("journal_entries")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("status", "posted")
          .gte("entry_date", iso)
          .is("deleted_at", null),
        supabase
          .from("invoices" as never)
          .select("id", { count: "exact", head: true })
          .eq("organization_id" as never, ctx.ctx.organizationId as never)
          .is("deleted_at" as never, null as never),
        supabase
          .from("journal_entries")
          .select("source_id")
          .eq("organization_id", ctx.ctx.organizationId)
          .eq("source_type", "invoice")
          .is("deleted_at", null),
      ]);
      setPostedCount(count ?? 0);
      const postedIds = new Set((postedSources ?? []).map((r) => (r as { source_id: string | null }).source_id));
      const totalInv = invTotal ?? 0;
      setUnpostedInvoices(Math.max(0, totalInv - postedIds.size));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={unpostedInvoices ? unpostedInvoices > 0 : false} 
        primaryClass="bg-emerald-700/10"
        secondaryClass="bg-slate-900/10"
      />
      
      <div className="relative z-10 space-y-6">
        <FinanceHubNav />
        <div className="flex items-center gap-3">
          <Landmark className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Finance</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Entity and facility general ledger (Module 17) — chart of accounts, journal entries, ledger.
            </p>
          </div>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4" staggerMs={75}>
          <div className="col-span-1 h-[160px]">
            <V2Card hoverColor="slate" className="flex flex-col">
              <div className="mb-2">
                <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">Quick links</h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Manage GL data for your organization.</p>
              </div>
              <div className="flex flex-col gap-1 text-[11px] overflow-y-auto flex-1">
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/chart-of-accounts">
                  Chart of accounts
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/journal-entries">
                  Journal entries
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/ledger">
                  Posted ledger (read-only)
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/trial-balance">
                  Trial balance
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/posting-rules">
                  GL posting rules
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/period-close">
                  Period close
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/budget">
                  Budget vs actual
                </Link>
                <Link className="text-indigo-600 dark:text-indigo-400 font-mono uppercase tracking-widest hover:text-indigo-500 transition-colors" href="/admin/finance/gl-settings">
                  GL settings
                </Link>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="slate">
              <Sparkline colorClass="text-emerald-500" variant={3} />
              <MonolithicWatermark value={postedCount ?? 0} className="text-slate-800/5 dark:text-white/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <h3 className="text-[10px] font-mono tracking-widest uppercase text-slate-500 flex items-center gap-2">
                  Posted Entries (30d)
                </h3>
                <p className="text-4xl font-mono tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-slate-900 to-slate-500 dark:from-white dark:to-slate-500 pb-1">{loading ? "…" : postedCount ?? "—"}</p>
              </div>
            </V2Card>
          </div>
          <div className="h-[160px]">
            <V2Card hoverColor="amber" className={unpostedInvoices ? "border-amber-500/20 shadow-[inset_0_0_15px_rgba(245,158,11,0.05)]" : ""}>
              <Sparkline colorClass="text-amber-500" variant={2} />
              <MonolithicWatermark value={unpostedInvoices ?? 0} className="text-amber-600/5 dark:text-amber-400/5 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-mono tracking-widest uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                     Unposted Invoices
                  </h3>
                  {unpostedInvoices != null && unpostedInvoices > 0 && <PulseDot colorClass="bg-amber-500" />}
                </div>
                <div>
                  <p className="text-4xl font-mono tracking-tighter text-amber-600 dark:text-amber-400 pb-1">{loading ? "…" : unpostedInvoices ?? "—"}</p>
                  {unpostedInvoices != null && unpostedInvoices > 0 && (
                    <Link className="mt-1 block text-[10px] uppercase font-mono tracking-widest text-amber-600/80 hover:text-amber-600 dark:text-amber-400/80 dark:hover:text-amber-400 underline-offset-4 hover:underline" href="/admin/billing/invoices">
                      Review Invoices →
                    </Link>
                  )}
                </div>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

        {/* ACTION QUEUE: Financial Triage */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6 border-t border-white/20 dark:border-white/5">
          
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-white/20 dark:border-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Action Ledger
              </h3>
            </div>
            
            <MotionList className="space-y-3">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading ledger…</p>
              ) : unpostedInvoices === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-white/40 dark:bg-black/20 rounded-3xl border border-white/20 dark:border-white/5 glass-panel backdrop-blur-2xl shadow-xl">
                   <p className="font-display font-medium text-slate-900 dark:text-slate-100">Ledger Reconciled</p>
                   <p className="text-sm opacity-80 font-mono tracking-wide mt-1">All invoices and journal entries are currently posted.</p>
                </div>
              ) : (
                <>
                  {/* MOCK Action Items based on fetched unposted invoices count */}
                  {unpostedInvoices != null && unpostedInvoices > 0 && Array.from({ length: Math.min(3, unpostedInvoices) }).map((_, i) => (
                    <MotionItem key={i} className="glass-panel p-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-900/10 backdrop-blur-2xl relative overflow-hidden group hover:border-amber-500/40 hover:bg-amber-500/10 dark:hover:bg-amber-900/20 transition-all duration-300">
                      <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                      <div className="flex justify-between items-start mb-3">
                         <span className="text-[9px] font-bold text-amber-700 dark:text-amber-400 bg-amber-500/20 shadow-sm border-0 px-2 py-1 rounded-md uppercase tracking-widest">
                           Unposted Invoice
                         </span>
                         <span className="text-[10px] text-amber-600/80 dark:text-amber-500 font-mono tracking-widest uppercase font-bold">Pending Manager Approval</span>
                      </div>
                      <div className="mb-4">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-1">
                          Ref: INV-{8004 + i} — Sysco Foods Corp
                        </p>
                        <p className="text-sm font-mono text-slate-900 dark:text-slate-100 font-bold mb-1">
                          $1,24{i}.00
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          Invoice received on Monday. Auto-coded to `5100-Dietary`. Awaiting final posting to GL.
                        </p>
                      </div>
                      <div className="flex gap-2 justify-start mt-2">
                          <Link
                            href="/admin/billing/invoices"
                            className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-amber-600 hover:bg-amber-700 text-black font-mono uppercase tracking-widest text-[9px] shadow-lg")}
                          >
                            Review & Post
                          </Link>
                      </div>
                    </MotionItem>
                  ))}
                </>
              )}
            </MotionList>
          </div>

          <div className="col-span-1 border-l border-white/20 dark:border-white/5 pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between pb-2 border-b border-white/20 dark:border-white/5 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Period Status
              </h3>
            </div>
            
            <div className="space-y-4">
              <div className="glass-panel p-4 rounded-2xl border border-white/20 dark:border-white/5 bg-white/40 dark:bg-black/20 flex flex-col gap-2 backdrop-blur-2xl shadow-xl">
                 <div className="flex justify-between items-center mb-1">
                   <p className="text-[10px] uppercase font-mono tracking-widest font-semibold text-slate-900 dark:text-slate-100">Period: Q2 Active</p>
                   <span className="text-[10px] tracking-widest font-mono font-bold text-emerald-600 uppercase">Open</span>
                 </div>
                 <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                   <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '45%' }}></div>
                 </div>
                 <p className="text-[10px] text-slate-500 mt-1">16 Days remaining before soft-close.</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
